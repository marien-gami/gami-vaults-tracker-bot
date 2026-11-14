#!/usr/bin/env node
// scripts/check-rpcs.js — Live check that every configured RPC works with the
// bot's real filters, then replays the latest events (without sending any
// Telegram message).
//
// Usage: npm run check-rpcs [-- --replay-ranges 5]
//   --replay-ranges N : number of ranges to rescan to find events (default 5)

import "dotenv/config";
import { parseArgs } from "node:util";
import { CHAINS } from "../chains.js";
import { VAULTS } from "../vaultsConfig.js";
import { createRpcClient, getLogsBlockRange, getRpcUrls, redactUrl } from "../alerts/rpc.js";
import { processLog, formatTelegramMessage } from "../alerts/events.js";

const { values: opts } = parseArgs({ options: { "replay-ranges": { type: "string", default: "5" } } });
const replayRanges = parseInt(opts["replay-ranges"], 10);
const quiet = { log() {}, warn() {} };

let failures = 0;

for (const chainId of [...new Set(VAULTS.map((v) => v.chainId))]) {
  const vaults = VAULTS.filter((v) => v.chainId === chainId);
  const addresses = vaults.map((v) => v.vaultAddress.toLowerCase());
  const topics = [[...new Set(vaults.flatMap((v) => Object.keys(v.trackedEventsMap)))]];
  const range = getLogsBlockRange(chainId);
  console.log(`\n━━ Chain ${chainId} (${CHAINS[chainId]?.name}) — ${vaults.length} vault(s), range ${range} blocks`);

  // 1. Each URL on its own
  let workingUrls = 0;
  for (const url of getRpcUrls(chainId)) {
    const single = createRpcClient({ resolveUrls: () => [url], logger: quiet, maxRetries: 0 });
    try {
      const head = await single.call(chainId, "eth_blockNumber", []).then((h) => parseInt(h, 16));
      const t0 = Date.now();
      const logs = await single.getLogs(chainId, { fromBlock: head - range + 1, toBlock: head, addresses, topics });
      console.log(`  ✅ ${redactUrl(url)} — head ${head}, getLogs ${range} blocks OK (${logs.length} logs, ${Date.now() - t0} ms)`);
      workingUrls++;
    } catch (err) {
      console.log(`  ❌ ${redactUrl(url)} — ${err.message}`);
    }
  }
  if (!workingUrls) failures++;

  // 2. Replay the latest events through the full client (with failover)
  const rpc = createRpcClient({ logger: quiet });
  try {
    const head = await rpc.getBlockNumber(chainId);
    const from = head - range * replayRanges + 1;
    const logs = [];
    for (let f = from; f <= head; f += range) {
      logs.push(...await rpc.getLogs(chainId, { fromBlock: f, toBlock: Math.min(f + range - 1, head), addresses, topics }));
    }
    const byAddr = new Map(vaults.map((v) => [v.vaultAddress.toLowerCase(), v]));
    const events = logs
      .map((log) => processLog({ vault: byAddr.get(log.address.toLowerCase()), log, chainId, blockTimestamp: null }))
      .filter(Boolean);
    console.log(`  🔁 Replay ${from}→${head}: ${logs.length} logs, ${events.length} events decoded`);
    for (const ev of events.slice(-3)) {
      console.log("     " + formatTelegramMessage(ev).replace(/<[^>]+>/g, "").replace(/\n/g, "\n     "));
    }
  } catch (err) {
    console.log(`  ❌ Replay failed: ${err.message}`);
    failures++;
  }
}

console.log(failures ? `\n❌ ${failures} chain(s) failing` : "\n✅ All chains responding");
process.exit(failures ? 1 : 0);
