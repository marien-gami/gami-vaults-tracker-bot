// bot/commands.js — Commandes Telegram : /help, /vaults, /addvault.
//
// Toutes les dépendances sont injectées (API Telegram, GitHub, RPC…) pour être testables.
//
// /addvault : aperçu on-chain → bouton ✅ → workflow GitHub "Add vault" (commit direct
// sur main) → Render redéploie → le vault est suivi.

import crypto from "node:crypto";
import { CHAINS } from "../chains.js";
import { VAULT_TYPES } from "../vaultsConfig.js";
import { TYPE_OPTION_LABELS, chainOptionLabel, VaultInputError } from "../lib/vaultBuilder.js";

const PENDING_TTL_MS = 10 * 60_000;

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const HELP_TEXT =
  `<b>Commandes</b>\n` +
  `/vaults — liste des vaults suivis\n` +
  `/addvault — ajouter un vault (admins)\n\n` +
  `<b>Ajouter un vault</b>\n` +
  `<code>/addvault &lt;adresse&gt; &lt;chain&gt; &lt;type&gt; &lt;nom&gt;</code>\n` +
  `Ex. <code>/addvault 0xabc… eth 7540 Gami WBTC</code>\n\n` +
  `Chains : ${Object.entries(CHAINS).map(([id, c]) => `${c.name} (${id})`).join(", ")}\n` +
  `Types : <code>7540</code> (Lagoon, T3tris), <code>4626</code> (Upshift), ` +
  `<code>midas-deposit</code>, <code>midas-redeem</code>\n\n` +
  `Options : <code>asset=0x…</code> (token de paiement, obligatoire pour Midas), ` +
  `<code>symbol=XXX</code> (forcer le symbole de la share)\n\n` +
  `Symbole et décimales sont lus on-chain ; un aperçu est affiché avant confirmation.`;

// "/addvault@MonBot 0x… eth 7540 Gami WBTC asset=0x…" → champs
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
  const parts = [`<b>${entries.length} vaults suivis</b>`];
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
    ? `Share : <b>${escapeHtml(entry.share.symbol)}</b> (${entry.share.decimals} déc.)` +
      (entry.share.address ? ` <code>${short(entry.share.address)}</code>` : "") + "\n"
    : "";
  return (
    `<b>Ajouter ce vault ?</b>\n\n` +
    `Nom : <b>${escapeHtml(entry.name)}</b>\n` +
    `Adresse : <code>${entry.address}</code>\n` +
    `Chain : ${escapeHtml(CHAINS[entry.chainId].name)} (${entry.chainId})\n` +
    `Type : ${escapeHtml(VAULT_TYPES[entry.type].label)}\n` +
    `Asset : <b>${escapeHtml(entry.asset.symbol)}</b> (${entry.asset.decimals} déc.) <code>${short(entry.asset.address)}</code>\n` +
    share +
    (entry.type.startsWith("midas") ? `<i>Midas : montants en base18, géré automatiquement.</i>\n` : "") +
    `\nLe vault sera poussé sur main et suivi après le redéploiement (~2-3 min).`
  );
}

// Valeurs exactes attendues par .github/workflows/add-vault.yml
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
 * deps :
 *   api(method, body)            → appel API Telegram
 *   chatId                       → chat autorisé (groupe des alertes)
 *   adminIds: Set<number>        → users autorisés à /addvault
 *   getEntries()                 → vaults.json actuel
 *   buildEntry(input)            → Promise<entry> (lève VaultInputError)
 *   github | null                → client lib/github.js (null = /addvault désactivé)
 *   logger
 */
