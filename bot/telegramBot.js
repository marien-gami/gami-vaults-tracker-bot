// bot/telegramBot.js — Réception des commandes Telegram (long polling getUpdates).

import { telegramApi } from "../telegram.js";
import { loadVaultEntries } from "../vaultsConfig.js";
import { createRpcClient } from "../alerts/rpc.js";
import { buildVaultEntry } from "../lib/vaultBuilder.js";
import { createGithubClient } from "../lib/github.js";
import { createCommandHandler } from "./commands.js";

// Ignore les commandes envoyées pendant que le bot était éteint
const MAX_MESSAGE_AGE_S = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseIds(value) {
  return new Set(
    (value || "").split(",").map((s) => Number(s.trim())).filter(Number.isInteger)
  );
}

export async function startTelegramCommands(env = process.env) {
  const adminIds = parseIds(env.ADMIN_USER_IDS);
  // Render fournit RENDER_GIT_REPO_SLUG ("owner/repo") automatiquement
  const repo = env.GITHUB_REPO || env.RENDER_GIT_REPO_SLUG;
  const github = env.GITHUB_TOKEN && repo
    ? createGithubClient({ token: env.GITHUB_TOKEN, repo, ref: env.GITHUB_REF_BRANCH || "main" })
    : null;

  const entries = loadVaultEntries();
  const rpc = createRpcClient({ logger: { log() {}, warn() {} } });

  const handler = createCommandHandler({
    api: telegramApi,
    chatId: env.CHAT_ID,
    adminIds,
    getEntries: () => entries,
    buildEntry: (input) => buildVaultEntry(input, { rpc, entries }),
    github
  });

  console.log(
    `🤖 Commandes Telegram actives — /addvault ${github ? `→ ${repo}` : "désactivé (GITHUB_TOKEN ou dépôt manquant)"}, ` +
    `${adminIds.size} admin(s)`
  );

  try {
    await telegramApi("setMyCommands", {
      commands: [
        { command: "vaults", description: "Liste des vaults suivis" },
        { command: "addvault", description: "Ajouter un vault (admins)" },
        { command: "help", description: "Aide" }
      ]
    });
  } catch (err) {
    console.warn(`⚠️  setMyCommands : ${err.message}`);
  }

  pollLoop(handler).catch((err) => console.error("❌ Boucle Telegram arrêtée :", err));
}

async function pollLoop(handler) {
  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await telegramApi(
        "getUpdates",
        { offset, timeout: 30, allowed_updates: ["message", "callback_query"] },
        { timeoutMs: 40_000 }
      );
    } catch (err) {
      // 409 : une autre instance poll (chevauchement pendant un déploiement Render)
      if (err.code === 409) console.warn("⚠️  getUpdates 409 : autre instance active, nouvel essai dans 15 s");
      else console.warn(`⚠️  getUpdates : ${err.message}`);
      await sleep(15_000);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const date = update.message?.date;
      if (date && Date.now() / 1000 - date > MAX_MESSAGE_AGE_S) continue;
      try {
        await handler.handleUpdate(update);
      } catch (err) {
        console.error("❌ Commande Telegram :", err.message);
      }
    }
  }
}
