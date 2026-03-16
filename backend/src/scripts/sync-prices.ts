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
import { syncCommodities, syncAllRealmAuctions } from "../services/auction-sync";
import { syncConnectedRealms } from "../services/realm-sync";

console.log("[SyncPrices] Starting auction data sync...");

try {
  for (const regionId of ACTIVE_REGIONS) {
    console.log(`[SyncPrices] Syncing connected realms for ${regionId}...`);
    await syncConnectedRealms(regionId);

    console.log(`[SyncPrices] Syncing commodities for ${regionId}...`);
    await syncCommodities(regionId);

    console.log(`[SyncPrices] Syncing realm auctions for ${regionId}...`);
    await syncAllRealmAuctions(regionId);
  }
  console.log("[SyncPrices] Done.");
} catch (err) {
  console.error("[SyncPrices] Failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
