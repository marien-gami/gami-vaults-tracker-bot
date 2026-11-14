#!/usr/bin/env node
// scripts/add-vault.js — Ajoute un vault à vaults.json en lisant ses infos on-chain.
//
// Usage :
//   npm run add-vault -- --name "Gami WBTC" --address 0x… --chain 1 --type erc7540
//
// Lu automatiquement on-chain (surchargeable par option) :
//   erc4626 / erc7540 : asset() → adresse, symbole, décimales de l'asset ; symbole/décimales de la share
//   midas-deposit     : --asset-address requis (token de paiement, ex. USDC)
//   midas-redeem      : mToken() → share ; --asset-address requis (token de paiement)
//
// Options : --asset-address --asset-symbol --asset-decimals
//           --share-address --share-symbol --share-decimals --dry-run

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

  console.log(`✅ Vault prêt (${VAULT_TYPES[entry.type].label}) :\n${JSON.stringify(entry, null, 2)}`);
  if (entry.type.startsWith("midas")) console.log("ℹ️  Midas : montants des events en base18 — géré automatiquement.");

  if (opts["dry-run"]) {
    console.log("(dry-run : vaults.json non modifié)");
    return;
  }
  fs.writeFileSync(VAULTS_FILE, JSON.stringify([...entries, entry], null, 2) + "\n");
  console.log(`💾 Ajouté à vaults.json (${entries.length + 1} vaults)`);

  // Sortie pour GitHub Actions (message de commit)
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${entry.name} (${CHAINS[entry.chainId].name}, ${entry.type})\n`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
