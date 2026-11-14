// alerts/rpc.js — Client JSON-RPC multi-URL.
//
// - Plusieurs URLs par chain : si l'une échoue (429, 403, timeout, erreur RPC),
//   on passe à la suivante. La dernière URL qui a répondu est réessayée en premier.
// - eth_getLogs découpé en paquets d'adresses : beaucoup de RPC publics plafonnent
//   le nombre d'adresses par requête (publicnode : 10).

import { CHAINS } from "../chains.js";

const RPC_TIMEOUT_MS = 15_000;

// Erreur RPC définitive (toutes les URLs et tentatives épuisées).
// Volontairement distincte d'un résultat vide : un appel qui ÉCHOUE ne doit
// jamais être confondu avec "aucun event sur cette plage".
export class RpcFailure extends Error {}

function splitUrls(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// URLs pour une chain : RPC_URL_<chainId> (prioritaire) puis défauts de chains.js
export function getRpcUrls(chainId, env = process.env) {
  const urls = [
    ...splitUrls(env[`RPC_URL_${chainId}`]),
    ...(CHAINS[chainId]?.rpcUrls ?? [])
  ];
  return [...new Set(urls)];
}

export function getLogsBlockRange(chainId, env = process.env) {
  const perChain = env[`LOGS_BLOCK_RANGE_${chainId}`];
  if (perChain) return parseInt(perChain, 10);
  if (env.LOGS_BLOCK_RANGE) return parseInt(env.LOGS_BLOCK_RANGE, 10);
  return CHAINS[chainId]?.logsBlockRange ?? 10;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Masque les clés d'API éventuelles dans les URLs avant de les logger
export function redactUrl(url) {
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 24 ? "/…" : u.pathname;
    return `${u.host}${tail}`;
  } catch {
    return "url-invalide";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRpcClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  maxRetries = parseInt(env.RPC_MAX_RETRIES || "2", 10),
  maxAddressesPerCall = parseInt(env.LOGS_MAX_ADDRESSES || "10", 10),
  backoffMs = 500,
  logger = console,
  resolveUrls = (chainId) => getRpcUrls(chainId, env)
} = {}) {
  // chainId → index de la dernière URL qui a répondu
  const preferred = new Map();

  async function callOnce(url, method, params) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    return json?.result ?? null;
  }

  // Essaie chaque URL ; recommence la ronde jusqu'à maxRetries fois avec backoff.
  async function call(chainId, method, params, { retries = maxRetries } = {}) {
    const urls = resolveUrls(chainId);
    if (urls.length === 0) {
      throw new RpcFailure(`${method} chain ${chainId} — aucune URL RPC configurée`);
    }
    const start = preferred.get(chainId) ?? 0;
    const order = urls.map((_, i) => (start + i) % urls.length);

    let lastReason = "raison inconnue";
    for (let round = 0; round <= retries; round++) {
      if (round > 0) await sleep(Math.min(backoffMs * 2 ** (round - 1), 8000));
      for (const idx of order) {
        try {
          const result = await callOnce(urls[idx], method, params);
          if (preferred.get(chainId) !== idx) {
            if (preferred.has(chainId)) {
              logger.log(`🔀 Chain ${chainId} — bascule sur ${redactUrl(urls[idx])}`);
            }
            preferred.set(chainId, idx);
          }
          return result;
        } catch (err) {
          lastReason = `${redactUrl(urls[idx])}: ${err?.message ?? err}`;
          logger.warn(
            `⚠️  RPC ${method} chain ${chainId} — ${lastReason} (ronde ${round + 1}/${retries + 1})`
          );
        }
      }
    }
    throw new RpcFailure(
      `${method} chain ${chainId} — échec sur ${urls.length} URL(s) × ${retries + 1} ronde(s) (${lastReason})`
    );
  }

  // Ne lève pas : pour les données non critiques (timestamp d'affichage…)
  async function callSoft(chainId, method, params) {
    try {
      return await call(chainId, method, params, { retries: 0 });
    } catch (err) {
      logger.warn(`⚠️  ${err.message} — on continue sans cette donnée`);
      return null;
    }
  }

  // eth_getLogs sur une plage, en découpant les adresses par paquets.
  // Lève RpcFailure si UN SEUL paquet échoue : la plage entière sera rescannée.
  async function getLogs(chainId, { fromBlock, toBlock, addresses, topics }) {
    const logs = [];
    for (const batch of chunk(addresses, maxAddressesPerCall)) {
      const res = await call(chainId, "eth_getLogs", [{
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
        address: batch,
        topics
      }]);
      if (!Array.isArray(res)) {
        throw new RpcFailure(`eth_getLogs chain ${chainId} — réponse inattendue (${typeof res})`);
      }
      logs.push(...res);
    }
    return logs;
  }

  async function getBlockNumber(chainId) {
    return parseInt(await call(chainId, "eth_blockNumber", [], { retries: 1 }), 16);
  }

  return { call, callSoft, getLogs, getBlockNumber };
}
