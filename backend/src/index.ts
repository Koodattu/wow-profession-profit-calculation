import app from "./app";
import { env } from "./config/env";
import { startScheduler, runInitialSync } from "./jobs/scheduler";
import { initializeDatabase } from "./startup";
import { loadSavedGearData } from "./services/gear-data-sync";

// Migrations and the bundled catalog are required for the API to be usable.
await initializeDatabase();
await loadSavedGearData();

// External price data can refresh in the background after startup.
startScheduler();
runInitialSync().catch((err) => console.error("[Startup] Initial sync error:", err));

console.log(`Copper backend running on port ${env.BACKEND_PORT}`);

export default {
  port: env.BACKEND_PORT,
  fetch: app.fetch,
};
