// vaultsConfig.js — Charge vaults.json, le valide, et le développe au format
// attendu par le tracker (trackedTokens + trackedEventsMap).
//
// Pour ajouter un vault : GitHub Actions → "Add vault", ou `npm run add-vault`,
// ou à la main dans vaults.json. Chaque entrée :
//   {
//     "name": "Gami WBTC",
//     "address": "0x…",            // contrat qui émet les events
//     "chainId": 1,                 // doit exister dans chains.js
//     "type": "erc7540",            // une clé de VAULT_TYPES ci-dessous
//     "asset": { "address": "0x…", "symbol": "WBTC", "decimals": 8 },
//     "share": { "symbol": "gamiWBTC", "decimals": 18 }   // address = vault par défaut
//   }
// Champs optionnels : "minAmount" dans asset/share, "whitelistedAddresses": [...]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAINS } from "./chains.js";

// ── Topics (keccak256 de la signature d'event) ───────────────────────────────
// Trouver un topic0 : `cast sig-event "EventName(type1,…)"` ou onglet Events d'Etherscan.

export const TOPICS = {
  // Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
  ERC4626_DEPOSIT: "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7",
  // Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
  ERC4626_WITHDRAW: "0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db",
  // DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets)
  ERC7540_DEPOSIT_REQUEST: "0xbb58420bb8ce44e11b84e214cc0de10ce5e7c24d0355b2815c3d758b514cae72",
  // RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares)
  ERC7540_REDEEM_REQUEST: "0x1fdc681a13d8c5da54e301c7ce6542dcde4581e4725043fdab2db12ddc574506",
  // Midas DepositInstant(address indexed user, address indexed tokenIn, uint256 amountUsd, uint256 amountToken, uint256 fee, uint256 minted, bytes32 referrerId)
  MIDAS_DEPOSIT_INSTANT: "0xdd6865ec496cf9bdd5cb1661ab84cf4e86edc877208a54cbf642f69d744530c5",
  // Midas DepositRequest(uint256 indexed requestId, address indexed user, address indexed tokenIn, uint256 amountToken, uint256 amountUsd, uint256 fee, uint256 tokenOutRate, bytes32 referrerId)
  MIDAS_DEPOSIT_REQUEST: "0x3704c9b13a68ac43d7f8a85f2700f0b4f89a11ed9e2bcac5324f0d228d409009",
  // Midas RedeemInstant(address indexed user, address indexed tokenOut, uint256 amount, uint256 feeAmount, uint256 amountTokenOut)
  MIDAS_REDEEM_INSTANT: "0x1af12536d161c2c30ad907b0abe442f94c4a7824f2463585b3fc893275247cce",
  // Midas RedeemRequest(uint256 indexed requestId, address indexed user, address indexed tokenOut, uint256 amountMTokenIn, uint256 feeAmount)
  MIDAS_REDEEM_REQUEST: "0x55ba94d231fa70a45e82b0a1c6a60ef72e41bb2455385128ee5cf8d98c0c1c0e"
};

// ── Types de vault ───────────────────────────────────────────────────────────
// tokens : index 0 = asset, index 1 = share (si needsShare)
// events : topic0 → [action, callerTopicIndex, amountDataSlot, amountTokenIndex]
// forceDecimals : Midas normalise TOUS les montants des events en base18,
//   quelle que soit la décimale réelle du token (USDC 6 → émis en 18).