export function createCommandHandler(deps) {
  const { api, chatId, adminIds, getEntries, buildEntry, github, logger = console } = deps;
  const pending = new Map();   // id → { entry, userId, shareSymbolOverride, expires }
  const inFlight = new Set();  // "chainId:address" en cours d'ajout (avant redéploiement)

  const reply = (chat, text, extra = {}) =>
    api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

  const isAllowedChat = (msg) =>
    String(msg.chat.id) === String(chatId) || (msg.chat.type === "private" && adminIds.has(msg.from?.id));

  async function onAddVault(msg) {
    const userId = msg.from?.id;
    if (!adminIds.has(userId)) {
      return reply(msg.chat.id, `⛔ Réservé aux admins. Ton user ID Telegram : <code>${userId}</code> (à ajouter dans ADMIN_USER_IDS).`);
    }
    if (!github) {
      return reply(msg.chat.id, "⚙️ /addvault désactivé : GITHUB_TOKEN manquant dans la config du bot.");
    }
    const input = parseAddVaultArgs(msg.text);
    if (!input.address || !input.chain || !input.type || !input.name) {
      return reply(msg.chat.id, `Usage : <code>/addvault &lt;adresse&gt; &lt;chain&gt; &lt;type&gt; &lt;nom&gt;</code>\nVoir /help`);
    }

    const wait = await reply(msg.chat.id, "🔎 Lecture du contrat on-chain…");
    let entry;
    try {
      entry = await buildEntry(input);
    } catch (err) {
      const text = err instanceof VaultInputError ? `❌ ${escapeHtml(err.message)}` : `❌ Erreur : ${escapeHtml(err.message)}`;
      return api("editMessageText", { chat_id: msg.chat.id, message_id: wait.message_id, text, parse_mode: "HTML" });
    }
    const key = `${entry.chainId}:${entry.address.toLowerCase()}`;
    if (inFlight.has(key)) {
      return api("editMessageText", { chat_id: msg.chat.id, message_id: wait.message_id, text: "⏳ Ce vault est déjà en cours d'ajout." });
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
          { text: "✅ Confirmer", callback_data: `av:ok:${id}` },
          { text: "❌ Annuler", callback_data: `av:no:${id}` }
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
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Demande expirée, relance /addvault." });
      return edit("⌛ Demande expirée.");
    }
    if (cb.from.id !== p.userId) {
      return api("answerCallbackQuery", { callback_query_id: cb.id, text: "Seul l'auteur de la demande peut confirmer." });
    }
    pending.delete(id);

    if (action === "no") {
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Annulé" });
      return edit(`🚫 Ajout de <b>${escapeHtml(p.entry.name)}</b> annulé.`);
    }

    const key = `${p.entry.chainId}:${p.entry.address.toLowerCase()}`;
    inFlight.add(key);
    await api("answerCallbackQuery", { callback_query_id: cb.id, text: "C'est parti" });
    const requestId = `tg-${id}`;
    try {
      await github.dispatchAddVault(workflowInputs(p.entry, { shareSymbolOverride: p.shareSymbolOverride, requestId }));
    } catch (err) {
      inFlight.delete(key);
      logger.error(`❌ ${err.message}`);
      return edit(`❌ Impossible de lancer le workflow GitHub : ${escapeHtml(err.message)}`);
    }
    await edit(`⏳ Ajout de <b>${escapeHtml(p.entry.name)}</b> en cours (workflow GitHub)…`);

    // Suivi en arrière-plan : ne bloque pas la réception des autres commandes
    github.waitForRun(requestId).then(async ({ status, url }) => {
      if (status !== "success") inFlight.delete(key);
      const text = status === "success"
        ? `✅ <b>${escapeHtml(p.entry.name)}</b> ajouté à vaults.json. Suivi actif après le redéploiement Render (~2-3 min).`
        : status === "timeout"
          ? `⌛ Workflow toujours en cours pour <b>${escapeHtml(p.entry.name)}</b> : <a href="${url}">voir sur GitHub</a>`
          : `❌ Échec de l'ajout de <b>${escapeHtml(p.entry.name)}</b> (${status}) : <a href="${url}">voir les logs</a>`;
      await edit(text).catch((e) => logger.error(`❌ ${e.message}`));
    });
  }

  // Point d'entrée : un objet Update de l'API Telegram
  async function handleUpdate(update) {
    if (update.callback_query) return onCallback(update.callback_query);

    const msg = update.message;
    if (!msg?.text?.startsWith("/")) return;
    if (!isAllowedChat(msg)) return; // silence total hors du groupe / des admins

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
