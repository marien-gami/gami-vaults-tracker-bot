// alerts/vaultsTracker.js — Version block polling via eth_getBlockByNumber
//
// Stratégie :
//   1. eth_blockNumber pour connaître le bloc courant (par chain)
//   2. eth_getBlockByNumber(blockNum, true) pour chaque nouveau bloc → liste les txs
//   3. Filtre tx.to contre les adresses de vault trackées
//   4. eth_getTransactionReceipt pour les txs correspondantes → logs d'events
//   5. Matching par topic0 (trackedEventsMap) → décodage du montant
//
// Note : getLogs et txlist ne sont PAS utilisés car Routescan présente un lag
// d'indexation d'environ 1 mois pour ces endpoints. Seuls les appels RPC directs
// (eth_getBlockByNumber, eth_getTransactionReceipt) sont temps réel.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTelegramMessage } from "../telegram.js";
import { VAULTS } from "../vaultsConfig.js";

const chatId = process.env.CHAT_ID;

const ROUTESCAN_API_URL =
  process.env.ROUTESCAN_API_URL || "https://api.routescan.io";
const ROUTESCAN_API_KEY_DEFAULT = process.env.ROUTESCAN_API_KEY;
const ROUTESCAN_NETWORK_ID = process.env.ROUTESCAN_NETWORK_ID || "mainnet";

// Clés API Routescan par chain (optionnel — utilise la clé par défaut si absent)
function getRoutescanApiKey(chainId) {
  return (
    process.env[`ROUTESCAN_API_KEY_${chainId}`] || ROUTESCAN_API_KEY_DEFAULT
  );
}

const CHECK_INTERVAL_SECONDS = parseInt(
  process.env.CHECK_INTERVAL_SECONDS || "30",
  10
);
const CHECK_EVERY_MS = CHECK_INTERVAL_SECONDS * 1000;

const ROUTESCAN_DELAY_MS = parseInt(
  process.env.ROUTESCAN_DELAY_MS || "800",
  10
);

const RPC_MAX_RETRIES = parseInt(process.env.RPC_MAX_RETRIES || "3", 10);

// RPC primaire par chainId — Alchemy en premier, puis vars génériques RPC_URL_<chainId>
const FALLBACK_RPC_URLS = new Map();
if (process.env.ALCHEMY_BASE_RPC_URL)  FALLBACK_RPC_URLS.set(8453,  process.env.ALCHEMY_BASE_RPC_URL);
if (process.env.ALCHEMY_ETH_RPC_URL)   FALLBACK_RPC_URLS.set(1,     process.env.ALCHEMY_ETH_RPC_URL);
if (process.env.ALCHEMY_AVAX_RPC_URL)  FALLBACK_RPC_URLS.set(43114, process.env.ALCHEMY_AVAX_RPC_URL);
if (process.env.ALCHEMY_HEMI_RPC_URL)  FALLBACK_RPC_URLS.set(43111, process.env.ALCHEMY_HEMI_RPC_URL);
// RPC_URL_<chainId> — pour tout provider JSON-RPC (ex: RPC_URL_14 pour Flare)
// Prend la priorité sur les vars Alchemy si les deux sont définies
for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^RPC_URL_(\d+)$/);
  if (match && value) FALLBACK_RPC_URLS.set(parseInt(match[1], 10), value);
}

// Nombre maximum de chunks eth_getLogs par tick et par chain.
// Plafonne la taille d'un rattrapage : blocs/tick = LOGS_BLOCK_RANGE × MAX_CHUNKS_PER_TICK.
// Exprimé en chunks (et non en blocs) pour s'adapter tout seul à la plage de chaque chain.
// 60 laisse ≥5× de marge sur la chain la plus rapide en plage de 10 blocs (Avalanche,
// ~113 blocs/tick), tout en restant 3× sous la rafale de 200 qui saturait le RPC.
// Ne mord qu'en rattrapage : en régime nominal le nombre d'appels dépend des blocs écoulés.
// Override par chain : MAX_CHUNKS_PER_TICK_<chainId>
const MAX_CHUNKS_PER_TICK = parseInt(process.env.MAX_CHUNKS_PER_TICK || "60", 10);