export const VAULT_TYPES = {
  erc4626: {
    label: "ERC-4626 (Deposit / Withdraw instantanés — ex. Upshift)",
    needsShare: true,
    events: {
      [TOPICS.ERC4626_DEPOSIT]: ["Deposit", 1, 0, 0],   // data[0] = assets
      [TOPICS.ERC4626_WITHDRAW]: ["Withdraw", 1, 0, 0]  // data[0] = assets
    }
  },
  erc7540: {
    label: "ERC-7540 (Request Deposit / Request Withdraw — ex. Lagoon, T3tris)",
    needsShare: true,
    events: {
      [TOPICS.ERC7540_DEPOSIT_REQUEST]: ["Request Deposit", 1, 1, 0],  // data[1] = assets
      [TOPICS.ERC7540_REDEEM_REQUEST]: ["Request Withdraw", 1, 1, 1]   // data[1] = shares
    }
  },
  "midas-deposit": {
    label: "Midas DepositVault",
    needsShare: false,
    forceDecimals: 18,
    events: {
      [TOPICS.MIDAS_DEPOSIT_INSTANT]: ["Deposit", 1, 1, 0],          // data[1] = amountToken
      [TOPICS.MIDAS_DEPOSIT_REQUEST]: ["Request Deposit", 2, 0, 0]   // topics[1] = requestId
    }
  },
  "midas-redeem": {
    label: "Midas RedemptionVault",
    needsShare: true,
    forceDecimals: 18,
    events: {
      [TOPICS.MIDAS_REDEEM_INSTANT]: ["Redeem", 1, 0, 1],            // data[0] = mToken
      [TOPICS.MIDAS_REDEEM_REQUEST]: ["Request Withdraw", 2, 0, 1]   // topics[1] = requestId
    }
  }
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Renvoie la liste des erreurs (vide si OK)
export function validateVaultEntries(entries) {
  const errors = [];
  if (!Array.isArray(entries)) return ["vaults.json doit contenir un tableau"];
  const seen = new Set();
  entries.forEach((v, i) => {
    const where = `vault #${i} (${v?.name ?? "sans nom"})`;
    if (!v || typeof v !== "object") return errors.push(`${where} : entrée invalide`);
    if (!v.name || typeof v.name !== "string") errors.push(`${where} : "name" manquant`);
    if (!ADDRESS_RE.test(v.address || "")) errors.push(`${where} : "address" invalide`);
    if (!CHAINS[v.chainId]) errors.push(`${where} : chainId ${v.chainId} absent de chains.js`);
    const type = VAULT_TYPES[v.type];
    if (!type) {
      errors.push(`${where} : type "${v.type}" inconnu (${Object.keys(VAULT_TYPES).join(", ")})`);
    }
    const tokens = [["asset", v.asset]];
    if (type?.needsShare) tokens.push(["share", v.share]);
    for (const [key, t] of tokens) {
      if (!t || typeof t !== "object") { errors.push(`${where} : "${key}" manquant`); continue; }
      if (!t.symbol) errors.push(`${where} : ${key}.symbol manquant`);
      if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) {
        errors.push(`${where} : ${key}.decimals invalide`);
      }
      if (t.address !== undefined && !ADDRESS_RE.test(t.address)) {
        errors.push(`${where} : ${key}.address invalide`);
      }
    }
    const key = `${v.chainId}:${(v.address || "").toLowerCase()}`;
    if (seen.has(key)) errors.push(`${where} : doublon (même adresse sur la même chain)`);
    seen.add(key);
  });
  return errors;
}

// Entrée vaults.json → objet vault attendu par le tracker
export function expandVault(v) {
  const type = VAULT_TYPES[v.type];
  const toToken = (t, fallbackAddress) => ({
    tokenAddress: t.address ?? fallbackAddress,
    tokenSymbol: t.symbol,
    tokenDecimals: type.forceDecimals ?? t.decimals,
    minAmount: t.minAmount ?? 0
  });

  const trackedTokens = [toToken(v.asset)];
  if (type.needsShare) trackedTokens.push(toToken(v.share, v.address));

  const trackedEventsMap = {};
  for (const [topic, [action, callerTopicIndex, amountDataSlot, amountTokenIndex]] of Object.entries(type.events)) {
    trackedEventsMap[topic] = { action, callerTopicIndex, amountDataSlot, amountTokenIndex };
  }

  return {
    name: v.name,
    vaultAddress: v.address,
    chainId: v.chainId,
    type: v.type,
    ...(v.whitelistedAddresses?.length ? { whitelistedAddresses: v.whitelistedAddresses } : {}),
    trackedTokens,
    trackedEventsMap
  };
}

export const VAULTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "vaults.json");

export function loadVaultEntries(file = VAULTS_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadVaults() {
  const entries = loadVaultEntries();
  const errors = validateVaultEntries(entries);
  if (errors.length) {
    throw new Error(`vaults.json invalide :\n  - ${errors.join("\n  - ")}`);
  }
  return entries.map(expandVault);
}

export const VAULTS = loadVaults();
