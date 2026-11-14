// index.js
import "dotenv/config";
import { startVaultsTracker } from "./alerts/vaultsTracker.js";
import { startTelegramCommands } from "./bot/telegramBot.js";

async function main() {
  console.log("🤖 gami-vaults-tracker-bot booting...");
  if (process.env.TELEGRAM_COMMANDS !== "off") await startTelegramCommands();
  await startVaultsTracker();
}

main().catch(console.error);
