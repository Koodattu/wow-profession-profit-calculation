import cron from "node-cron";
import { ACTIVE_REGIONS } from "../config/regions";
import { runMarketRefreshCycle } from "../services/market-refresh-cycle";
import { runPriceMaintenance } from "../services/price-maintenance";
import { syncConnectedRealms } from "../services/realm-sync";
import { syncPendingItemMetadata } from "../services/item-metadata-sync";
import { runTrackedJob } from "./tracked-job";

type SchedulerGlobalState = typeof globalThis & {
  __wowSchedulerStarted?: boolean;
};

const schedulerGlobalState = globalThis as SchedulerGlobalState;

async function refreshConnectedRealms(regionId: string): Promise<void> {
  await runTrackedJob(`realm-catalog:${regionId}`, () => syncConnectedRealms(regionId));
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
    () => runForEachRegion("Hourly market refresh", (regionId) => runMarketRefreshCycle(regionId, "scheduled").then(() => undefined)),
    { noOverlap: true, name: "hourly-price-sync" },
  );

  cron.schedule(
    "0 4 * * *",
    () => runForEachRegion("Daily realm refresh", refreshConnectedRealms),
    { noOverlap: true, name: "daily-realm-refresh" },
  );

  cron.schedule(
    "15 3 * * *",
    () => runTrackedJob("price-history-maintenance", runPriceMaintenance),
    { noOverlap: true, name: "daily-price-history-maintenance" },
  );

  cron.schedule(
    "*/5 * * * *",
    () => runForEachRegion("Item metadata sync", (regionId) => runTrackedJob(`item-metadata:${regionId}`, () => syncPendingItemMetadata(regionId)).then(() => undefined)),
    { noOverlap: true, name: "item-metadata-sync" },
  );

  console.log(`[Scheduler] Cron jobs registered in pid ${process.pid}`);
}

export async function runInitialSync(): Promise<void> {
  await runForEachRegion("Startup data sync", async (regionId) => {
    await runMarketRefreshCycle(regionId, "startup");
    await runTrackedJob(`item-metadata:${regionId}`, () => syncPendingItemMetadata(regionId));
  });
  await runTrackedJob("price-history-maintenance", runPriceMaintenance);
}
