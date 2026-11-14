// alerts/events.js — Décodage des logs de vault (fonctions pures, sans I/O).

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

// Décode une adresse EVM depuis un topic 32 bytes (prend les 20 derniers bytes)
export function decodeAddressFromTopic(topic) {
  if (!topic || typeof topic !== "string") return "";
  const hex = topic.replace("0x", "");
  if (hex.length < 40) return "";
  return ("0x" + hex.slice(-40)).toLowerCase();
}

// Décode un uint256 depuis les données ABI-encodées à un slot donné (0-based)
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

// Formate un BigInt en décimal exact (pas de perte de précision via Number)
export function formatUnits(raw, decimals, maxFraction = 8) {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, Math.min(decimals, maxFraction));
  const s = trimZeros(frac ? `${intPart}.${frac}` : `${intPart}`);
  return (neg ? "-" : "") + s;
}

// Construit la map topic0 → config pour un vault (clés en minuscules)
export function buildTopicMap(vault) {
  const map = new Map();
  for (const [topic, config] of Object.entries(vault.trackedEventsMap || {})) {
    map.set(topic.toLowerCase(), config);
  }
  return map;
}

// Transforme un log brut en event affichable, ou null s'il faut l'ignorer.
// `from` peut venir des topics (cas nominal) ou de txFrom (si non indexé).
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
