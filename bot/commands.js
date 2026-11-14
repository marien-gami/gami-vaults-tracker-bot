// bot/commands.js — Telegram commands: /help, /vaults, /addvault.
//
// All dependencies are injected (Telegram API, GitHub, RPC…) so this is testable.
//
// /addvault: on-chain preview → ✅ button → GitHub "Add vault" workflow (direct
// commit to main) → Render redeploys → the vault is tracked.

import crypto from "node:crypto";
import { CHAINS } from "../chains.js";
import { VAULT_TYPES } from "../vaultsConfig.js";
import { TYPE_OPTION_LABELS, chainOptionLabel, VaultInputError } from "../lib/vaultBuilder.js";

const PENDING_TTL_MS = 10 * 60_000;

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const HELP_TEXT =
  `<b>Commands</b>\n` +
  `/vaults — list tracked vaults\n` +
  `/addvault — add a vault (admins)\n\n` +
  `<b>Add a vault</b>\n` +
  `<code>/addvault &lt;address&gt; &lt;chain&gt; &lt;type&gt; &lt;name&gt;</code>\n` +
  `E.g. <code>/addvault 0xabc… eth 7540 Gami WBTC</code>\n\n` +
  `Chains: ${Object.entries(CHAINS).map(([id, c]) => `${c.name} (${id})`).join(", ")}\n` +
  `Types: <code>7540</code> (Lagoon, T3tris), <code>4626</code> (Upshift), ` +
  `<code>midas-deposit</code>, <code>midas-redeem</code>\n\n` +
  `Options: <code>asset=0x…</code> (payment token, required for Midas), ` +
  `<code>symbol=XXX</code> (override the share symbol)\n\n` +
  `Symbol and decimals are read on-chain; a preview is shown before confirmation.`;

// "/addvault@MyBot 0x… eth 7540 Gami WBTC asset=0x…" → fields
export function parseAddVaultArgs(text) {
  const tokens = text.trim().split(/\s+/).slice(1);
  const opts = {};
  const rest = [];
  for (const t of tokens) {
    const m = t.match(/^(asset|symbol)=(.+)$/i);
    if (m) opts[m[1].toLowerCase()] = m[2];
    else rest.push(t);
  }
  const [address, chain, type, ...nameParts] = rest;
  return {
    address,
    chain,
    type,
    name: nameParts.join(" "),
    assetAddress: opts.asset,
    shareSymbol: opts.symbol
  };
}

export function formatVaultList(entries) {
  const byChain = new Map();
  for (const v of entries) {
    if (!byChain.has(v.chainId)) byChain.set(v.chainId, []);
    byChain.get(v.chainId).push(v);
  }
  const parts = [`<b>${entries.length} vaults tracked</b>`];
  for (const [chainId, list] of byChain) {
    parts.push(`\n<b>${escapeHtml(CHAINS[chainId]?.name ?? chainId)}</b>`);
    for (const v of list) {
      parts.push(`• ${escapeHtml(v.name)} — <code>${short(v.address)}</code> (${v.type})`);
    }
  }
  return parts.join("\n");
}

export function formatPreview(entry) {
  const share = entry.share
    ? `Share: <b>${escapeHtml(entry.share.symbol)}</b> (${entry.share.decimals} dec.)` +
      (entry.share.address ? ` <code>${short(entry.share.address)}</code>` : "") + "\n"
    : "";
  return (
    `<b>Add this vault?</b>\n\n` +
    `Name: <b>${escapeHtml(entry.name)}</b>\n` +
    `Address: <code>${entry.address}</code>\n` +
    `Chain: ${escapeHtml(CHAINS[entry.chainId].name)} (${entry.chainId})\n` +
    `Type: ${escapeHtml(VAULT_TYPES[entry.type].label)}\n` +
    `Asset: <b>${escapeHtml(entry.asset.symbol)}</b> (${entry.asset.decimals} dec.) <code>${short(entry.asset.address)}</code>\n` +
    share +
    (entry.type.startsWith("midas") ? `<i>Midas: amounts in base18, handled automatically.</i>\n` : "") +
    `\nThe vault will be pushed to main and tracked after the redeploy (~2-3 min).`
  );
}

// Exact values expected by .github/workflows/add-vault.yml
export function workflowInputs(entry, { shareSymbolOverride, requestId }) {
  return {
    name: entry.name,
    address: entry.address,
    chain: chainOptionLabel(entry.chainId),
    type: TYPE_OPTION_LABELS[entry.type],
    asset_address: entry.type.startsWith("midas") ? entry.asset.address : "",
    share_symbol: shareSymbolOverride ?? "",
    direct_commit: "true",
    request_id: requestId
  };
}

/**
 * deps:
 *   api(method, body)            → Telegram API call
 *   chatId                       → allowed chat (the alerts group)
 *   adminIds: Set<number>        → users allowed to /addvault
 *   getEntries()                 → current vaults.json
 *   buildEntry(input)            → Promise<entry> (throws VaultInputError)
 *   github | null                → lib/github.js client (null = /addvault disabled)
 *   logger
 */
