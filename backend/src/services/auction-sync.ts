import { env } from "../config/env";
import { createAuctionRefreshModule, type AuctionRefreshResult } from "./auction-refresh";
import { blizzardAuctionSource } from "./blizzard-auction-source";
import { ensureRegionExists } from "./region-sync";

const auctionRefresh = createAuctionRefreshModule({
  source: blizzardAuctionSource,
  realmHistoryIntervalHours: env.REALM_HISTORY_INTERVAL_HOURS,
});

export async function syncCommodities(regionId: string, cycleId?: number): Promise<AuctionRefreshResult> {
  await ensureRegionExists(regionId);
  console.log(`[AuctionSync] Fetching commodities for ${regionId}...`);
  const result = await auctionRefresh.refreshCommodities(regionId, cycleId);
  console.log(`[AuctionSync] Commodity sync complete: ${result.rowCount} items`);
  return result;
}

export async function syncRealmAuctions(
  regionId: string,
  connectedRealmId: number,
  trackedHistoryItemIds?: ReadonlySet<number>,
  cycleId?: number,
): Promise<AuctionRefreshResult> {
  console.log(`[AuctionSync] Fetching realm auctions for connected realm ${connectedRealmId}...`);
  const result = await auctionRefresh.refreshRealm(regionId, connectedRealmId, trackedHistoryItemIds, cycleId);
  console.log(
    `[AuctionSync] Realm sync complete for CR ${connectedRealmId}: ${result.rowCount} variants, ${result.historyRowCount} tracked history rows`,
  );
  return result;
}
