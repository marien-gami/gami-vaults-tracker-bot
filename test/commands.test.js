import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CHAINS } from "../chains.js";
import { VaultInputError, TYPE_OPTION_LABELS, chainOptionLabel, resolveChainId, resolveType, decodeString } from "../lib/vaultBuilder.js";
import { createCommandHandler, parseAddVaultArgs, workflowInputs, formatVaultList } from "../bot/commands.js";
import { createGithubClient } from "../lib/github.js";

const CHAT = -100123;
const ADMIN = 42;
const ENTRY = {
  name: "Gami Test",
  address: "0x" + "a".repeat(40),
  chainId: 1,
  type: "erc7540",
  asset: { address: "0x" + "b".repeat(40), symbol: "USDC", decimals: 6 },
  share: { symbol: "gamiTest", decimals: 18 }
};

function setup({ github = null, buildEntry = async () => ENTRY } = {}) {
  const calls = [];
  let nextId = 100;
  const api = async (method, body) => {
    calls.push({ method, body });
    return method === "sendMessage" ? { message_id: nextId++ } : true;
  };
  const handler = createCommandHandler({
    api, chatId: CHAT, adminIds: new Set([ADMIN]),
    getEntries: () => [ENTRY], buildEntry, github, logger: { error() {} }
  });
  return { handler, calls };
}

const msg = (text, { from = ADMIN, chat = CHAT, type = "supergroup" } = {}) =>
  ({ message: { text, from: { id: from }, chat: { id: chat, type }, date: Math.floor(Date.now() / 1000) } });

test("workflow options match the bot's labels", () => {
  const yml = fs.readFileSync(new URL("../.github/workflows/add-vault.yml", import.meta.url), "utf8");
  for (const id of Object.keys(CHAINS)) assert.ok(yml.includes(`"${chainOptionLabel(id)}"`), `chain ${id} missing from the workflow`);
  for (const label of Object.values(TYPE_OPTION_LABELS)) assert.ok(yml.includes(`"${label}"`), `type "${label}" missing from the workflow`);
});

test("lenient chain and type resolution", () => {
  assert.equal(resolveChainId("eth"), 1);
  assert.equal(resolveChainId("Base"), 8453);
  assert.equal(resolveChainId("43114 - Avalanche"), 43114);
  assert.equal(resolveChainId("polygon"), null);
  assert.equal(resolveType("7540"), "erc7540");
  assert.equal(resolveType("upshift"), "erc4626");
  assert.equal(resolveType("midas-redeem - Midas RedemptionVault"), "midas-redeem");
  assert.equal(resolveType("foo"), null);
});