function getMaxChunksPerTick(chainId) {
  const override = process.env[`MAX_CHUNKS_PER_TICK_${chainId}`];
  return override ? parseInt(override, 10) : MAX_CHUNKS_PER_TICK;
}

// Taille max d'une plage eth_getLogs — free tier Alchemy = 10 blocs.
// Les RPC publics acceptent bien plus : rpc.mainnet.chain.robinhood.com encaisse
// 2 000 000 de blocs par appel, et Robinhood produit ~10 blocs/s (~300/tick de 30s).
// Override par chain : LOGS_BLOCK_RANGE_<chainId>
const LOGS_BLOCK_RANGE = parseInt(process.env.LOGS_BLOCK_RANGE || "10", 10);
const LOGS_BLOCK_RANGE_BY_CHAIN = new Map([
  [4663, 2000] // Robinhood Chain — RPC public sans limite de plage
]);

function getLogsBlockRange(chainId) {
  const override = process.env[`LOGS_BLOCK_RANGE_${chainId}`];
  if (override) return parseInt(override, 10);
  return LOGS_BLOCK_RANGE_BY_CHAIN.get(chainId) ?? LOGS_BLOCK_RANGE;
}

// Persistance des pointeurs — sans elle, tout redémarrage repart de la tête de
// chaîne et les events survenus pendant l'arrêt sont perdus définitivement.
const POINTERS_FILE =
  process.env.POINTERS_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".pointers.json");

// Garde-fou : au boot, on ne remonte jamais plus loin que ça dans le passé
const MAX_CATCHUP_BLOCKS = parseInt(process.env.MAX_CATCHUP_BLOCKS || "100000", 10);

// Alerte Telegram si le retard dépasse ce nombre de blocs (0 = désactivé)
const LAG_ALERT_BLOCKS = parseInt(process.env.LAG_ALERT_BLOCKS || "20000", 10);
const LAG_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const lastLagAlert = new Map();

// pointeurs par chain : chainId → nextBlock (number)
const chainPointers = new Map();

// anti-doublons : "chainId:txHash:logIndex"
const seenKeys = new Set();

// verrou pour éviter les ticks overlappants
let tickRunning = false;

// cooldown par chain après 429 : chainId → { until: timestamp, level: 0|1|2 }
const chainCooldowns = new Map();
const COOLDOWN_DURATIONS = [60_000, 300_000, 600_000]; // 1min, 5min, 10min

// -------- Helpers --------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimZeros(s) {
  if (s.indexOf(".") === -1) return s;
  s = s.replace(/0+$/, "");
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

function getEmojiForAction(actionType) {
  const type = (actionType || "").toLowerCase();
  if (type.includes("request deposit")) return "🟡";
  if (type.includes("request withdraw")) return "🟠";
  if (type.includes("deposit")) return "🟢";
  if (type.includes("withdraw") || type.includes("redeem")) return "🔴";
  return "⚪";
}

// Décode une adresse EVM depuis un topic 32 bytes (prend les 20 derniers bytes)
function decodeAddressFromTopic(topic) {
  if (!topic || typeof topic !== "string") return "";
  const hex = topic.replace("0x", "");
  if (hex.length < 40) return "";
  return ("0x" + hex.slice(-40)).toLowerCase();
}

// Décode un uint256 depuis les données ABI-encodées à un slot donné (0-based)
function decodeUint256FromData(data, slotIndex = 0) {
  if (!data || typeof data !== "string") return null;
  const hex = data.replace("0x", "");
  const start = slotIndex * 64;
  const chunk = hex.slice(start, start + 64);
  if (chunk.length < 64) return null;
  try {
    return BigInt("0x" + chunk);
  } catch {
    return null;
  }
}

// -------- Fallback JSON-RPC (Alchemy) --------

// Erreur RPC définitive (toutes les tentatives épuisées).
// Volontairement distincte d'un résultat vide : un appel qui ÉCHOUE ne doit
// jamais être confondu avec "aucun event sur cette plage".
class RpcFailure extends Error {}

