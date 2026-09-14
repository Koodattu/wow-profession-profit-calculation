import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auctionSyncRuns,
  commodityLatest,
  commoditySnapshots,
  items,
  realmLatest,
  realmSnapshots,
  type RealmListing,
} from "../db/schema";
import { normalizeRealmVariant, summarizePrices, type PriceEntry, type RealmAuctionIdentity } from "./auction-aggregation";
import { toTimestampMs } from "./freshness-policy";

export interface CommodityAuctionInput {
  item: { id: number };
  quantity: number;
  unit_price: number;
}

export interface RealmAuctionInput {
  id?: number;
  item: RealmAuctionIdentity & { id: number };
  buyout?: number;
  bid?: number;
  time_left?: string;
  quantity: number;
}

export interface AuctionSource {
  fetchCommodityAuctions(regionId: string): Promise<readonly CommodityAuctionInput[]>;
  fetchRealmAuctions(regionId: string, connectedRealmId: number): Promise<readonly RealmAuctionInput[]>;
}

export interface AuctionRefreshResult {
  runId: number;
  observedAt: Date;
  rowCount: number;
  historyRowCount: number;
}

export interface AuctionRefreshModule {
  refreshCommodities(regionId: string, cycleId?: number): Promise<AuctionRefreshResult>;
  refreshRealm(
    regionId: string,
    connectedRealmId: number,
    trackedHistoryItemIds?: ReadonlySet<number>,
    cycleId?: number,
  ): Promise<AuctionRefreshResult>;
}

interface AuctionRefreshDependencies {
  source: AuctionSource;
  realmHistoryIntervalHours: number;
  now?: () => Date;
}

type MarketType = "commodity" | "realm";

type RealmGroup = {
  itemId: number;
  variant: ReturnType<typeof normalizeRealmVariant>;
  entries: PriceEntry[];
  listings: RealmListing[];
};

