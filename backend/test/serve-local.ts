import "./support/local-env";
import app from "../src/app";
import { loadSavedGearData } from "../src/services/gear-data-sync";

await loadSavedGearData();
const server = Bun.serve({ hostname: "127.0.0.1", port: 4112, fetch: app.fetch });
console.log(`Synthetic-data API: ${server.url} (no scheduler or external refreshes)`);