async function callFallbackRpc(chainId, method, params, retries = RPC_MAX_RETRIES) {
  const url = FALLBACK_RPC_URLS.get(chainId);
  if (!url) return null;

  let lastReason = "raison inconnue";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(500 * Math.pow(2, attempt - 1), 8000));
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      if (!res.ok) {
        // 429 (Alchemy free tier) et 403 (WAF des RPC publics) sont transitoires
        lastReason = `HTTP ${res.status}`;
        console.warn(
          `⚠️  RPC ${method} chain ${chainId} — ${lastReason}, tentative ${attempt + 1}/${retries + 1}`
        );
        continue;
      }
      const json = await res.json();
      if (json?.error) {
        lastReason = `RPC error ${json.error.code}: ${json.error.message}`;
        console.warn(
          `⚠️  RPC ${method} chain ${chainId} — ${lastReason}, tentative ${attempt + 1}/${retries + 1}`
        );
        continue;
      }
      return json?.result ?? null;
    } catch (err) {
      lastReason = err?.message ?? String(err);
      console.warn(
        `⚠️  RPC ${method} chain ${chainId} — ${lastReason}, tentative ${attempt + 1}/${retries + 1}`
      );
    }
  }
  throw new RpcFailure(
    `${method} chain ${chainId} — échec après ${retries + 1} tentatives (${lastReason})`
  );
}

// Variante tolérante : pour les appels d'enrichissement non critiques
// (timestamp d'affichage) où un échec ne doit pas faire perdre l'event.
// Une seule reprise : inutile de dépenser du quota pour du cosmétique.
async function callFallbackRpcSoft(chainId, method, params) {
  try {
    return await callFallbackRpc(chainId, method, params, 1);
  } catch (err) {
    console.warn(`⚠️  ${err.message} — on continue sans cette donnée`);
    return null;
  }
}

// -------- Routescan RPC (proxy module) --------

async function rpcFetch(chainId, params) {
  const apiKey = getRoutescanApiKey(chainId);
  if (!apiKey) {
    throw new Error(`ROUTESCAN_API_KEY missing in .env (chain ${chainId})`);
  }

  const u = new URL(
    `${ROUTESCAN_API_URL}/v2/network/${ROUTESCAN_NETWORK_ID}/evm/${chainId}/etherscan/api`
  );
  u.searchParams.set("module", "proxy");
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }

  // Vérifier si la chain est en cooldown 429
  const cooldown = chainCooldowns.get(chainId);
  if (cooldown && Date.now() < cooldown.until) {
    return null;
  }

  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    await sleep(ROUTESCAN_DELAY_MS);
    const res = await fetch(u.toString(), {
      headers: { apikey: apiKey }
    });
    if (res.ok) {
      const json = await res.json();
      // Réinitialiser le cooldown si succès
      if (chainCooldowns.has(chainId)) chainCooldowns.delete(chainId);
      return json?.result ?? null;
    }
    if (res.status === 429) {
      const prev = chainCooldowns.get(chainId);
      const level = Math.min((prev?.level ?? -1) + 1, COOLDOWN_DURATIONS.length - 1);
      const duration = COOLDOWN_DURATIONS[level];
      chainCooldowns.set(chainId, { until: Date.now() + duration, level });
      console.warn(
        `⚠️  Routescan 429 rate-limit (chain ${chainId}, action=${params.action}) — cooldown ${duration / 1000}s (niveau ${level + 1}/${COOLDOWN_DURATIONS.length})`
      );
      return null; // pas de sleep, on rend la main immédiatement
    }
    if (res.status === 500 && attempt < RPC_MAX_RETRIES) {
      const backoff = 600 * Math.pow(2, attempt);
      console.warn(
        `⚠️  Routescan 500 (chain ${chainId}, action=${params.action}), retry ${attempt + 1}/${RPC_MAX_RETRIES} dans ${backoff}ms…`
      );
      await sleep(backoff);
      continue;
    }
    console.error("❌ Routescan HTTP error:", res.status, await res.text());
    return null;
  }
  return null;
}

