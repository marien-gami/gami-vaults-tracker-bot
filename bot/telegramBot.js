// bot/telegramBot.js — Receives Telegram commands (getUpdates long polling).

import { telegramApi } from "../telegram.js";
import { loadVaultEntries } from "../vaultsConfig.js";
import { createRpcClient } from "../alerts/rpc.js";
import { buildVaultEntry } from "../lib/vaultBuilder.js";
import { createGithubClient } from "../lib/github.js";
import { createCommandHandler } from "./commands.js";

// Ignore commands sent while the bot was down
const MAX_MESSAGE_AGE_S = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseIds(value) {
  return new Set(
    (value || "").split(",").map((s) => Number(s.trim())).filter(Number.isInteger)
  );
}

export async function startTelegramCommands(env = process.env) {
  const adminIds = parseIds(env.ADMIN_USER_IDS);
  // Render provides RENDER_GIT_REPO_SLUG ("owner/repo") automatically
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
    `🤖 Telegram commands enabled — /addvault ${github ? `→ ${repo}` : "disabled (GITHUB_TOKEN or repo missing)"}, ` +
    `${adminIds.size} admin(s)`
  );

  try {
    await telegramApi("setMyCommands", {
      commands: [
        { command: "vaults", description: "List tracked vaults" },
        { command: "addvault", description: "Add a vault (admins)" },
        { command: "help", description: "Help" }
      ]
    });
  } catch (err) {
    console.warn(`⚠️  setMyCommands: ${err.message}`);
  }

  pollLoop(handler).catch((err) => console.error("❌ Telegram loop stopped:", err));
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
      // 409: another instance is polling (overlap during a Render deploy)
      if (err.code === 409) console.warn("⚠️  getUpdates 409: another instance is active, retrying in 15 s");
      else console.warn(`⚠️  getUpdates: ${err.message}`);
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
        console.error("❌ Telegram command:", err.message);
      }
    }
  }
}
