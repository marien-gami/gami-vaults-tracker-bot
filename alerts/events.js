// alerts/events.js — Vault log decoding (pure functions, no I/O).

export function trimZeros(s) {
  if (s.indexOf(".") === -1) return s;
  s = s.replace(/0+$/, "");
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

export function getEmojiForAction(actionType) {
  const type = (actionType || "").toLowerCase();
  if (type.includes("request deposit")) return "🟡";
  if (type.includes("request withdraw")) return "🟠";
  if (type.includes("deposit")) return "🟢";
  if (type.includes("withdraw") || type.includes("redeem")) return "🔴";
  return "⚪";
}

// Decodes an EVM address from a 32-byte topic (takes the last 20 bytes)
export function decodeAddressFromTopic(topic) {
  if (!topic || typeof topic !== "string") return "";
  const hex = topic.replace("0x", "");
  if (hex.length < 40) return "";
  return ("0x" + hex.slice(-40)).toLowerCase();
}

// Decodes a uint256 from ABI-encoded data at a given slot (0-based)
export function decodeUint256FromData(data, slotIndex = 0) {
  if (!data || typeof data !== "string") return null;
  const hex = data.replace("0x", "");
  const chunk = hex.slice(slotIndex * 64, slotIndex * 64 + 64);
  if (chunk.length < 64) return null;
  try {
    return BigInt("0x" + chunk);
  } catch {
    return null;
  }
}

// Formats a BigInt as an exact decimal string (no precision loss through Number)
export function formatUnits(raw, decimals, maxFraction = 8) {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, Math.min(decimals, maxFraction));
  const s = trimZeros(frac ? `${intPart}.${frac}` : `${intPart}`);
  return (neg ? "-" : "") + s;
}

// Builds the topic0 → config map for a vault (lowercase keys)
export function buildTopicMap(vault) {
  const map = new Map();
  for (const [topic, config] of Object.entries(vault.trackedEventsMap || {})) {
    map.set(topic.toLowerCase(), config);
  }
  return map;
}

// Turns a raw log into a displayable event, or null if it must be ignored.
// `from` comes from the topics (nominal case) or from txFrom (if not indexed).
export function processLog({ vault, log, chainId, blockTimestamp, txFrom = null }) {
  if ((log.address || "").toLowerCase() !== vault.vaultAddress.toLowerCase()) return null;

  const eventConfig = buildTopicMap(vault).get((log.topics?.[0] || "").toLowerCase());
  if (!eventConfig) return null;

  const callerTopic = log.topics?.[eventConfig.callerTopicIndex ?? 1];
  const from = callerTopic ? decodeAddressFromTopic(callerTopic) : (txFrom || "").toLowerCase();

  const whitelist = (vault.whitelistedAddresses || []).map((a) => a.toLowerCase());
  if (from && whitelist.includes(from)) return null;

  const tokens = vault.trackedTokens || [];
  const tokenMeta = tokens[eventConfig.amountTokenIndex ?? 0] ?? tokens[0];
  const dec = Number(tokenMeta?.tokenDecimals ?? 18);
  const minAmount = Number(tokenMeta?.minAmount ?? 0);

  const rawAmount = decodeUint256FromData(log.data, eventConfig.amountDataSlot ?? 0);
  let amount = "N/A";
  if (rawAmount !== null) {
    if (minAmount > 0 && Number(rawAmount) / 10 ** dec < minAmount) return null;
    amount = formatUnits(rawAmount, dec);
  } else if (minAmount > 0) {
    return null;
  }

  const timeMs = parseInt(blockTimestamp || "0x0", 16) * 1000;

  return {
    blockNumber: parseInt(log.blockNumber || "0x0", 16),
    logIndex: parseInt(log.logIndex || "0x0", 16),
    vaultName: vault.name,
    type: eventConfig.action ?? "Unknown",
    symbol: tokenMeta?.tokenSymbol ?? "TOKEN",
    amount,
    from,
    hash: log.transactionHash,
    time: new Date(timeMs || Date.now()).toISOString(),
    chainId
  };
}

export function formatTelegramMessage(ev) {
  return (
    `<b>${getEmojiForAction(ev.type)} ${ev.type}</b> on <b>${ev.vaultName}</b>\n` +
    `Amount: <b>${ev.amount} ${ev.symbol}</b>\n` +
    (ev.from ? `From: <code>${ev.from}</code>\n` : "") +
    `Date: ${ev.time}\n` +
    `Tx: https://routescan.io/tx/${ev.hash}?chainid=${ev.chainId}`
  );
}
