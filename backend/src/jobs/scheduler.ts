import cron from "node-cron";
import { db } from "../db";
import { professions, commoditySnapshots, realmSnapshots } from "../db/schema";
import { count, desc, eq } from "drizzle-orm";
import { ACTIVE_REGIONS } from "../config/regions";
import { syncCommodities, syncAllRealmAuctions } from "../services/auction-sync";
import { syncConnectedRealms } from "../services/realm-sync";
import { importGameData } from "../services/game-data-import";

const PRICE_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;

function toTimestampMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

async function shouldRunPriceSync(regionId: string): Promise<boolean> {
  const [latestCommodity] = await db
    .select({ snapshotTime: commoditySnapshots.snapshotTime })
    .from(commoditySnapshots)
    .where(eq(commoditySnapshots.regionId, regionId))
    .orderBy(desc(commoditySnapshots.snapshotTime))
    .limit(1);

  const [latestRealm] = await db
    .select({ snapshotTime: realmSnapshots.snapshotTime })
    .from(realmSnapshots)
    .where(eq(realmSnapshots.regionId, regionId))
    .orderBy(desc(realmSnapshots.snapshotTime))
    .limit(1);

  const latestTimestamp = Math.max(toTimestampMs(latestCommodity?.snapshotTime) ?? 0, toTimestampMs(latestRealm?.snapshotTime) ?? 0);

  if (latestTimestamp === 0) {
    return true;
  }

  const elapsedMs = Date.now() - latestTimestamp;
  return elapsedMs >= PRICE_SYNC_MIN_INTERVAL_MS;
}

export function startScheduler(): void {
  // Hourly auction sync — every hour at minute 5
  cron.schedule("5 * * * *", async () => {
    console.log(`[Scheduler] Hourly auction sync started at ${new Date().toISOString()}`);
    for (const regionId of ACTIVE_REGIONS) {
      try {
        const shouldSync = await shouldRunPriceSync(regionId);
        if (!shouldSync) {
          console.log(`[Scheduler] Hourly auction sync skipped for ${regionId} (latest price data is under 1 hour old)`);
          continue;
        }

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
  const existingGame = await db.select({ id: professions.id }).from(professions).limit(1);

  if (existingGame.length === 0) {
    console.log("[Scheduler] No game data found, running full initial sync...");
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
    return;
  }

  // Game data present — check if price data is also present
  const [priceCountRow] = await db.select({ count: count() }).from(commoditySnapshots);
  const snapshotCount = priceCountRow?.count ?? 0;

  if (snapshotCount === 0) {
    console.log("[Scheduler] Game data present but no price data — syncing auction data...");
    try {
      for (const regionId of ACTIVE_REGIONS) {
        await syncConnectedRealms(regionId);
        await syncCommodities(regionId);
      }
    } catch (err) {
      console.error("[Scheduler] Price sync failed:", err);
    }
    console.log("[Scheduler] Price sync complete");
    return;
  }

  console.log("[Scheduler] Data already present, skipping initial sync");
}
