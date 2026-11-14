// alerts/vaultsTracker.js — Suivi des events de vaults via eth_getLogs
//
// À chaque tick et pour chaque chain :
//   1. eth_blockNumber → tête de chaîne
//   2. eth_getLogs par plages (LOGS_BLOCK_RANGE) et paquets d'adresses (LOGS_MAX_ADDRESSES)
//      depuis le pointeur persistant jusqu'à la tête
//   3. décodage des logs (alerts/events.js) → messages Telegram
//   4. le pointeur n'avance que jusqu'à la dernière plage réellement scannée
//
// RPC : voir alerts/rpc.js (plusieurs URLs par chain, repli automatique) et chains.js.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTelegramMessage } from "../telegram.js";
import { VAULTS } from "../vaultsConfig.js";
import { CHAINS } from "../chains.js";
import { createRpcClient, getLogsBlockRange, getRpcUrls, redactUrl } from "./rpc.js";
import { processLog, formatTelegramMessage } from "./events.js";

const chatId = process.env.CHAT_ID;

const CHECK_INTERVAL_SECONDS = parseInt(process.env.CHECK_INTERVAL_SECONDS || "30", 10);
const CHECK_EVERY_MS = CHECK_INTERVAL_SECONDS * 1000;

// Nombre max de plages eth_getLogs par tick et par chain (borne les rattrapages).
// Avec des plages de 2000 blocs, 20 plages = 40 000 blocs par tick : largement assez.
// Override par chain : MAX_CHUNKS_PER_TICK_<chainId>
const MAX_CHUNKS_PER_TICK = parseInt(process.env.MAX_CHUNKS_PER_TICK || "20", 10);
function getMaxChunksPerTick(chainId) {
  const override = process.env[`MAX_CHUNKS_PER_TICK_${chainId}`];
  return override ? parseInt(override, 10) : MAX_CHUNKS_PER_TICK;
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

const rpc = createRpcClient();

// chainId → prochain bloc à scanner
const chainPointers = new Map();

// anti-doublons : "chainId:txHash:logIndex" (borné pour ne pas grossir indéfiniment)
const seenKeys = new Set();
const SEEN_KEYS_MAX = 50_000;
function markSeen(key) {
  if (seenKeys.has(key)) return false;
  seenKeys.add(key);
  if (seenKeys.size > SEEN_KEYS_MAX) seenKeys.delete(seenKeys.values().next().value);
  return true;
}

let tickRunning = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// chainId → { addresses, topics, byAddr }
function groupVaultsByChain() {
  const out = new Map();
  for (const vault of VAULTS) {
    if (!Object.keys(vault.trackedEventsMap || {}).length) continue;
    if (!out.has(vault.chainId)) out.set(vault.chainId, { byAddr: new Map(), topics: new Set() });
    const g = out.get(vault.chainId);
    g.byAddr.set(vault.vaultAddress.toLowerCase(), vault);
    for (const t of Object.keys(vault.trackedEventsMap)) g.topics.add(t.toLowerCase());
  }
  for (const g of out.values()) {
    g.addresses = [...g.byAddr.keys()];
    g.topics = [...g.topics];
  }
  return out;
}

const VAULTS_BY_CHAIN = groupVaultsByChain();

async function getCurrentBlock(chainId) {
  try {
    return await rpc.getBlockNumber(chainId);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 0;
  }
}

// -------- Tick par chain --------

async function tickChain(chainId, group) {
  const currentBlock = await getCurrentBlock(chainId);
  if (!currentBlock) return;

  if (!chainPointers.has(chainId)) {
    // Chain ignorée au boot (RPC indisponible) : on démarre maintenant
    chainPointers.set(chainId, currentBlock);
    savePointers();
  }
  const fromBlock = chainPointers.get(chainId);
  if (fromBlock > currentBlock) return;

  const blockRange = getLogsBlockRange(chainId);
  const toBlock = Math.min(currentBlock, fromBlock + blockRange * getMaxChunksPerTick(chainId) - 1);

  // Heartbeat de retard : sans ça, un décrochage passe totalement inaperçu
  const lag = currentBlock - fromBlock;
  if (LAG_ALERT_BLOCKS > 0 && lag > LAG_ALERT_BLOCKS) {
    console.warn(`⚠️  Chain ${chainId} en retard de ${lag} blocs (pointeur ${fromBlock}, tête ${currentBlock})`);
    if (Date.now() - (lastLagAlert.get(chainId) ?? 0) > LAG_ALERT_COOLDOWN_MS) {
      lastLagAlert.set(chainId, Date.now());
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Tracker en retard</b>\nChain <b>${chainId}</b> : ${lag} blocs de retard\nPointeur ${fromBlock} / tête ${currentBlock}`
      );
    }
  }

  // Scan par plages. Une plage en échec est rescannée au tick suivant
  // (les events déjà alertés sont filtrés par seenKeys).
  const logs = [];
  let lastGoodBlock = fromBlock - 1;
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += blockRange) {
    const chunkTo = Math.min(chunkFrom + blockRange - 1, toBlock);
    try {
      logs.push(...await rpc.getLogs(chainId, {
        fromBlock: chunkFrom,
        toBlock: chunkTo,
        addresses: group.addresses,
        topics: [group.topics]
      }));
      lastGoodBlock = chunkTo;
    } catch (err) {
      console.error(
        `❌ Chain ${chainId} — scan interrompu aux blocs ${chunkFrom}-${chunkTo} : ${err.message}. ` +
        `Pointeur figé à ${lastGoodBlock + 1}, reprise au prochain tick.`
      );
      break;
    }
  }

  const events = [];
  const blockTimestamps = new Map();
  for (const log of logs) {
    if (log.removed) continue;
    const vault = group.byAddr.get((log.address || "").toLowerCase());
    if (!vault) continue;

    const blockNum = parseInt(log.blockNumber, 16);
    if (!blockTimestamps.has(blockNum)) {
      const block = await rpc.callSoft(chainId, "eth_getBlockByNumber", ["0x" + blockNum.toString(16), false]);
      blockTimestamps.set(blockNum, block?.timestamp ?? null);
    }

    const ev = processLog({ vault, log, chainId, blockTimestamp: blockTimestamps.get(blockNum) });
    if (!ev) continue;
    if (!markSeen(`${chainId}:${(log.transactionHash || "").toLowerCase()}:${ev.logIndex}`)) continue;
    events.push(ev);
  }

  // Envoi dans l'ordre chronologique
  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  for (const ev of events) await sendTelegramMessage(chatId, formatTelegramMessage(ev));

  if (lastGoodBlock < fromBlock) {
    console.warn(`⚠️  Chain ${chainId}: aucun bloc scanné ce tick, pointeur maintenu à ${fromBlock}`);
    return;
  }

  chainPointers.set(chainId, lastGoodBlock + 1);
  savePointers();
  console.log(
    `🔎 Chain ${chainId}: blocs ${fromBlock}→${lastGoodBlock} (${lastGoodBlock - fromBlock + 1} blocs), events=${events.length}`
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
    const chains = [...VAULTS_BY_CHAIN.entries()];
    const staggerMs = Math.floor(CHECK_EVERY_MS / Math.max(chains.length, 1));
    await Promise.all(
      chains.map(([chainId, group], index) =>
        sleep(index * staggerMs).then(() =>
          tickChain(chainId, group).catch((err) => console.error(`❌ Erreur sur la chain ${chainId}:`, err))
        )
      )
    );
  } finally {
    tickRunning = false;
  }
}

// -------- Persistance des pointeurs --------

function loadPointers() {
  try {
    const raw = JSON.parse(fs.readFileSync(POINTERS_FILE, "utf8"));
    const out = new Map();
    for (const [k, v] of Object.entries(raw)) {
      const chainId = Number(k);
      const block = Number(v);
      if (Number.isInteger(chainId) && Number.isInteger(block) && block > 0) out.set(chainId, block);
    }
    return out;
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`❌ Lecture de ${POINTERS_FILE} impossible : ${err.message}`);
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
  const saved = loadPointers();

  for (const chainId of VAULTS_BY_CHAIN.keys()) {
    const block = await getCurrentBlock(chainId);
    if (!block) {
      console.error(`❌ Bloc courant indisponible (chain ${chainId}) — nouvel essai au prochain tick`);
      continue;
    }

    const savedPointer = saved.get(chainId);
    if (!savedPointer) {
      chainPointers.set(chainId, block);
      console.log(`📦 Chain ${chainId} — pas de pointeur sauvegardé, démarrage à la tête : ${block}`);
    } else if (savedPointer > block) {
      chainPointers.set(chainId, block);
      console.warn(`⚠️  Chain ${chainId} — pointeur sauvegardé (${savedPointer}) au-delà de la tête (${block}), recalé`);
    } else if (block - savedPointer > MAX_CATCHUP_BLOCKS) {
      const clamped = block - MAX_CATCHUP_BLOCKS;
      chainPointers.set(chainId, clamped);
      const skipped = clamped - savedPointer;
      console.warn(`⚠️  Chain ${chainId} — arrêt trop long, reprise à ${clamped} (${skipped} blocs NON scannés)`);
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Trou de scan au démarrage</b>\nChain <b>${chainId}</b> : ${skipped} blocs non scannés (${savedPointer} → ${clamped})\nÀ vérifier manuellement.`
      );
    } else {
      chainPointers.set(chainId, savedPointer);
      console.log(`📦 Chain ${chainId} — reprise au bloc ${savedPointer} (${block - savedPointer} blocs à rattraper)`);
    }
  }
  savePointers();
}

function logRpcSetup() {
  for (const [chainId, group] of VAULTS_BY_CHAIN) {
    const urls = getRpcUrls(chainId).map(redactUrl).join(" → ");
    console.log(
      `🔌 Chain ${chainId} (${CHAINS[chainId]?.name ?? "?"}) : ${group.addresses.length} vault(s), ` +
      `plage ${getLogsBlockRange(chainId)} blocs, RPC ${urls}`
    );
  }
  const legacy = Object.keys(process.env).filter((k) => /^ALCHEMY_.*_RPC_URL$/.test(k));
  if (legacy.length) {
    console.warn(`⚠️  Variables ignorées (remplacées par RPC_URL_<chainId>) : ${legacy.join(", ")}`);
  }
}

export async function startVaultsTracker() {
  console.log(
    `🚀 gami-vaults-tracker-bot démarré. Check toutes les ${CHECK_INTERVAL_SECONDS}s, ` +
    `max ${MAX_CHUNKS_PER_TICK} plages eth_getLogs/tick, pointeurs dans ${POINTERS_FILE}.`
  );
  logRpcSetup();
  await initializePointers();
  tickAllChains();
  setInterval(tickAllChains, CHECK_EVERY_MS);
}
