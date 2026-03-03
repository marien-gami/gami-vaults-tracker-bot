// index.js
import "dotenv/config";
import { startVaultsTracker } from "./alerts/vaultsTracker.js";

async function main() {
  console.log("🤖 gami-vaults-tracker-bot booting...");
  await startVaultsTracker();
}

main().catch(console.error);
