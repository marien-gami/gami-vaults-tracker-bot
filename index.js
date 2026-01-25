// index.js
import "dotenv/config";
import { startVaultsTracker } from "./alerts/vaultsTracker.js";

function main() {
  console.log("🤖 gami-vaults-tracker-bot booting...");
  startVaultsTracker();
}

main();
