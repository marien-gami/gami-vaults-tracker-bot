// alerts/vaultsTracker.js — Vault event tracking via eth_getLogs
//
// On each tick, for each chain:
//   1. eth_blockNumber → chain head
//   2. eth_getLogs in ranges (LOGS_BLOCK_RANGE) and address batches (LOGS_MAX_ADDRESSES)
//      from the persisted pointer up to the head
//   3. log decoding (alerts/events.js) → Telegram messages
//   4. the pointer only advances up to the last range that was actually scanned
//
// RPC: see alerts/rpc.js (several URLs per chain, automatic failover) and chains.js.

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

// Max eth_getLogs ranges per tick and per chain (bounds catch-ups).
// With 2000-block ranges, 20 ranges = 40,000 blocks per tick: plenty.
// Per-chain override: MAX_CHUNKS_PER_TICK_<chainId>
const MAX_CHUNKS_PER_TICK = parseInt(process.env.MAX_CHUNKS_PER_TICK || "20", 10);
function getMaxChunksPerTick(chainId) {
  const override = process.env[`MAX_CHUNKS_PER_TICK_${chainId}`];
  return override ? parseInt(override, 10) : MAX_CHUNKS_PER_TICK;
}

// Pointer persistence — without it, every restart starts again from the chain
// head and events that happened during the downtime are lost for good.
const POINTERS_FILE =
  process.env.POINTERS_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".pointers.json");

// Safety net: at boot, never go further back than this
const MAX_CATCHUP_BLOCKS = parseInt(process.env.MAX_CATCHUP_BLOCKS || "100000", 10);

// Telegram alert if the lag exceeds this many blocks (0 = disabled)
const LAG_ALERT_BLOCKS = parseInt(process.env.LAG_ALERT_BLOCKS || "20000", 10);
const LAG_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const lastLagAlert = new Map();

const rpc = createRpcClient();

// chainId → next block to scan
const chainPointers = new Map();

// de-duplication: "chainId:txHash:logIndex" (bounded so it doesn't grow forever)
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

// -------- Per-chain tick --------

async function tickChain(chainId, group) {
  const currentBlock = await getCurrentBlock(chainId);
  if (!currentBlock) return;

  if (!chainPointers.has(chainId)) {
    // Chain skipped at boot (RPC unavailable): start now
    chainPointers.set(chainId, currentBlock);
    savePointers();
  }
  const fromBlock = chainPointers.get(chainId);
  if (fromBlock > currentBlock) return;

  const blockRange = getLogsBlockRange(chainId);
  const toBlock = Math.min(currentBlock, fromBlock + blockRange * getMaxChunksPerTick(chainId) - 1);

  // Lag heartbeat: without it, falling behind goes completely unnoticed
  const lag = currentBlock - fromBlock;
  if (LAG_ALERT_BLOCKS > 0 && lag > LAG_ALERT_BLOCKS) {
    console.warn(`⚠️  Chain ${chainId} is ${lag} blocks behind (pointer ${fromBlock}, head ${currentBlock})`);
    if (Date.now() - (lastLagAlert.get(chainId) ?? 0) > LAG_ALERT_COOLDOWN_MS) {
      lastLagAlert.set(chainId, Date.now());
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Tracker lagging</b>\nChain <b>${chainId}</b>: ${lag} blocks behind\nPointer ${fromBlock} / head ${currentBlock}`
      );
    }
  }

  // Scan range by range. A failed range is rescanned on the next tick
  // (events already alerted are filtered out by seenKeys).
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
        `❌ Chain ${chainId} — scan stopped at blocks ${chunkFrom}-${chunkTo}: ${err.message}. ` +
        `Pointer held at ${lastGoodBlock + 1}, retrying next tick.`
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

  // Send in chronological order
  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  for (const ev of events) await sendTelegramMessage(chatId, formatTelegramMessage(ev));

  if (lastGoodBlock < fromBlock) {
    console.warn(`⚠️  Chain ${chainId}: no block scanned this tick, pointer held at ${fromBlock}`);
    return;
  }

  chainPointers.set(chainId, lastGoodBlock + 1);
  savePointers();
  console.log(
    `🔎 Chain ${chainId}: blocks ${fromBlock}→${lastGoodBlock} (${lastGoodBlock - fromBlock + 1} blocks), events=${events.length}`
  );
}

// -------- Main loop --------

async function tickAllChains() {
  if (tickRunning) {
    console.log("⏭️ Previous tick still running, skipping.");
    return;
  }
  tickRunning = true;
  try {
    const chains = [...VAULTS_BY_CHAIN.entries()];
    const staggerMs = Math.floor(CHECK_EVERY_MS / Math.max(chains.length, 1));
    await Promise.all(
      chains.map(([chainId, group], index) =>
        sleep(index * staggerMs).then(() =>
          tickChain(chainId, group).catch((err) => console.error(`❌ Error on chain ${chainId}:`, err))
        )
      )
    );
  } finally {
    tickRunning = false;
  }
}

// -------- Pointer persistence --------

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
    if (err.code !== "ENOENT") console.error(`❌ Cannot read ${POINTERS_FILE}: ${err.message}`);
    return new Map();
  }
}

function savePointers() {
  try {
    const tmp = `${POINTERS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(chainPointers), null, 2));
    fs.renameSync(tmp, POINTERS_FILE); // atomic write
  } catch (err) {
    console.error(`❌ Cannot write ${POINTERS_FILE}: ${err.message}`);
  }
}