async function getCurrentBlock(chainId) {
  // Alchemy en primaire si disponible
  const alchemy = await callFallbackRpcSoft(chainId, "eth_blockNumber", []);
  if (alchemy) return parseInt(alchemy, 16);
  // Routescan en backup
  const result = await rpcFetch(chainId, { action: "eth_blockNumber" });
  if (result) return parseInt(result, 16);
  return 0;
}

// Retourne le bloc avec ses transactions complètes (boolean=true → full tx objects)
async function getBlockByNumber(chainId, blockNumber) {
  const tag = "0x" + blockNumber.toString(16);
  // Alchemy en primaire si disponible
  const alchemy = await callFallbackRpcSoft(chainId, "eth_getBlockByNumber", [tag, true]);
  if (alchemy) return alchemy;
  // Routescan en backup
  return rpcFetch(chainId, { action: "eth_getBlockByNumber", tag, boolean: "true" });
}

// Retourne le receipt d'une transaction (logs inclus)
async function getTransactionReceipt(chainId, txHash) {
  // Alchemy en primaire si disponible
  const alchemy = await callFallbackRpcSoft(chainId, "eth_getTransactionReceipt", [txHash]);
  if (alchemy) return alchemy;
  // Routescan en backup
  return rpcFetch(chainId, { action: "eth_getTransactionReceipt", txhash: txHash });
}

// -------- Traitement d'un log --------

// Construit la map topic0 → config pour un vault (lowercase keys)
function buildTopicMap(vault) {
  const map = new Map();
  for (const [topic, config] of Object.entries(vault.trackedEventsMap || {})) {
    map.set(topic.toLowerCase(), config);
  }
  return map;
}

function processLog({ vault, topicMap, tx, log, chainId, blockTimestamp }) {
  const vaultAddrLc = vault.vaultAddress.toLowerCase();
  const logAddr = (log.address || "").toLowerCase();
  if (logAddr !== vaultAddrLc) return null;

  const logTopic0 = (log.topics?.[0] || "").toLowerCase();
  const eventConfig = topicMap.get(logTopic0);
  if (!eventConfig) return null;

  const txHashLc = (tx.hash || "").toLowerCase();
  const logIndex = parseInt(log.logIndex || "0x0", 16);
  const dedupKey = `${chainId}:${txHashLc}:${logIndex}`;
  if (seenKeys.has(dedupKey)) return null;
  seenKeys.add(dedupKey);

  const actionType = eventConfig.action ?? "Unknown";

  // Adresse appelante (depuis topics si indexée, sinon depuis tx.from)
  const callerTopicIdx = eventConfig.callerTopicIndex ?? 1;
  const callerTopic = log.topics?.[callerTopicIdx];
  const from = callerTopic
    ? decodeAddressFromTopic(callerTopic)
    : (tx.from || "").toLowerCase();

  // Whitelist
  const whitelist = Array.isArray(vault.whitelistedAddresses)
    ? vault.whitelistedAddresses.map((a) => a.toLowerCase())
    : [];
  if (whitelist.length > 0 && from && whitelist.includes(from)) {
    console.log(`[${vault.name}] event ignoré (adresse whitelistée): ${from}`);
    return null;
  }

  // Montant
  const tokens = Array.isArray(vault.trackedTokens) ? vault.trackedTokens : [];
  const amountDataSlot = eventConfig.amountDataSlot ?? 0;
  const rawAmount = decodeUint256FromData(log.data, amountDataSlot);

  const tokenIdx = eventConfig.amountTokenIndex ?? 0;
  const tokenMeta = tokens[tokenIdx] ?? tokens[0];
  const dec = Number(tokenMeta?.tokenDecimals ?? 18);
  const sym = tokenMeta?.tokenSymbol ?? "TOKEN";
  const minAmount = Number(tokenMeta?.minAmount ?? 0);

  let amountStr = "N/A";
  if (rawAmount !== null) {
    const amountNum = Number(rawAmount) / Math.pow(10, dec);
    if (minAmount > 0 && amountNum < minAmount) return null;
    amountStr = trimZeros(amountNum.toFixed(Math.min(dec, 8)));
  } else if (minAmount > 0) {
    return null;
  }

  const blockNumber = parseInt(tx.blockNumber || "0x0", 16);
  const timeMs = parseInt(blockTimestamp || "0x0", 16) * 1000;
  const whenIso = new Date(timeMs || Date.now()).toISOString();

  return {
    blockNumber,
    logIndex,
    vaultName: vault.name,
    type: actionType,
    symbol: sym,
    amount: amountStr,
    from,
    hash: tx.hash,
    time: whenIso,
    chainId
  };
}

