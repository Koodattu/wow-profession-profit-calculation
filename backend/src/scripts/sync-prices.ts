/**
 * Sync auction house price data immediately for all active regions.
 * Safe to run at any time — does not touch game data.
 *
 * Run with:
 *   bun run sync-prices
 */

import "../config/env";
import { sql } from "../db";
import { ACTIVE_REGIONS } from "../config/regions";
import { runMarketRefreshCycle } from "../services/market-refresh-cycle";

console.log("[SyncPrices] Starting auction data sync...");

try {
  for (const regionId of ACTIVE_REGIONS) {
    const result = await runMarketRefreshCycle(regionId, "manual");
    console.log(`[SyncPrices] ${regionId} cycle ${result.id}: ${result.status}`);
  }
  console.log("[SyncPrices] Done.");
} catch (err) {
  console.error("[SyncPrices] Failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
