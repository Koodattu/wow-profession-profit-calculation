import { and, eq, or, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import {
  auctionSyncRuns,
  commodityLatest,
  commoditySnapshots,
  connectedRealms,
  items,
  realmLatest,
  realmSnapshots,
} from "../db/schema";
import { normalizeRealmVariant, summarizePrices, type PriceEntry, type RealmAuctionIdentity } from "./auction-aggregation";
import { BlizzardApi } from "./blizzard-api";
import { ensureRegionExists } from "./region-sync";

interface CommodityAuction {
  item: { id: number };
  quantity: number;
  unit_price: number;
}

interface CommodityResponse {
  auctions: CommodityAuction[];
}

interface RealmAuction {
  item: RealmAuctionIdentity & { id: number };
  buyout?: number;
  quantity: number;
}

interface RealmAuctionResponse {
  auctions: RealmAuction[];
}

type MarketType = "commodity" | "realm";

function batches<T>(values: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function startSyncRun(regionId: string, scope: MarketType, connectedRealmId?: number): Promise<number> {
  const [run] = await db
    .insert(auctionSyncRuns)
    .values({ regionId, scope, connectedRealmId, status: "running" })
    .returning({ id: auctionSyncRuns.id });
  return run!.id;
}

async function failSyncRun(runId: number, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  await db.update(auctionSyncRuns).set({ status: "failed", finishedAt: new Date(), lastError: message }).where(eq(auctionSyncRuns.id, runId));
}

function groupCommodityAuctions(auctions: CommodityAuction[]): Map<number, PriceEntry[]> {
  const grouped = new Map<number, PriceEntry[]>();
  for (const auction of auctions) {
    if (!Number.isSafeInteger(auction.item.id) || auction.item.id <= 0) continue;
    const entries = grouped.get(auction.item.id) ?? [];
    entries.push({ price: auction.unit_price, quantity: auction.quantity });
    grouped.set(auction.item.id, entries);
  }
  return grouped;
}

export async function syncCommodities(regionId: string): Promise<void> {
  await ensureRegionExists(regionId);
  const runId = await startSyncRun(regionId, "commodity");

  try {
    console.log(`[AuctionSync] Fetching commodities for ${regionId}...`);
    const data = await BlizzardApi.getInstance().get<CommodityResponse>(regionId, "/data/wow/auctions/commodities", "dynamic");
    const observedAt = new Date();
    const grouped = groupCommodityAuctions(data.auctions);
    const latestRows: (typeof commodityLatest.$inferInsert)[] = [];

    for (const [itemId, entries] of grouped) {
      const summary = summarizePrices(entries);
      if (!summary) continue;
      latestRows.push({
        regionId,
        itemId,
        syncRunId: runId,
        observedAt,
        minPrice: summary.minPrice,
        avgPrice: summary.avgPrice,
        medianPrice: summary.medianPrice,
        maxPrice: summary.maxPrice,
        totalQuantity: summary.totalQuantity,
        numAuctions: summary.numAuctions,
        priceP10: summary.priceP10,
        priceP25: summary.priceP25,
      });
    }

    await db.transaction(async (tx) => {
      for (const batch of batches([...grouped.keys()])) {
        await tx
          .insert(items)
          .values(batch.map((id) => ({ id, name: `Item #${id}`, marketType: "commodity", metadataStatus: "pending" })))
          .onConflictDoUpdate({ target: items.id, set: { marketType: "commodity" } });
      }

      await tx.delete(commodityLatest).where(eq(commodityLatest.regionId, regionId));
      for (const batch of batches(latestRows)) await tx.insert(commodityLatest).values(batch);
      for (const batch of batches(latestRows)) {
        await tx.insert(commoditySnapshots).values(
          batch.map((row) => ({
            regionId: row.regionId,
            itemId: row.itemId,
            snapshotTime: observedAt,
            minPrice: row.minPrice,
            avgPrice: row.avgPrice,
            medianPrice: row.medianPrice,
            maxPrice: row.maxPrice,
            totalQuantity: row.totalQuantity,
            numAuctions: row.numAuctions,
            priceP10: row.priceP10,
            priceP25: row.priceP25,
          })),
        );
      }

      await tx
        .update(auctionSyncRuns)
        .set({ status: "succeeded", observedAt, finishedAt: new Date(), rowCount: latestRows.length, lastError: null })
        .where(eq(auctionSyncRuns.id, runId));
    });

    console.log(`[AuctionSync] Commodity sync complete: ${latestRows.length} items from ${data.auctions.length} auctions`);
  } catch (error) {
    await failSyncRun(runId, error);
    throw error;
  }
}

type RealmGroup = {
  itemId: number;
  variant: ReturnType<typeof normalizeRealmVariant>;
  entries: PriceEntry[];
};

export async function syncRealmAuctions(regionId: string, connectedRealmId: number, trackedHistoryItemIds?: ReadonlySet<number>): Promise<void> {
  const runId = await startSyncRun(regionId, "realm", connectedRealmId);

  try {
    console.log(`[AuctionSync] Fetching realm auctions for connected realm ${connectedRealmId}...`);
    const data = await BlizzardApi.getInstance().get<RealmAuctionResponse>(
      regionId,
      `/data/wow/connected-realm/${connectedRealmId}/auctions`,
      "dynamic",
    );
    const observedAt = new Date();
    const [latestHistory] = await db
      .select({ snapshotTime: sql<Date | null>`max(${realmSnapshots.snapshotTime})` })
      .from(realmSnapshots)
      .where(and(eq(realmSnapshots.regionId, regionId), eq(realmSnapshots.connectedRealmId, connectedRealmId)));
    const historyDue =
      !latestHistory?.snapshotTime || observedAt.getTime() - latestHistory.snapshotTime.getTime() >= env.REALM_HISTORY_INTERVAL_HOURS * 60 * 60 * 1_000;
    const historyItemIds =
      trackedHistoryItemIds ??
      new Set(
        (
          await db
            .select({ id: items.id })
            .from(items)
            .where(or(eq(items.isReagent, true), eq(items.isCraftedOutput, true)))
        ).map((row) => row.id),
      );
    const variantGroups = new Map<string, RealmGroup>();
    const historyGroups = new Map<number, PriceEntry[]>();

    for (const auction of data.auctions) {
      if (!auction.buyout || auction.buyout <= 0 || auction.quantity <= 0 || !Number.isSafeInteger(auction.item.id) || auction.item.id <= 0) continue;
      const perUnit = Math.round(auction.buyout / auction.quantity);
      const variant = normalizeRealmVariant(auction.item);
      const groupKey = `${auction.item.id}:${variant.key}`;
      const group = variantGroups.get(groupKey) ?? { itemId: auction.item.id, variant, entries: [] };
      group.entries.push({ price: perUnit, quantity: auction.quantity });
      variantGroups.set(groupKey, group);

      if (historyDue && historyItemIds.has(auction.item.id)) {
        const entries = historyGroups.get(auction.item.id) ?? [];
        entries.push({ price: perUnit, quantity: auction.quantity });
        historyGroups.set(auction.item.id, entries);
      }
    }

    const latestRows: (typeof realmLatest.$inferInsert)[] = [];
    for (const group of variantGroups.values()) {
      const summary = summarizePrices(group.entries);
      if (!summary) continue;
      latestRows.push({
        regionId,
        connectedRealmId,
        itemId: group.itemId,
        variantKey: group.variant.key,
        syncRunId: runId,
        observedAt,
        context: group.variant.context,
        bonusLists: group.variant.bonusLists,
        modifiers: group.variant.modifiers,
        petBreedId: group.variant.petBreedId,
        petLevel: group.variant.petLevel,
        petQualityId: group.variant.petQualityId,
        petSpeciesId: group.variant.petSpeciesId,
        minBuyout: summary.minPrice,
        avgBuyout: summary.avgPrice,
        medianBuyout: summary.medianPrice,
        maxBuyout: summary.maxPrice,
        totalQuantity: summary.totalQuantity,
        numAuctions: summary.numAuctions,
      });
    }

    const historyRows: (typeof realmSnapshots.$inferInsert)[] = [];
    for (const [itemId, entries] of historyGroups) {
      const summary = summarizePrices(entries);
      if (!summary) continue;
      historyRows.push({
        connectedRealmId,
        regionId,
        itemId,
        snapshotTime: observedAt,
        minBuyout: summary.minPrice,
        avgBuyout: summary.avgPrice,
        medianBuyout: summary.medianPrice,
        maxBuyout: summary.maxPrice,
        totalQuantity: summary.totalQuantity,
        numAuctions: summary.numAuctions,
      });
    }

    const marketItemIds = [...new Set(latestRows.map((row) => row.itemId))];
    await db.transaction(async (tx) => {
      for (const batch of batches(marketItemIds)) {
        await tx
          .insert(items)
          .values(batch.map((id) => ({ id, name: `Item #${id}`, marketType: "realm", metadataStatus: "pending" })))
          .onConflictDoUpdate({
            target: items.id,
            set: { marketType: sql`CASE WHEN ${items.marketType} = 'commodity' THEN 'commodity' ELSE 'realm' END` },
          });
      }

      await tx.delete(realmLatest).where(and(eq(realmLatest.regionId, regionId), eq(realmLatest.connectedRealmId, connectedRealmId)));
      for (const batch of batches(latestRows)) await tx.insert(realmLatest).values(batch);
      for (const batch of batches(historyRows)) await tx.insert(realmSnapshots).values(batch);
      await tx
        .update(auctionSyncRuns)
        .set({ status: "succeeded", observedAt, finishedAt: new Date(), rowCount: latestRows.length, lastError: null })
        .where(eq(auctionSyncRuns.id, runId));
    });

    console.log(
      `[AuctionSync] Realm sync complete for CR ${connectedRealmId}: ${latestRows.length} variants, ${historyRows.length} tracked history rows`,
    );
  } catch (error) {
    await failSyncRun(runId, error);
    throw error;
  }
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
