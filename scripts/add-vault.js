#!/usr/bin/env node
// scripts/add-vault.js — Adds a vault to vaults.json by reading its data on-chain.
//
// Usage:
//   npm run add-vault -- --name "Gami WBTC" --address 0x… --chain 1 --type erc7540
//
// Read on-chain automatically (can be overridden with options):
//   erc4626 / erc7540 : asset() → asset address, symbol, decimals; share symbol/decimals
//   midas-deposit     : --asset-address required (payment token, e.g. USDC)
//   midas-redeem      : mToken() → share; --asset-address required (payment token)
//
// Options: --asset-address --asset-symbol --asset-decimals
//          --share-address --share-symbol --share-decimals --dry-run

import fs from "node:fs";
import { parseArgs } from "node:util";
import { CHAINS } from "../chains.js";
import { createRpcClient } from "../alerts/rpc.js";
import { VAULT_TYPES, VAULTS_FILE, loadVaultEntries } from "../vaultsConfig.js";
import { buildVaultEntry } from "../lib/vaultBuilder.js";

const { values: opts } = parseArgs({
  options: {
    name: { type: "string" },
    address: { type: "string" },
    chain: { type: "string" },
    type: { type: "string" },
    "asset-address": { type: "string" },
    "asset-symbol": { type: "string" },
    "asset-decimals": { type: "string" },
    "share-address": { type: "string" },
    "share-symbol": { type: "string" },
    "share-decimals": { type: "string" },
    "dry-run": { type: "boolean", default: false }
  }
});

async function main() {
  const entries = loadVaultEntries();
  const entry = await buildVaultEntry(
    {
      name: opts.name,
      address: opts.address,
      chain: opts.chain,
      type: opts.type,
      assetAddress: opts["asset-address"],
      assetSymbol: opts["asset-symbol"],
      assetDecimals: opts["asset-decimals"],
      shareAddress: opts["share-address"],
      shareSymbol: opts["share-symbol"],
      shareDecimals: opts["share-decimals"]
    },
    { rpc: createRpcClient({ logger: { log() {}, warn() {} } }), entries }
  );

  console.log(`✅ Vault ready (${VAULT_TYPES[entry.type].label}):\n${JSON.stringify(entry, null, 2)}`);
  if (entry.type.startsWith("midas")) console.log("ℹ️  Midas: event amounts are base18 — handled automatically.");

  if (opts["dry-run"]) {
    console.log("(dry-run: vaults.json not modified)");
    return;
  }
  fs.writeFileSync(VAULTS_FILE, JSON.stringify([...entries, entry], null, 2) + "\n");
  console.log(`💾 Added to vaults.json (${entries.length + 1} vaults)`);

  // Output for GitHub Actions (commit message)
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${entry.name} (${CHAINS[entry.chainId].name}, ${entry.type})\n`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