// -------- Tick par chain --------

async function tickChain(chainId, vaultsByAddr) {
  const cooldown = chainCooldowns.get(chainId);
  if (cooldown && Date.now() < cooldown.until) {
    const remainingSec = Math.ceil((cooldown.until - Date.now()) / 1000);
    console.log(`⏳ Chain ${chainId} en cooldown 429 — encore ${remainingSec}s, skip tick`);
    return;
  }
  if (cooldown && Date.now() >= cooldown.until) {
    console.log(`✅ Chain ${chainId} — cooldown terminé (niveau ${cooldown.level + 1}), reprise`);
    // Ne pas supprimer — on garde le niveau pour que le prochain 429 escalade correctement
    // La suppression se fait uniquement sur succès dans rpcFetch
  }

  const currentBlock = await getCurrentBlock(chainId);
  if (!currentBlock) return;

  const fromBlock = chainPointers.get(chainId) ?? currentBlock;
  if (fromBlock > currentBlock) return;

  const blockRange = getLogsBlockRange(chainId);
  const maxChunks = getMaxChunksPerTick(chainId);
  const toBlock = Math.min(
    currentBlock,
    fromBlock + blockRange * maxChunks - 1
  );

  // Heartbeat de retard : sans ça, un décrochage passe totalement inaperçu
  const lag = currentBlock - fromBlock;
  if (LAG_ALERT_BLOCKS > 0 && lag > LAG_ALERT_BLOCKS) {
    const last = lastLagAlert.get(chainId) ?? 0;
    console.warn(`⚠️  Chain ${chainId} en retard de ${lag} blocs (pointeur ${fromBlock}, tête ${currentBlock})`);
    if (Date.now() - last > LAG_ALERT_COOLDOWN_MS) {
      lastLagAlert.set(chainId, Date.now());
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Tracker en retard</b>\nChain <b>${chainId}</b> : ${lag} blocs de retard\nPointeur ${fromBlock} / tête ${currentBlock}`
      );
    }
  }

  // Construire les filtres : adresses des vaults + topic0s trackés
  const addresses = [...vaultsByAddr.keys()];
  const allTopics = new Set();
  for (const vault of vaultsByAddr.values()) {
    for (const topic of Object.keys(vault.trackedEventsMap || {})) {
      allTopics.add(topic.toLowerCase());
    }
  }

  // eth_getLogs en chunks. Le pointeur n'avancera QUE jusqu'au dernier chunk
  // réellement réussi : un chunk en échec est rescanné au tick suivant plutôt
  // que perdu en silence (les events déjà alertés sont filtrés par seenKeys).
  const logs = [];
  let lastGoodBlock = fromBlock - 1;
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += blockRange) {
    const chunkTo = Math.min(chunkFrom + blockRange - 1, toBlock);
    let chunkLogs;
    try {
      chunkLogs = await callFallbackRpc(chainId, "eth_getLogs", [{
        fromBlock: "0x" + chunkFrom.toString(16),
        toBlock:   "0x" + chunkTo.toString(16),
        address:   addresses,
        topics:    [[...allTopics]]
      }]);
    } catch (err) {
      console.error(
        `❌ Chain ${chainId} — scan interrompu aux blocs ${chunkFrom}-${chunkTo} : ${err.message}. ` +
        `Pointeur figé à ${lastGoodBlock + 1}, reprise au prochain tick.`
      );
      break;
    }
    if (!Array.isArray(chunkLogs)) {
      console.error(
        `❌ Chain ${chainId} — réponse eth_getLogs inattendue sur ${chunkFrom}-${chunkTo}, ` +
        `pointeur figé à ${lastGoodBlock + 1}`
      );
      break;
    }
    logs.push(...chunkLogs);
    lastGoodBlock = chunkTo;
  }

  const allEvents = [];

  if (Array.isArray(logs) && logs.length > 0) {
    // Cache des timestamps de blocs pour éviter les appels dupliqués
    const blockTimestampCache = new Map();

    for (const log of logs) {
      if (log.removed) continue;

      const vaultAddr = (log.address || "").toLowerCase();
      const vault = vaultsByAddr.get(vaultAddr);
      if (!vault) continue;

      const topicMap = buildTopicMap(vault);

      // Timestamp du bloc (avec cache)
      const blockNum = parseInt(log.blockNumber, 16);
      if (!blockTimestampCache.has(blockNum)) {
        const block = await callFallbackRpcSoft(chainId, "eth_getBlockByNumber", [
          "0x" + blockNum.toString(16), false
        ]);
        blockTimestampCache.set(blockNum, block?.timestamp ?? null);
      }

      // Tx UNIQUEMENT si l'adresse appelante n'est pas déjà dans les topics.
      // hash et blockNumber sont déjà portés par le log : dans le cas nominal
      // (tous les vaults ERC-7540/4626 ici) cet appel RPC est inutile.
      const eventConfig = topicMap.get((log.topics?.[0] || "").toLowerCase());
      const callerIdx = eventConfig?.callerTopicIndex ?? 1;
      const tx = log.topics?.[callerIdx]
        ? { hash: log.transactionHash, from: null, blockNumber: log.blockNumber }
        : (await callFallbackRpcSoft(chainId, "eth_getTransactionByHash", [log.transactionHash]))
            ?? { hash: log.transactionHash, from: null, blockNumber: log.blockNumber };

      const event = processLog({
        vault,
        topicMap,
        tx,
        log,
        chainId,
        blockTimestamp: blockTimestampCache.get(blockNum)
      });
      if (event) allEvents.push(event);
    }
  }

  const lastProcessedBlock = lastGoodBlock;

  // Envoi dans l'ordre chronologique (plus ancien → plus récent)
  allEvents.sort((a, b) =>
    a.blockNumber !== b.blockNumber
      ? a.blockNumber - b.blockNumber
      : a.logIndex - b.logIndex
  );

  for (const it of allEvents) {
    const emoji = getEmojiForAction(it.type);
    const txUrl = `https://routescan.io/tx/${it.hash}?chainid=${it.chainId}`;
    const msg =
      `<b>${emoji} ${it.type}</b> on <b>${it.vaultName}</b>\n` +
      `Amount: <b>${it.amount} ${it.symbol}</b>\n` +
      (it.from ? `From: <code>${it.from}</code>\n` : "") +
      `Date: ${it.time}\n` +
      `Tx: ${txUrl}`;
    await sendTelegramMessage(chatId, msg);
  }

  if (lastProcessedBlock < fromBlock) {
    // Aucun chunk n'est passé : on ne touche pas au pointeur
    console.warn(`⚠️  Chain ${chainId}: aucun bloc scanné ce tick, pointeur maintenu à ${fromBlock}`);
    return;
  }

  chainPointers.set(chainId, lastProcessedBlock + 1);
  savePointers();
  console.log(
    `🔎 Chain ${chainId}: blocs ${fromBlock}→${lastProcessedBlock} (${lastProcessedBlock - fromBlock + 1} blocs), events=${allEvents.length}`
  );
}

// -------- Boucle principale --------

async function tickAllChains() {
  if (tickRunning) {
    console.log("⏭️ Tick précédent encore en cours, on passe.");
    return;
  }
  tickRunning = true;
  try {
    await _tickAllChains();
  } finally {
    tickRunning = false;
  }
}

async function _tickAllChains() {
  // Grouper les vaults par chainId
  const vaultsByChain = new Map(); // chainId → Map(addrLc → vault)
  for (const vault of VAULTS) {
    if (!vault.chainId) continue;
    if (
      !vault.trackedEventsMap ||
      Object.keys(vault.trackedEventsMap).length === 0
    ) {
      continue;
    }
    if (!vaultsByChain.has(vault.chainId)) {
      vaultsByChain.set(vault.chainId, new Map());
    }
    vaultsByChain
      .get(vault.chainId)
      .set(vault.vaultAddress.toLowerCase(), vault);
  }

  const chains = [...vaultsByChain.entries()];
  const staggerMs = Math.floor(CHECK_EVERY_MS / chains.length);

  await Promise.all(
    chains.map(([chainId, vaultsByAddr], index) =>
      sleep(index * staggerMs).then(() =>
        tickChain(chainId, vaultsByAddr).catch((err) =>
          console.error(`❌ Erreur sur la chain ${chainId}:`, err)
        )
      )
    )
  );
}

// -------- Persistance des pointeurs --------

function loadPointers() {
  try {
    const raw = JSON.parse(fs.readFileSync(POINTERS_FILE, "utf8"));
    const out = new Map();
    for (const [k, v] of Object.entries(raw)) {
      const chainId = Number(k);
      const block = Number(v);
      if (Number.isInteger(chainId) && Number.isInteger(block) && block > 0) {
        out.set(chainId, block);
      }
    }
    return out;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`❌ Lecture de ${POINTERS_FILE} impossible : ${err.message}`);
    }
    return new Map();
  }
}

