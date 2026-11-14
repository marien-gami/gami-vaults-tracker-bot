import { test } from "node:test";
import assert from "node:assert/strict";
import { createRpcClient, getRpcUrls, getLogsBlockRange, chunk, redactUrl, RpcFailure } from "../alerts/rpc.js";

const quiet = { log() {}, warn() {} };

// Fake fetch: handler(url, body) → { status, json }
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const { status = 200, json } = await handler(url, body, calls.length);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return { impl, calls };
}

test("getRpcUrls: env first (comma-separated list), then defaults, no duplicates", () => {
  const env = { RPC_URL_1: "https://a.example, https://ethereum-rpc.publicnode.com" };
  assert.deepEqual(getRpcUrls(1, env), [
    "https://a.example",
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.mevblocker.io"
  ]);
  assert.deepEqual(getRpcUrls(999, {}), []);
});

test("getLogsBlockRange: per chain > global > chains.js default", () => {
  assert.equal(getLogsBlockRange(1, {}), 2000);
  assert.equal(getLogsBlockRange(1, { LOGS_BLOCK_RANGE: "50" }), 50);
  assert.equal(getLogsBlockRange(1, { LOGS_BLOCK_RANGE: "50", LOGS_BLOCK_RANGE_1: "7" }), 7);
  assert.equal(getLogsBlockRange(999, {}), 10);
});

test("chunk splits into batches", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
});

test("redactUrl hides API keys in the path and query", () => {
  assert.equal(redactUrl("https://eth-mainnet.g.alchemy.com/v2/SECRETKEY1234567890abc"), "eth-mainnet.g.alchemy.com/…");
  assert.equal(redactUrl("https://rpc.example/?apikey=SECRET"), "rpc.example/");
});

test("call: fails over to the next URL on 403, then keeps it as preferred", async () => {
  const { impl, calls } = fakeFetch((url) =>
    url.includes("bad") ? { status: 403, json: {} } : { json: { jsonrpc: "2.0", id: 1, result: "0x10" } }
  );
  const rpc = createRpcClient({ fetchImpl: impl, logger: quiet, resolveUrls: () => ["https://bad", "https://good"], backoffMs: 0 });
  assert.equal(await rpc.getBlockNumber(1), 16);
  assert.deepEqual(calls.map((c) => c.url), ["https://bad", "https://good"]);
  await rpc.getBlockNumber(1);
  assert.equal(calls.at(-1).url, "https://good", "the working URL is tried first");
  assert.equal(calls.length, 3);
});

test("call: a JSON-RPC error is a failure (not an empty result)", async () => {
  const { impl } = fakeFetch(() => ({ json: { error: { code: -32602, message: "A maximum of 10 addresses is allowed" } } }));
  const rpc = createRpcClient({ fetchImpl: impl, logger: quiet, resolveUrls: () => ["https://x"], maxRetries: 1, backoffMs: 0 });
  await assert.rejects(rpc.call(1, "eth_getLogs", [{}]), RpcFailure);
});

test("call: no URL → RpcFailure", async () => {
  const rpc = createRpcClient({ logger: quiet, resolveUrls: () => [] });
  await assert.rejects(rpc.call(1, "eth_blockNumber", []), RpcFailure);
});

test("callSoft: returns null instead of throwing", async () => {
  const { impl } = fakeFetch(() => ({ status: 429, json: {} }));
  const rpc = createRpcClient({ fetchImpl: impl, logger: quiet, resolveUrls: () => ["https://x"], backoffMs: 0 });
  assert.equal(await rpc.callSoft(1, "eth_getBlockByNumber", ["0x1", false]), null);
});

test("getLogs: 14 addresses → 2 calls of ≤10 addresses, logs concatenated", async () => {
  const { impl, calls } = fakeFetch((_, body) => ({
    json: { result: body.params[0].address.map((a) => ({ address: a })) }
  }));
  const rpc = createRpcClient({ fetchImpl: impl, logger: quiet, resolveUrls: () => ["https://x"] });
  const addresses = Array.from({ length: 14 }, (_, i) => "0x" + String(i).padStart(40, "0"));
  const logs = await rpc.getLogs(1, { fromBlock: 100, toBlock: 2099, addresses, topics: [["0xabc"]] });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.body.params[0].address.length), [10, 4]);
  assert.equal(calls[0].body.params[0].fromBlock, "0x64");
  assert.equal(calls[0].body.params[0].toBlock, "0x833");
  assert.deepEqual(calls[0].body.params[0].topics, [["0xabc"]]);
  assert.equal(logs.length, 14);
});

test("getLogs: if one batch fails, the whole range fails (no silent gap)", async () => {
  const { impl } = fakeFetch((_, body, n) =>
    n === 1 ? { json: { result: [] } } : { status: 500, json: {} }
  );
  const rpc = createRpcClient({ fetchImpl: impl, logger: quiet, resolveUrls: () => ["https://x"], maxRetries: 0 });
  const addresses = Array.from({ length: 12 }, (_, i) => "0x" + String(i).padStart(40, "0"));
  await assert.rejects(rpc.getLogs(1, { fromBlock: 1, toBlock: 2, addresses, topics: [] }), RpcFailure);
});

test("LOGS_MAX_ADDRESSES is configurable", async () => {
  const { impl, calls } = fakeFetch(() => ({ json: { result: [] } }));
  const rpc = createRpcClient({ fetchImpl: impl, logger: quiet, resolveUrls: () => ["https://x"], env: { LOGS_MAX_ADDRESSES: "5" } });
  await rpc.getLogs(1, { fromBlock: 1, toBlock: 2, addresses: Array(12).fill("0x" + "1".repeat(40)), topics: [] });
  assert.equal(calls.length, 3);
});