test("decodeString: ABI string and bytes32", () => {
  const abi = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("USDC").toString("hex").padEnd(64, "0");
  assert.equal(decodeString(abi), "USDC");
  assert.equal(decodeString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0")), "MKR");
});

test("parseAddVaultArgs: name with spaces + options anywhere", () => {
  assert.deepEqual(
    parseAddVaultArgs("/addvault@GamiBot 0xabc eth midas-redeem asset=0xusdc Gami turtle PST symbol=tPST"),
    { address: "0xabc", chain: "eth", type: "midas-redeem", name: "Gami turtle PST", assetAddress: "0xusdc", shareSymbol: "tPST" }
  );
});

test("workflowInputs: exact workflow values, direct commit", () => {
  const i = workflowInputs(ENTRY, { requestId: "tg-1" });
  assert.equal(i.chain, "1 - Ethereum");
  assert.equal(i.type, TYPE_OPTION_LABELS.erc7540);
  assert.equal(i.direct_commit, "true");
  assert.equal(i.asset_address, "", "asset() is re-read on-chain for erc7540");
  assert.equal(workflowInputs({ ...ENTRY, type: "midas-deposit" }, { requestId: "x" }).asset_address, ENTRY.asset.address);
});

test("/vaults lists by chain; /help answers", async () => {
  const { handler, calls } = setup();
  await handler.handleUpdate(msg("/vaults"));
  assert.match(calls[0].body.text, /1 vaults tracked[\s\S]*Ethereum[\s\S]*Gami Test/);
  await handler.handleUpdate(msg("/help@GamiBot", { from: 7 }));
  assert.match(calls[1].body.text, /addvault/);
  assert.match(formatVaultList([{ ...ENTRY, name: "<b>x" }]), /&lt;b&gt;x/, "HTML escaped");
});

test("ignores unauthorized chats", async () => {
  const { handler, calls } = setup();
  await handler.handleUpdate(msg("/vaults", { chat: 999 }));
  await handler.handleUpdate(msg("/vaults", { chat: 555, from: 7, type: "private" }));
  assert.equal(calls.length, 0);
  // an admin in a private chat is allowed
  await handler.handleUpdate(msg("/vaults", { chat: ADMIN, type: "private" }));
  assert.equal(calls.length, 1);
});

test("/addvault refused to non-admins (showing their user ID)", async () => {
  const { handler, calls } = setup();
  await handler.handleUpdate(msg("/addvault 0xabc eth 7540 X", { from: 7 }));
  assert.match(calls[0].body.text, /Admins only[\s\S]*<code>7<\/code>/);
});

test("/addvault without GITHUB_TOKEN → explicit message", async () => {
  const { handler, calls } = setup({ github: null });
  await handler.handleUpdate(msg("/addvault 0xabc eth 7540 X"));
  assert.match(calls[0].body.text, /GITHUB_TOKEN/);
});

test("/addvault: on-chain error shown cleanly", async () => {
  const { handler, calls } = setup({ github: {}, buildEntry: async () => { throw new VaultInputError("no contract at 0xabc on Base"); } });
  await handler.handleUpdate(msg("/addvault 0xabc base 7540 X"));
  assert.equal(calls.at(-1).method, "editMessageText");
  assert.match(calls.at(-1).body.text, /❌ no contract/);
});

test("/addvault: preview → only the author confirms → workflow triggered → result", async () => {
  let dispatched;
  let resolveRun;
  const github = {
    dispatchAddVault: async (inputs) => { dispatched = inputs; },
    waitForRun: () => new Promise((r) => { resolveRun = r; })
  };
  const { handler, calls } = setup({ github });

  await handler.handleUpdate(msg("/addvault 0xabc eth 7540 Gami Test"));
  const preview = calls.at(-1);
  assert.equal(preview.method, "editMessageText");
  assert.match(preview.body.text, /Add this vault[\s\S]*USDC<\/b> \(6 dec\.\)[\s\S]*gamiTest/);
  const okData = preview.body.reply_markup.inline_keyboard[0][0].callback_data;
  const cbMessage = { chat: { id: CHAT }, message_id: 100 };

  // another member cannot confirm
  await handler.handleUpdate({ callback_query: { id: "c1", data: okData, from: { id: 7 }, message: cbMessage } });
  assert.equal(dispatched, undefined);
  assert.match(calls.at(-1).body.text, /Only the author/);

  // the author confirms
  await handler.handleUpdate({ callback_query: { id: "c2", data: okData, from: { id: ADMIN }, message: cbMessage } });
  assert.equal(dispatched.chain, "1 - Ethereum");
  assert.equal(dispatched.direct_commit, "true");
  assert.match(dispatched.request_id, /^tg-[0-9a-f]+$/);
  assert.match(calls.at(-1).body.text, /workflow running/);

  // a second click does nothing (request consumed)
  await handler.handleUpdate({ callback_query: { id: "c3", data: okData, from: { id: ADMIN }, message: cbMessage } });
  assert.match(calls.at(-1).body.text, /expired/);

  resolveRun({ status: "success", url: "https://github.com/x" });
  await new Promise((r) => setImmediate(r));
  assert.match(calls.at(-1).body.text, /✅ <b>Gami Test<\/b> added/);
});

test("/addvault: cancel", async () => {
  const github = { dispatchAddVault: async () => assert.fail("must not be called") };
  const { handler, calls } = setup({ github });
  await handler.handleUpdate(msg("/addvault 0xabc eth 7540 Gami Test"));
  const noData = calls.at(-1).body.reply_markup.inline_keyboard[0][1].callback_data;
  await handler.handleUpdate({ callback_query: { id: "c", data: noData, from: { id: ADMIN }, message: { chat: { id: CHAT }, message_id: 100 } } });
  assert.match(calls.at(-1).body.text, /cancelled/);
});

test("github client: dispatch then follow the run by request_id", async () => {
  const reqs = [];
  let polls = 0;
  const fetchImpl = async (url, init) => {
    reqs.push({ url, init });
    if (init.method === "POST") return { status: 204, ok: true, json: async () => ({}) };
    polls++;
    const run = { display_title: "Add vault: X tg-abc", status: polls < 2 ? "in_progress" : "completed", conclusion: "success", html_url: "https://gh/run/1" };
    return { status: 200, ok: true, json: async () => ({ workflow_runs: [{ display_title: "other", status: "completed" }, run] }) };
  };
  const gh = createGithubClient({ token: "t", repo: "o/r", fetchImpl });
  await gh.dispatchAddVault({ name: "X" });
  assert.equal(reqs[0].url, "https://api.github.com/repos/o/r/actions/workflows/add-vault.yml/dispatches");
  assert.deepEqual(JSON.parse(reqs[0].init.body), { ref: "main", inputs: { name: "X" } });
  assert.equal(reqs[0].init.headers.Authorization, "Bearer t");
  const res = await gh.waitForRun("tg-abc", { pollMs: 0, sleep: async () => {} });
  assert.deepEqual(res, { status: "success", url: "https://gh/run/1" });
});

test("github client: HTTP error surfaced with GitHub's message", async () => {
  const fetchImpl = async () => ({ status: 403, ok: false, json: async () => ({ message: "Resource not accessible by personal access token" }) });
  const gh = createGithubClient({ token: "t", repo: "o/r", fetchImpl });
  await assert.rejects(gh.dispatchAddVault({}), /403 Resource not accessible/);
});
