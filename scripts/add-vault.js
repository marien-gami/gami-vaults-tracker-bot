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
import { VAULT_TYPES, VAULTS_FILE, loadVaultEntries, validateVaultEntries } from "../vaultsConfig.js";

const SELECTORS = {
  asset: "0x38d52e0f",
  mToken: "0xc3b6f939",
  symbol: "0x95d89b41",
  decimals: "0x313ce567"
};

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

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const blank = (s) => (s ?? "").trim() || undefined;
const name = blank(opts.name);
const address = blank(opts.address);
const chainId = Number(blank(opts.chain)?.match(/^\d+/)?.[0]); // accepte "1" ou "1 - Ethereum"
const type = blank(opts.type)?.split(" ")[0];

if (!name) fail("--name requis");
if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) fail("--address invalide");
if (!CHAINS[chainId]) fail(`--chain inconnue. Chains : ${Object.entries(CHAINS).map(([id, c]) => `${id} (${c.name})`).join(", ")}`);
if (!VAULT_TYPES[type]) fail(`--type inconnu. Types : ${Object.keys(VAULT_TYPES).join(", ")}`);

const rpc = createRpcClient({ logger: { log() {}, warn() {} } });

async function ethCall(to, data) {
  try {
    const res = await rpc.call(chainId, "eth_call", [{ to, data }, "latest"], { retries: 1 });
    return res && res !== "0x" ? res : null;
  } catch {
    return null;
  }
}

const decodeAddress = (hex) => (hex ? "0x" + hex.slice(-40) : null);
const decodeUint = (hex) => (hex ? Number(BigInt(hex)) : null);

// Gère les deux encodages de symbol() : string ABI dynamique ou bytes32
function decodeString(hex) {
  if (!hex) return null;
  const h = hex.slice(2);
  const fromBytes = (b) => Buffer.from(b, "hex").toString("utf8").replace(/\0+$/, "");
  if (h.length >= 128 && BigInt("0x" + h.slice(0, 64)) === 32n) {
    const len = Number(BigInt("0x" + h.slice(64, 128)));
    return fromBytes(h.slice(128, 128 + len * 2));
  }
  return fromBytes(h.slice(0, 64));
}

async function tokenMeta(tokenAddress) {
  const [symbol, decimals] = await Promise.all([
    ethCall(tokenAddress, SELECTORS.symbol).then(decodeString),
    ethCall(tokenAddress, SELECTORS.decimals).then(decodeUint)
  ]);
  return { symbol, decimals };
}

async function main() {
  const entries = loadVaultEntries();
  if (entries.some((v) => v.chainId === chainId && v.address.toLowerCase() === address.toLowerCase())) {
    fail(`${address} est déjà suivi sur la chain ${chainId}`);
  }

  const code = await rpc.call(chainId, "eth_getCode", [address, "latest"]).catch((e) => fail(e.message));
  if (!code || code === "0x") fail(`aucun contrat à ${address} sur ${CHAINS[chainId].name} — mauvaise chain ?`);

  const vt = VAULT_TYPES[type];
  const isMidas = type.startsWith("midas");

  // Asset
  let assetAddress = blank(opts["asset-address"]);
  if (!assetAddress && !isMidas) {
    assetAddress = decodeAddress(await ethCall(address, SELECTORS.asset));
    if (!assetAddress) fail(`asset() a échoué sur ${address} : ce n'est pas un vault ${type} ?`);
  }
  if (!assetAddress) fail("--asset-address requis pour un vault Midas (token de paiement, ex. USDC)");
  const assetOnChain = await tokenMeta(assetAddress);
  const asset = {
    address: assetAddress,
    symbol: blank(opts["asset-symbol"]) ?? assetOnChain.symbol,
    decimals: opts["asset-decimals"] ? Number(opts["asset-decimals"]) : assetOnChain.decimals
  };

  const entry = { name, address, chainId, type, asset };

  // Share
  if (vt.needsShare) {
    let shareAddress = blank(opts["share-address"]);
    if (!shareAddress && isMidas) {
      shareAddress = decodeAddress(await ethCall(address, SELECTORS.mToken));
      if (!shareAddress) fail(`mToken() a échoué sur ${address} : ce n'est pas un vault Midas ?`);
    }
    const shareOnChain = await tokenMeta(shareAddress ?? address);
    entry.share = {
      ...(shareAddress && shareAddress.toLowerCase() !== address.toLowerCase() ? { address: shareAddress } : {}),
      symbol: blank(opts["share-symbol"]) ?? shareOnChain.symbol,
      decimals: opts["share-decimals"] ? Number(opts["share-decimals"]) : shareOnChain.decimals
    };
  }

  const errors = validateVaultEntries([...entries, entry]);
  if (errors.length) fail(`entrée invalide :\n  - ${errors.join("\n  - ")}\n(utilise --asset-symbol / --share-decimals… pour compléter)`);

  console.log(`✅ Vault prêt (${vt.label}) :\n${JSON.stringify(entry, null, 2)}`);
  if (isMidas) console.log("ℹ️  Midas : montants des events en base18 — géré automatiquement.");

  if (opts["dry-run"]) {
    console.log("(dry-run : vaults.json non modifié)");
    return;
  }
  fs.writeFileSync(VAULTS_FILE, JSON.stringify([...entries, entry], null, 2) + "\n");
  console.log(`💾 Ajouté à vaults.json (${entries.length + 1} vaults)`);

  // Sortie pour GitHub Actions (titre de PR)
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${name} (${CHAINS[chainId].name}, ${type})\n`);
  }
}

main().catch((err) => fail(err.message));
