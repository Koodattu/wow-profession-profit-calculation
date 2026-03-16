import cron from "node-cron";
import { db } from "../db";
import { professions } from "../db/schema";
import { ACTIVE_REGIONS } from "../config/regions";
import { syncCommodities, syncAllRealmAuctions } from "../services/auction-sync";
import { syncConnectedRealms } from "../services/realm-sync";
import { importGameData } from "../services/game-data-import";

export function startScheduler(): void {
  // Hourly auction sync — every hour at minute 5
  cron.schedule("5 * * * *", async () => {
    console.log(`[Scheduler] Hourly auction sync started at ${new Date().toISOString()}`);
    for (const regionId of ACTIVE_REGIONS) {
      try {
        await syncCommodities(regionId);
        await syncAllRealmAuctions(regionId);
      } catch (err) {
        console.error(`[Scheduler] Hourly auction sync failed for ${regionId}:`, err);
      }
    }
    console.log(`[Scheduler] Hourly auction sync finished at ${new Date().toISOString()}`);
  });

  // Daily realm refresh — 04:00
  cron.schedule("0 4 * * *", async () => {
    console.log(`[Scheduler] Daily realm refresh started at ${new Date().toISOString()}`);
    for (const regionId of ACTIVE_REGIONS) {
      try {
        await syncConnectedRealms(regionId);
      } catch (err) {
        console.error(`[Scheduler] Daily realm refresh failed for ${regionId}:`, err);
      }
    }
    console.log(`[Scheduler] Daily realm refresh finished at ${new Date().toISOString()}`);
  });

  console.log("[Scheduler] Cron jobs registered");
}

export async function runInitialSync(): Promise<void> {
  const existing = await db.select({ id: professions.id }).from(professions).limit(1);

  if (existing.length > 0) {
    console.log("[Scheduler] Data already present, skipping initial sync");
    return;
  }

  console.log("[Scheduler] No data found, running initial sync...");

  try {
    console.log("[Scheduler] Initial sync: importing game data");
    await importGameData();

    for (const regionId of ACTIVE_REGIONS) {
      console.log(`[Scheduler] Initial sync: connected realms for ${regionId}`);
      await syncConnectedRealms(regionId);

      console.log(`[Scheduler] Initial sync: commodities for ${regionId}`);
      await syncCommodities(regionId);
    }
  } catch (err) {
    console.error("[Scheduler] Initial sync failed:", err);
  }

  console.log("[Scheduler] Initial sync complete");
}
