import cron from "node-cron";
import { eq, sql } from "drizzle-orm";
import { ACTIVE_REGIONS } from "../config/regions";
import { db } from "../db";
import { connectedRealms } from "../db/schema";
import { syncAllRealmAuctions, syncCommodities } from "../services/auction-sync";
import { getRegionPriceFreshness } from "../services/price-freshness";
import { runPriceMaintenance } from "../services/price-maintenance";
import { syncConnectedRealms } from "../services/realm-sync";
import { runTrackedJob } from "./tracked-job";

type SchedulerGlobalState = typeof globalThis & {
  __wowSchedulerStarted?: boolean;
};

const schedulerGlobalState = globalThis as SchedulerGlobalState;

async function ensureConnectedRealms(regionId: string, force = false): Promise<void> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(connectedRealms)
    .where(eq(connectedRealms.regionId, regionId));

  if (!force && (row?.count ?? 0) > 0) {
    return;
  }

  await runTrackedJob(`realm-catalog:${regionId}`, () => syncConnectedRealms(regionId));
}

async function syncPrices(regionId: string, force = false): Promise<void> {
  const freshness = await getRegionPriceFreshness(regionId);

  if (!force && freshness.commodity.fresh) {
    console.log(`[Scheduler] Commodity sync skipped for ${regionId}; data is fresh`);
  } else {
    await runTrackedJob(`commodity-prices:${regionId}`, () => syncCommodities(regionId));
  }

  if (!force && freshness.realm.fresh) {
    console.log(`[Scheduler] Realm auction sync skipped for ${regionId}; data is fresh`);
  } else {
    await ensureConnectedRealms(regionId);
    await runTrackedJob(`realm-prices:${regionId}`, () => syncAllRealmAuctions(regionId));
  }
}

async function runForEachRegion(label: string, task: (regionId: string) => Promise<void>): Promise<void> {
  console.log(`[Scheduler] ${label} started at ${new Date().toISOString()}`);
  for (const regionId of ACTIVE_REGIONS) {
    try {
      await task(regionId);
    } catch (error) {
      console.error(`[Scheduler] ${label} failed for ${regionId}:`, error);
    }
  }
  console.log(`[Scheduler] ${label} finished at ${new Date().toISOString()}`);
}

export function startScheduler(): void {
  if (schedulerGlobalState.__wowSchedulerStarted) {
    console.log(`[Scheduler] Cron jobs already registered in pid ${process.pid}, skipping duplicate start`);
    return;
  }

  schedulerGlobalState.__wowSchedulerStarted = true;

  cron.schedule(
    "5 * * * *",
    () => runForEachRegion("Hourly price sync", (regionId) => syncPrices(regionId, true)),
    { noOverlap: true, name: "hourly-price-sync" },
  );

  cron.schedule(
    "0 4 * * *",
    () => runForEachRegion("Daily realm refresh", (regionId) => ensureConnectedRealms(regionId, true)),
    { noOverlap: true, name: "daily-realm-refresh" },
  );

  cron.schedule(
    "15 3 * * *",
    () => runTrackedJob("price-history-maintenance", runPriceMaintenance),
    { noOverlap: true, name: "daily-price-history-maintenance" },
  );

  console.log(`[Scheduler] Cron jobs registered in pid ${process.pid}`);
}

export async function runInitialSync(): Promise<void> {
  await runForEachRegion("Startup data sync", async (regionId) => {
    await ensureConnectedRealms(regionId);
    await syncPrices(regionId);
  });
  await runTrackedJob("price-history-maintenance", runPriceMaintenance);
}
