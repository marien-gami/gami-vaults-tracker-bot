// lib/vaultBuilder.js — Builds a vaults.json entry from an address by reading
// on-chain data. Shared by scripts/add-vault.js and the Telegram bot.

import { CHAINS } from "../chains.js";
import { VAULT_TYPES, validateVaultEntries } from "../vaultsConfig.js";

const SELECTORS = {
  asset: "0x38d52e0f",
  mToken: "0xc3b6f939",
  symbol: "0x95d89b41",
  decimals: "0x313ce567"
};

export class VaultInputError extends Error {}

// ── Labels shared with .github/workflows/add-vault.yml (checked by the tests)
export const TYPE_OPTION_LABELS = {
  erc7540: "erc7540 - Lagoon / T3tris (Request Deposit / Request Withdraw)",
  erc4626: "erc4626 - Upshift (Deposit / Withdraw)",
  "midas-deposit": "midas-deposit - Midas DepositVault",
  "midas-redeem": "midas-redeem - Midas RedemptionVault"
};
export const chainOptionLabel = (chainId) => `${chainId} - ${CHAINS[chainId].name}`;

// ── Lenient resolution of user input
const CHAIN_ALIASES = {
  eth: 1, ethereum: 1, mainnet: 1,
  base: 8453,
  avax: 43114, avalanche: 43114,
  hemi: 43111,
  flare: 14,
  robinhood: 4663, rh: 4663
};
export function resolveChainId(input) {
  const s = String(input ?? "").trim().toLowerCase();
  const n = Number(s.match(/^\d+/)?.[0]);
  if (CHAINS[n]) return n;
  return CHAIN_ALIASES[s] ?? null;
}

const TYPE_ALIASES = {
  "7540": "erc7540", lagoon: "erc7540", t3tris: "erc7540",
  "4626": "erc4626", upshift: "erc4626",
  "midas-deposit": "midas-deposit", "midas-redeem": "midas-redeem"
};
export function resolveType(input) {
  const s = String(input ?? "").trim().toLowerCase().split(" ")[0];
  if (VAULT_TYPES[s]) return s;
  return TYPE_ALIASES[s] ?? null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const decodeAddress = (hex) => (hex ? "0x" + hex.slice(-40) : null);
const decodeUint = (hex) => (hex ? Number(BigInt(hex)) : null);

// Handles both symbol() encodings: dynamic ABI string or bytes32
export function decodeString(hex) {
  if (!hex) return null;
  const h = hex.slice(2);
  const fromBytes = (b) => Buffer.from(b, "hex").toString("utf8").replace(/\0+$/, "");
  if (h.length >= 128 && BigInt("0x" + h.slice(0, 64)) === 32n) {
    const len = Number(BigInt("0x" + h.slice(64, 128)));
    return fromBytes(h.slice(128, 128 + len * 2));
  }
  return fromBytes(h.slice(0, 64));
}

/**
 * @param input { name, address, chain, type, assetAddress?, assetSymbol?, assetDecimals?,
 *                shareAddress?, shareSymbol?, shareDecimals? }
 * @param deps  { rpc (createRpcClient), entries (current vaults.json) }
 * @returns a validated vaults.json entry — throws VaultInputError otherwise
 */
export async function buildVaultEntry(input, { rpc, entries }) {
  const fail = (msg) => { throw new VaultInputError(msg); };
  const blank = (s) => (s ?? "").toString().trim() || undefined;

  const name = blank(input.name);
  const address = blank(input.address);
  const chainId = resolveChainId(input.chain);
  const type = resolveType(input.type);

  if (!name) fail("missing name");
  if (!ADDRESS_RE.test(address || "")) fail(`invalid address: ${address ?? "(empty)"}`);
  if (!chainId) fail(`unknown chain: ${input.chain}. Chains: ${Object.entries(CHAINS).map(([id, c]) => `${id} (${c.name})`).join(", ")}`);
  if (!type) fail(`unknown type: ${input.type}. Types: ${Object.keys(VAULT_TYPES).join(", ")}`);

  if (entries.some((v) => v.chainId === chainId && v.address.toLowerCase() === address.toLowerCase())) {
    fail(`${address} is already tracked on ${CHAINS[chainId].name}`);
  }

  const ethCall = async (to, data) => {
    try {
      const res = await rpc.call(chainId, "eth_call", [{ to, data }, "latest"], { retries: 1 });
      return res && res !== "0x" ? res : null;
    } catch {
      return null;
    }
  };
  const tokenMeta = async (token) => {
    const [symbol, decimals] = await Promise.all([
      ethCall(token, SELECTORS.symbol).then(decodeString),
      ethCall(token, SELECTORS.decimals).then(decodeUint)
    ]);
    return { symbol, decimals };
  };

  let code;
  try {
    code = await rpc.call(chainId, "eth_getCode", [address, "latest"]);
  } catch (err) {
    fail(`${CHAINS[chainId].name} RPC unavailable: ${err.message}`);
  }
  if (!code || code === "0x") fail(`no contract at ${address} on ${CHAINS[chainId].name} — wrong chain?`);

  const vt = VAULT_TYPES[type];
  const isMidas = type.startsWith("midas");

  // Asset
  let assetAddress = blank(input.assetAddress);
  if (assetAddress && !ADDRESS_RE.test(assetAddress)) fail(`invalid asset address: ${assetAddress}`);
  if (!assetAddress && !isMidas) {
    assetAddress = decodeAddress(await ethCall(address, SELECTORS.asset));
    if (!assetAddress) fail(`asset() failed on ${address}: not an ${type} vault?`);
  }
  if (!assetAddress) fail("payment token address required for a Midas vault (e.g. USDC)");
  const assetOnChain = await tokenMeta(assetAddress);
  const entry = {
    name,
    address,
    chainId,
    type,
    asset: {
      address: assetAddress,
      symbol: blank(input.assetSymbol) ?? assetOnChain.symbol,
      decimals: input.assetDecimals != null && input.assetDecimals !== "" ? Number(input.assetDecimals) : assetOnChain.decimals
    }
  };

  // Share
  if (vt.needsShare) {
    let shareAddress = blank(input.shareAddress);
    if (!shareAddress && isMidas) {
      shareAddress = decodeAddress(await ethCall(address, SELECTORS.mToken));
      if (!shareAddress) fail(`mToken() failed on ${address}: not a Midas vault?`);
    }
    const shareOnChain = await tokenMeta(shareAddress ?? address);
    entry.share = {
      ...(shareAddress && shareAddress.toLowerCase() !== address.toLowerCase() ? { address: shareAddress } : {}),
      symbol: blank(input.shareSymbol) ?? shareOnChain.symbol,
      decimals: input.shareDecimals != null && input.shareDecimals !== "" ? Number(input.shareDecimals) : shareOnChain.decimals
    };
  }

  const errors = validateVaultEntries([...entries, entry]);
  if (errors.length) fail(`invalid entry: ${errors.join("; ")}`);
  return entry;
}
