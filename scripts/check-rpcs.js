#!/usr/bin/env node
// scripts/check-rpcs.js — Vérifie en live que chaque RPC configuré fonctionne
// avec les vrais filtres du bot, puis rejoue les derniers events (sans envoyer
// de message Telegram).
//
// Usage : npm run check-rpcs [-- --replay-ranges 5]
//   --replay-ranges N : nombre de plages à rescanner pour retrouver des events (défaut 5)

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
  console.log(`\n━━ Chain ${chainId} (${CHAINS[chainId]?.name}) — ${vaults.length} vault(s), plage ${range} blocs`);

  // 1. Chaque URL individuellement
  let workingUrls = 0;
  for (const url of getRpcUrls(chainId)) {
    const single = createRpcClient({ resolveUrls: () => [url], logger: quiet, maxRetries: 0 });
    try {
      const head = await single.call(chainId, "eth_blockNumber", []).then((h) => parseInt(h, 16));
      const t0 = Date.now();
      const logs = await single.getLogs(chainId, { fromBlock: head - range + 1, toBlock: head, addresses, topics });
      console.log(`  ✅ ${redactUrl(url)} — tête ${head}, getLogs ${range} blocs OK (${logs.length} logs, ${Date.now() - t0} ms)`);
      workingUrls++;
    } catch (err) {
      console.log(`  ❌ ${redactUrl(url)} — ${err.message}`);
    }
  }
  if (!workingUrls) failures++;

  // 2. Rejeu des derniers events via le client complet (avec repli)
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
    console.log(`  🔁 Rejeu ${from}→${head} : ${logs.length} logs, ${events.length} events décodés`);
    for (const ev of events.slice(-3)) {
      console.log("     " + formatTelegramMessage(ev).replace(/<[^>]+>/g, "").replace(/\n/g, "\n     "));
    }
  } catch (err) {
    console.log(`  ❌ Rejeu impossible : ${err.message}`);
    failures++;
  }
}

console.log(failures ? `\n❌ ${failures} chain(s) en échec` : "\n✅ Toutes les chains répondent");
process.exit(failures ? 1 : 0);
