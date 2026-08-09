/**
 * Reimport all static game data from game-data-parsed/*.json files.
 *
 * Replaces profession-owned catalog relationships while preserving auction-only
 * items and all collected price history.
 *
 * Run with:
 *   bun run reimport
 */

import "../config/env"; // loads .env
import { importGameData } from "../services/game-data-import";
import { sql } from "../db";

console.log("[Reimport] Starting game data reimport...");

try {
  await importGameData();
  console.log("[Reimport] Done. Existing market catalog and price history were preserved.");
} catch (err) {
  console.error("[Reimport] Failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