// -------- Initialization --------

async function initializePointers() {
  const saved = loadPointers();

  for (const chainId of VAULTS_BY_CHAIN.keys()) {
    const block = await getCurrentBlock(chainId);
    if (!block) {
      console.error(`❌ Current block unavailable (chain ${chainId}) — retrying next tick`);
      continue;
    }

    const savedPointer = saved.get(chainId);
    if (!savedPointer) {
      chainPointers.set(chainId, block);
      console.log(`📦 Chain ${chainId} — no saved pointer, starting at head: ${block}`);
    } else if (savedPointer > block) {
      chainPointers.set(chainId, block);
      console.warn(`⚠️  Chain ${chainId} — saved pointer (${savedPointer}) is past the head (${block}), reset`);
    } else if (block - savedPointer > MAX_CATCHUP_BLOCKS) {
      const clamped = block - MAX_CATCHUP_BLOCKS;
      chainPointers.set(chainId, clamped);
      const skipped = clamped - savedPointer;
      console.warn(`⚠️  Chain ${chainId} — downtime too long, resuming at ${clamped} (${skipped} blocks NOT scanned)`);
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Scan gap at startup</b>\nChain <b>${chainId}</b>: ${skipped} blocks not scanned (${savedPointer} → ${clamped})\nCheck manually.`
      );
    } else {
      chainPointers.set(chainId, savedPointer);
      console.log(`📦 Chain ${chainId} — resuming at block ${savedPointer} (${block - savedPointer} blocks to catch up)`);
    }
  }
  savePointers();
}

function logRpcSetup() {
  for (const [chainId, group] of VAULTS_BY_CHAIN) {
    const urls = getRpcUrls(chainId).map(redactUrl).join(" → ");
    console.log(
      `🔌 Chain ${chainId} (${CHAINS[chainId]?.name ?? "?"}): ${group.addresses.length} vault(s), ` +
      `range ${getLogsBlockRange(chainId)} blocks, RPC ${urls}`
    );
  }
  const legacy = Object.keys(process.env).filter((k) => /^ALCHEMY_.*_RPC_URL$/.test(k));
  if (legacy.length) {
    console.warn(`⚠️  Ignored variables (replaced by RPC_URL_<chainId>): ${legacy.join(", ")}`);
  }
}

export async function startVaultsTracker() {
  console.log(
    `🚀 gami-vaults-tracker-bot started. Checking every ${CHECK_INTERVAL_SECONDS}s, ` +
    `max ${MAX_CHUNKS_PER_TICK} eth_getLogs ranges/tick, pointers in ${POINTERS_FILE}.`
  );
  logRpcSetup();
  await initializePointers();
  tickAllChains();
  setInterval(tickAllChains, CHECK_EVERY_MS);
}
