/**
 * Reimport all static game data from game-data-parsed/*.json files.
 *
 * Clears ALL data (including price history snapshots) because commodity_snapshots
 * has a FK referencing items. Price history will repopulate automatically on the
 * next hourly auction sync (or restart the backend to trigger it).
 *
 * Run with:
 *   bun run reimport
 */

import "../config/env"; // loads .env
import { importGameData } from "../services/game-data-import";
import { sql, db } from "../db";
import { commoditySnapshots, realmSnapshots, commodityDaily, realmDaily } from "../db/schema";

console.log("[Reimport] Starting game data reimport...");
console.log("[Reimport] Clearing price history (will repopulate on next auction sync)...");

try {
  // Snapshot tables reference items.id via FK — must be cleared first
  await db.delete(realmDaily);
  await db.delete(commodityDaily);
  await db.delete(realmSnapshots);
  await db.delete(commoditySnapshots);

  await importGameData();
  console.log("[Reimport] Done. Restart the backend (or wait for the hourly cron) to sync fresh auction data.");
} catch (err) {
  console.error("[Reimport] Failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
