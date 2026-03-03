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
import { sendTelegramMessage } from "../telegram.js";
import { VAULTS } from "../vaultsConfig.js";

const chatId = process.env.CHAT_ID;

const ROUTESCAN_API_URL =
  process.env.ROUTESCAN_API_URL || "https://api.routescan.io";
const ROUTESCAN_API_KEY = process.env.ROUTESCAN_API_KEY;
const ROUTESCAN_NETWORK_ID = process.env.ROUTESCAN_NETWORK_ID || "mainnet";

const CHECK_INTERVAL_SECONDS = parseInt(
  process.env.CHECK_INTERVAL_SECONDS || "30",
  10
);
const CHECK_EVERY_MS = CHECK_INTERVAL_SECONDS * 1000;

const ROUTESCAN_DELAY_MS = parseInt(
  process.env.ROUTESCAN_DELAY_MS || "300",
  10
);

// Nombre maximum de blocs traités par tick (par chain)
const MAX_BLOCKS_PER_TICK = parseInt(
  process.env.MAX_BLOCKS_PER_TICK || "50",
  10
);

// pointeurs par chain : chainId → nextBlock (number)
const chainPointers = new Map();

// anti-doublons : "chainId:txHash:logIndex"
const seenKeys = new Set();

// verrou pour éviter les ticks overlappants
let tickRunning = false;

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

// -------- Routescan RPC (proxy module) --------

async function rpcFetch(chainId, params) {
  if (!ROUTESCAN_API_KEY) {
    throw new Error("ROUTESCAN_API_KEY missing in .env");
  }
  await sleep(ROUTESCAN_DELAY_MS);
  const u = new URL(
    `${ROUTESCAN_API_URL}/v2/network/${ROUTESCAN_NETWORK_ID}/evm/${chainId}/etherscan/api`
  );
  u.searchParams.set("module", "proxy");
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    headers: { apikey: ROUTESCAN_API_KEY }
  });
  if (!res.ok) {
    console.error("❌ Routescan HTTP error:", res.status, await res.text());
    return null;
  }
  const json = await res.json();
  return json?.result ?? null;
}

async function getCurrentBlock(chainId) {
  const result = await rpcFetch(chainId, { action: "eth_blockNumber" });
  if (!result) return 0;
  return parseInt(result, 16);
}

// Retourne le bloc avec ses transactions complètes (boolean=true → full tx objects)
async function getBlockByNumber(chainId, blockNumber) {
  const tag = "0x" + blockNumber.toString(16);
  return rpcFetch(chainId, {
    action: "eth_getBlockByNumber",
    tag,
    boolean: "true"
  });
}

// Retourne le receipt d'une transaction (logs inclus)
async function getTransactionReceipt(chainId, txHash) {
  return rpcFetch(chainId, {
    action: "eth_getTransactionReceipt",
    txhash: txHash
  });
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
  const currentBlock = await getCurrentBlock(chainId);
  if (!currentBlock) return;

  const fromBlock = chainPointers.get(chainId) ?? currentBlock;

  // Rien de nouveau
  if (fromBlock > currentBlock) return;

  // Ne traiter que MAX_BLOCKS_PER_TICK blocs par tick
  const toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_TICK - 1, currentBlock);

  const allEvents = [];

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
    let block;
    try {
      block = await getBlockByNumber(chainId, blockNum);
    } catch (err) {
      console.error(
        `❌ eth_getBlockByNumber(${blockNum}) chain ${chainId}:`,
        err
      );
      break;
    }

    if (!block || !Array.isArray(block.transactions)) continue;

    // Filtrer les txs dont le destinataire est un vault tracké
    const relevantTxs = block.transactions.filter(
      (tx) => tx?.to && vaultsByAddr.has((tx.to || "").toLowerCase())
    );

    if (relevantTxs.length === 0) continue;

    for (const tx of relevantTxs) {
      const vaultAddrLc = (tx.to || "").toLowerCase();
      const vault = vaultsByAddr.get(vaultAddrLc);
      if (!vault) continue;

      const topicMap = buildTopicMap(vault);
      if (topicMap.size === 0) continue;

      let receipt;
      try {
        receipt = await getTransactionReceipt(chainId, tx.hash);
      } catch (err) {
        console.error(`❌ receipt error (${tx.hash}):`, err);
        continue;
      }

      if (!receipt || !Array.isArray(receipt.logs)) continue;

      // Ignorer les tx échouées
      if (receipt.status === "0x0") continue;

      for (const log of receipt.logs) {
        const event = processLog({
          vault,
          topicMap,
          tx,
          log,
          chainId,
          blockTimestamp: block.timestamp
        });
        if (event) allEvents.push(event);
      }
    }
  }

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

  chainPointers.set(chainId, toBlock + 1);
  console.log(
    `🔎 Chain ${chainId}: blocs ${fromBlock}→${toBlock} (${toBlock - fromBlock + 1} blocs), events=${allEvents.length}`
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

  for (const [chainId, vaultsByAddr] of vaultsByChain) {
    try {
      await tickChain(chainId, vaultsByAddr);
    } catch (err) {
      console.error(`❌ Erreur sur la chain ${chainId}:`, err);
    }
  }
}

// -------- Initialisation --------

async function initializePointers() {
  const chainIds = [...new Set(VAULTS.map((v) => v.chainId).filter(Boolean))];

  for (const chainId of chainIds) {
    try {
      const block = await getCurrentBlock(chainId);
      chainPointers.set(chainId, block);
      console.log(`📦 Chain ${chainId} — bloc courant : ${block}`);
    } catch (err) {
      console.error(
        `❌ Impossible de récupérer le bloc courant (chain ${chainId}):`,
        err
      );
      chainPointers.set(chainId, 0);
    }
  }
}

export async function startVaultsTracker() {
  console.log(
    `🚀 gami-vaults-tracker-bot (block polling) démarré. Check toutes les ${CHECK_INTERVAL_SECONDS}s, max ${MAX_BLOCKS_PER_TICK} blocs/tick.`
  );

  await initializePointers();

  tickAllChains();
  setInterval(tickAllChains, CHECK_EVERY_MS);
}