function batches<T>(values: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function startRefresh(regionId: string, scope: MarketType, connectedRealmId?: number, cycleId?: number): Promise<number> {
  const [run] = await db
    .insert(auctionSyncRuns)
    .values({ cycleId, regionId, scope, connectedRealmId, status: "running" })
    .returning({ id: auctionSyncRuns.id });
  return run!.id;
}

async function failRefresh(runId: number, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  await db
    .update(auctionSyncRuns)
    .set({ status: "failed", finishedAt: new Date(), lastError: message })
    .where(eq(auctionSyncRuns.id, runId));
}

function groupCommodityAuctions(auctions: readonly CommodityAuctionInput[]): Map<number, PriceEntry[]> {
  const grouped = new Map<number, PriceEntry[]>();
  for (const auction of auctions) {
    if (!Number.isSafeInteger(auction.item.id) || auction.item.id <= 0) continue;
    const entries = grouped.get(auction.item.id) ?? [];
    entries.push({ price: auction.unit_price, quantity: auction.quantity });
    grouped.set(auction.item.id, entries);
  }
  return grouped;
}

function groupRealmAuctions(
  auctions: readonly RealmAuctionInput[],
  historyDue: boolean,
  historyItemIds: ReadonlySet<number>,
): { variantGroups: Map<string, RealmGroup>; historyGroups: Map<number, PriceEntry[]> } {
  const variantGroups = new Map<string, RealmGroup>();
  const historyGroups = new Map<number, PriceEntry[]>();

  for (const auction of auctions) {
    if (
      !auction.buyout ||
      !Number.isSafeInteger(auction.buyout) || auction.buyout <= 0 ||
      !Number.isSafeInteger(auction.quantity) || auction.quantity <= 0 ||
      !Number.isSafeInteger(auction.item.id) ||
      auction.item.id <= 0
    ) {
      continue;
    }

    const perUnit = Math.round(auction.buyout / auction.quantity);
    const variant = normalizeRealmVariant(auction.item);
    const groupKey = `${auction.item.id}:${variant.key}`;
    const group = variantGroups.get(groupKey) ?? { itemId: auction.item.id, variant, entries: [], listings: [] };
    group.entries.push({ price: perUnit, quantity: auction.quantity, totalPrice: auction.buyout });
    if (Number.isSafeInteger(auction.id) && auction.id! > 0) {
      group.listings.push({ id: String(auction.id), buyout: auction.buyout, quantity: auction.quantity,
        bid: Number.isSafeInteger(auction.bid) && auction.bid! >= 0 ? auction.bid! : null,
        timeLeft: auction.time_left ?? null });
    }
    variantGroups.set(groupKey, group);

    if (historyDue && historyItemIds.has(auction.item.id)) {
      const entries = historyGroups.get(auction.item.id) ?? [];
      entries.push({ price: perUnit, quantity: auction.quantity, totalPrice: auction.buyout });
      historyGroups.set(auction.item.id, entries);
    }
  }

  return { variantGroups, historyGroups };
}

export function createAuctionRefreshModule(dependencies: AuctionRefreshDependencies): AuctionRefreshModule {
  const { source, realmHistoryIntervalHours, now = () => new Date() } = dependencies;

  if (!Number.isFinite(realmHistoryIntervalHours) || realmHistoryIntervalHours <= 0) {
    throw new Error("realmHistoryIntervalHours must be positive");
  }

  async function refreshCommodities(regionId: string, cycleId?: number): Promise<AuctionRefreshResult> {
    const runId = await startRefresh(regionId, "commodity", undefined, cycleId);

    try {
      const auctions = await source.fetchCommodityAuctions(regionId);
      const observedAt = now();
      const grouped = groupCommodityAuctions(auctions);
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
          totalValue: summary.totalValue,
        });
      }

      const marketItemIds = latestRows.map((row) => row.itemId).sort((left, right) => left - right);
      await db.transaction(async (tx) => {
        for (const batch of batches(marketItemIds)) {
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
              totalValue: row.totalValue,
            })),
          );
        }

        await tx
          .update(auctionSyncRuns)
          .set({ status: "succeeded", observedAt, finishedAt: new Date(), rowCount: latestRows.length, lastError: null })
          .where(eq(auctionSyncRuns.id, runId));
      });

      return { runId, observedAt, rowCount: latestRows.length, historyRowCount: latestRows.length };
    } catch (error) {
      await failRefresh(runId, error);
      throw error;
    }
  }

  async function refreshRealm(
    regionId: string,
    connectedRealmId: number,
    trackedHistoryItemIds?: ReadonlySet<number>,
    cycleId?: number,
  ): Promise<AuctionRefreshResult> {
    const runId = await startRefresh(regionId, "realm", connectedRealmId, cycleId);

    try {
      const auctions = await source.fetchRealmAuctions(regionId, connectedRealmId);
      const observedAt = now();
      const [latestHistory] = await db
        .select({ snapshotTime: sql<Date | string | null>`max(${realmSnapshots.snapshotTime})` })
        .from(realmSnapshots)
        .where(and(eq(realmSnapshots.regionId, regionId), eq(realmSnapshots.connectedRealmId, connectedRealmId)));
      const latestHistoryMs = toTimestampMs(latestHistory?.snapshotTime);
      const historyIntervalMs = realmHistoryIntervalHours * 60 * 60 * 1_000;
      const historyDue = latestHistoryMs === null
        || Math.floor(observedAt.getTime() / historyIntervalMs) > Math.floor(latestHistoryMs / historyIntervalMs);
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
      const { variantGroups, historyGroups } = groupRealmAuctions(auctions, historyDue, historyItemIds);

      const latestRows: (typeof realmLatest.$inferInsert)[] = [];
      for (const group of variantGroups.values()) {
        const summary = summarizePrices(group.entries);
        if (!summary) continue;
        latestRows.push({
          regionId,
          connectedRealmId,
          itemId: group.itemId,
          variantKey: group.variant.key,
          listings: group.listings,
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
          totalValue: summary.totalValue,
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
          totalValue: summary.totalValue,
          maxBuyout: summary.maxPrice,
          totalQuantity: summary.totalQuantity,
          numAuctions: summary.numAuctions,
        });
      }

      const marketItemIds = [...new Set(latestRows.map((row) => row.itemId))].sort((left, right) => left - right);
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

      return { runId, observedAt, rowCount: latestRows.length, historyRowCount: historyRows.length };
    } catch (error) {
      await failRefresh(runId, error);
      throw error;
    }
  }

  return { refreshCommodities, refreshRealm };
}