function savePointers() {
  try {
    const tmp = `${POINTERS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(chainPointers), null, 2));
    fs.renameSync(tmp, POINTERS_FILE); // écriture atomique
  } catch (err) {
    console.error(`❌ Écriture de ${POINTERS_FILE} impossible : ${err.message}`);
  }
}

// -------- Initialisation --------

async function initializePointers() {
  const chainIds = [...new Set(VAULTS.map((v) => v.chainId).filter(Boolean))];
  const saved = loadPointers();

  for (const chainId of chainIds) {
    try {
      const block = await getCurrentBlock(chainId);
      if (!block) {
        console.error(`❌ Bloc courant indisponible (chain ${chainId}) — chain ignorée ce boot`);
        continue;
      }

      const savedPointer = saved.get(chainId);
      if (!savedPointer) {
        chainPointers.set(chainId, block);
        console.log(`📦 Chain ${chainId} — pas de pointeur sauvegardé, démarrage à la tête : ${block}`);
      } else if (savedPointer > block) {
        // Pointeur en avance sur la tête (reset de chain, mauvais RPC…)
        chainPointers.set(chainId, block);
        console.warn(`⚠️  Chain ${chainId} — pointeur sauvegardé (${savedPointer}) au-delà de la tête (${block}), recalé`);
      } else if (block - savedPointer > MAX_CATCHUP_BLOCKS) {
        const clamped = block - MAX_CATCHUP_BLOCKS;
        chainPointers.set(chainId, clamped);
        const skipped = clamped - savedPointer;
        console.warn(`⚠️  Chain ${chainId} — arrêt trop long : ${block - savedPointer} blocs de retard, reprise à ${clamped} (${skipped} blocs NON scannés)`);
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Trou de scan au démarrage</b>\nChain <b>${chainId}</b> : ${skipped} blocs non scannés (${savedPointer} → ${clamped})\nÀ vérifier manuellement.`
        );
      } else {
        chainPointers.set(chainId, savedPointer);
        console.log(`📦 Chain ${chainId} — reprise au bloc ${savedPointer} (tête : ${block}, ${block - savedPointer} blocs à rattraper)`);
      }
    } catch (err) {
      console.error(
        `❌ Impossible de récupérer le bloc courant (chain ${chainId}):`,
        err
      );
    }
  }
  savePointers();
}

export async function startVaultsTracker() {
  console.log(
    `🚀 gami-vaults-tracker-bot démarré. Check toutes les ${CHECK_INTERVAL_SECONDS}s, ` +
    `max ${MAX_CHUNKS_PER_TICK} chunks eth_getLogs/tick, pointeurs dans ${POINTERS_FILE}.`
  );

  await initializePointers();

  tickAllChains();
  setInterval(tickAllChains, CHECK_EVERY_MS);
}
