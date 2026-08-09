import { eq, or } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { connectedRealms, items } from "../db/schema";
import { createAuctionRefreshModule } from "./auction-refresh";
import { blizzardAuctionSource } from "./blizzard-auction-source";
import { ensureRegionExists } from "./region-sync";

const auctionRefresh = createAuctionRefreshModule({
  source: blizzardAuctionSource,
  realmHistoryIntervalHours: env.REALM_HISTORY_INTERVAL_HOURS,
});

export async function syncCommodities(regionId: string): Promise<void> {
  await ensureRegionExists(regionId);
  console.log(`[AuctionSync] Fetching commodities for ${regionId}...`);
  const result = await auctionRefresh.refreshCommodities(regionId);
  console.log(`[AuctionSync] Commodity sync complete: ${result.rowCount} items`);
}

export async function syncRealmAuctions(
  regionId: string,
  connectedRealmId: number,
  trackedHistoryItemIds?: ReadonlySet<number>,
): Promise<void> {
  console.log(`[AuctionSync] Fetching realm auctions for connected realm ${connectedRealmId}...`);
  const result = await auctionRefresh.refreshRealm(regionId, connectedRealmId, trackedHistoryItemIds);
  console.log(
    `[AuctionSync] Realm sync complete for CR ${connectedRealmId}: ${result.rowCount} variants, ${result.historyRowCount} tracked history rows`,
  );
}

export interface RealmAuctionSyncSummary {
  total: number;
  succeeded: number;
  failed: number;
}

export async function syncAllRealmAuctions(regionId: string): Promise<RealmAuctionSyncSummary> {
  await ensureRegionExists(regionId);
  const realmRows = await db.select({ id: connectedRealms.id }).from(connectedRealms).where(eq(connectedRealms.regionId, regionId));
  if (realmRows.length === 0) throw new Error(`No connected realms are available for ${regionId}`);

  console.log(
    `[AuctionSync] Starting realm auction sync for ${realmRows.length} connected realms in ${regionId} with concurrency ${env.REALM_SYNC_CONCURRENCY}`,
  );
  const failedRealmIds: number[] = [];
  const trackedRows = await db
    .select({ id: items.id })
    .from(items)
    .where(or(eq(items.isReagent, true), eq(items.isCraftedOutput, true)));
  const trackedHistoryItemIds = new Set(trackedRows.map((row) => row.id));
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < realmRows.length) {
      const index = nextIndex++;
      const row = realmRows[index]!;
      try {
        await syncRealmAuctions(regionId, row.id, trackedHistoryItemIds);
      } catch (error) {
        failedRealmIds.push(row.id);
        console.error(`[AuctionSync] Failed to sync CR ${row.id}:`, error);
      } finally {
        completed++;
        console.log(`[AuctionSync] Realm progress: ${completed}/${realmRows.length}`);
      }
    }
  }

  const workerCount = Math.min(env.REALM_SYNC_CONCURRENCY, realmRows.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const summary = { total: realmRows.length, succeeded: realmRows.length - failedRealmIds.length, failed: failedRealmIds.length };
  if (failedRealmIds.length > 0) {
    throw new Error(
      `Realm auction sync for ${regionId} was partial: ${summary.succeeded}/${summary.total} succeeded; failed realm IDs: ${failedRealmIds.join(", ")}`,
    );
  }

  console.log(`[AuctionSync] All realm auctions synced for ${regionId}`);
  return summary;
}