export function createCommandHandler(deps) {
  const { api, chatId, adminIds, getEntries, buildEntry, github, logger = console } = deps;
  const pending = new Map();   // id → { entry, userId, shareSymbolOverride, expires }
  const inFlight = new Set();  // "chainId:address" being added (before the redeploy)

  const reply = (chat, text, extra = {}) =>
    api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

  const isAllowedChat = (msg) =>
    String(msg.chat.id) === String(chatId) || (msg.chat.type === "private" && adminIds.has(msg.from?.id));

  async function onAddVault(msg) {
    const userId = msg.from?.id;
    if (!adminIds.has(userId)) {
      return reply(msg.chat.id, `⛔ Admins only. Your Telegram user ID: <code>${userId}</code> (add it to ADMIN_USER_IDS).`);
    }
    if (!github) {
      return reply(msg.chat.id, "⚙️ /addvault is disabled: GITHUB_TOKEN missing from the bot config.");
    }
    const input = parseAddVaultArgs(msg.text);
    if (!input.address || !input.chain || !input.type || !input.name) {
      return reply(msg.chat.id, `Usage: <code>/addvault &lt;address&gt; &lt;chain&gt; &lt;type&gt; &lt;name&gt;</code>\nSee /help`);
    }

    const wait = await reply(msg.chat.id, "🔎 Reading the contract on-chain…");
    let entry;
    try {
      entry = await buildEntry(input);
    } catch (err) {
      const text = err instanceof VaultInputError ? `❌ ${escapeHtml(err.message)}` : `❌ Error: ${escapeHtml(err.message)}`;
      return api("editMessageText", { chat_id: msg.chat.id, message_id: wait.message_id, text, parse_mode: "HTML" });
    }
    const key = `${entry.chainId}:${entry.address.toLowerCase()}`;
    if (inFlight.has(key)) {
      return api("editMessageText", { chat_id: msg.chat.id, message_id: wait.message_id, text: "⏳ This vault is already being added." });
    }

    const id = crypto.randomBytes(6).toString("hex");
    pending.set(id, { entry, userId, shareSymbolOverride: input.shareSymbol, expires: Date.now() + PENDING_TTL_MS });
    return api("editMessageText", {
      chat_id: msg.chat.id,
      message_id: wait.message_id,
      text: formatPreview(entry),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Confirm", callback_data: `av:ok:${id}` },
          { text: "❌ Cancel", callback_data: `av:no:${id}` }
        ]]
      }
    });
  }

  async function onCallback(cb) {
    const m = (cb.data || "").match(/^av:(ok|no):([0-9a-f]+)$/);
    if (!m) return api("answerCallbackQuery", { callback_query_id: cb.id });
    const [, action, id] = m;
    const p = pending.get(id);
    const chat = cb.message.chat.id;
    const messageId = cb.message.message_id;
    const edit = (text) => api("editMessageText", { chat_id: chat, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true });

    if (!p || p.expires < Date.now()) {
      pending.delete(id);
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Request expired, run /addvault again." });
      return edit("⌛ Request expired.");
    }
    if (cb.from.id !== p.userId) {
      return api("answerCallbackQuery", { callback_query_id: cb.id, text: "Only the author of the request can confirm." });
    }
    pending.delete(id);

    if (action === "no") {
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Cancelled" });
      return edit(`🚫 Adding <b>${escapeHtml(p.entry.name)}</b> cancelled.`);
    }

    const key = `${p.entry.chainId}:${p.entry.address.toLowerCase()}`;
    inFlight.add(key);
    await api("answerCallbackQuery", { callback_query_id: cb.id, text: "On it" });
    const requestId = `tg-${id}`;
    try {
      await github.dispatchAddVault(workflowInputs(p.entry, { shareSymbolOverride: p.shareSymbolOverride, requestId }));
    } catch (err) {
      inFlight.delete(key);
      logger.error(`❌ ${err.message}`);
      return edit(`❌ Could not start the GitHub workflow: ${escapeHtml(err.message)}`);
    }
    await edit(`⏳ Adding <b>${escapeHtml(p.entry.name)}</b> (GitHub workflow running)…`);

    // Follow-up in the background: doesn't block other commands
    github.waitForRun(requestId).then(async ({ status, url }) => {
      if (status !== "success") inFlight.delete(key);
      const text = status === "success"
        ? `✅ <b>${escapeHtml(p.entry.name)}</b> added to vaults.json. Tracking starts after the Render redeploy (~2-3 min).`
        : status === "timeout"
          ? `⌛ Workflow still running for <b>${escapeHtml(p.entry.name)}</b>: <a href="${url}">see on GitHub</a>`
          : `❌ Failed to add <b>${escapeHtml(p.entry.name)}</b> (${status}): <a href="${url}">see the logs</a>`;
      await edit(text).catch((e) => logger.error(`❌ ${e.message}`));
    });
  }

  // Entry point: a Telegram API Update object
  async function handleUpdate(update) {
    if (update.callback_query) return onCallback(update.callback_query);

    const msg = update.message;
    if (!msg?.text?.startsWith("/")) return;
    if (!isAllowedChat(msg)) return; // stay silent outside the group / admin DMs

    const command = msg.text.split(/\s+/)[0].split("@")[0].toLowerCase();
    switch (command) {
      case "/start":
      case "/help":
        return reply(msg.chat.id, HELP_TEXT);
      case "/vaults":
        return reply(msg.chat.id, formatVaultList(getEntries()));
      case "/addvault":
        return onAddVault(msg);
      default:
        return undefined;
    }
  }

  return { handleUpdate, _pending: pending };
}
