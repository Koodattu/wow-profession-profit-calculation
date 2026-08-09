import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { commodityDaily, commoditySnapshots, realmDaily, realmSnapshots } from "../db/schema";
import { getCurrentItemMarkets, type MarketQuote } from "./current-market";

export const HISTORY_RANGES = ["24h", "7d", "14d", "30d", "6m", "1y", "all"] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number];
export type MarketHistoryType = "auto" | "commodity" | "realm";

export interface MarketHistoryPoint {
  time: string;
  min_price: number | null;
  avg_price: number | null;
  median_price: number | null;
  max_price: number | null;
  total_quantity: number | null;
}

export interface MarketHistoryRequest {
  regionId: string;
  itemIds: number[];
  range: HistoryRange;
  type?: MarketHistoryType;
  connectedRealmId?: number;
}

interface HistoryRow {
  itemId: number;
  time: Date | string;
  min_price: number | null;
  avg_price: number | null;
  median_price: number | null;
  max_price: number | null;
  total_quantity: number | null;
}

export function isHistoryRange(value: string): value is HistoryRange {
  return (HISTORY_RANGES as readonly string[]).includes(value);
}

function getTimeRangeCutoff(range: HistoryRange): Date | null {
  const now = new Date();
  switch (range) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
    case "14d":
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1_000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    case "6m":
      return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1_000);
    case "1y":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1_000);
    case "all":
      return null;
  }
}

function useDailyTable(range: HistoryRange): boolean {
  return range === "30d" || range === "6m" || range === "1y" || range === "all";
}

function normalizePoint(row: HistoryRow): MarketHistoryPoint {
  return {
    time: row.time instanceof Date ? row.time.toISOString() : String(row.time),
    min_price: row.min_price,
    avg_price: row.avg_price,
    median_price: row.median_price,
    max_price: row.max_price,
    total_quantity: row.total_quantity,
  };
}

function groupHistory(rows: HistoryRow[], itemIds: number[]): Map<number, MarketHistoryPoint[]> {
  const grouped = new Map(itemIds.map((itemId) => [itemId, [] as MarketHistoryPoint[]]));
  for (const row of rows) grouped.get(row.itemId)?.push(normalizePoint(row));
  return grouped;
}

function quoteAsPoint(quote: MarketQuote | null | undefined): MarketHistoryPoint[] {
  if (!quote) return [];
  return [
    {
      time: quote.observedAt instanceof Date ? quote.observedAt.toISOString() : String(quote.observedAt),
      min_price: quote.minPrice,
      avg_price: quote.avgPrice,
      median_price: quote.medianPrice,
      max_price: quote.maxPrice,
      total_quantity: quote.totalQuantity,
    },
  ];
}

async function getCommodityHistory(itemIds: number[], regionId: string, range: HistoryRange): Promise<Map<number, MarketHistoryPoint[]>> {
  if (itemIds.length === 0) return new Map();
  const cutoff = getTimeRangeCutoff(range);

  if (useDailyTable(range)) {
    const conditions = [inArray(commodityDaily.itemId, itemIds), eq(commodityDaily.regionId, regionId)];
    if (cutoff) conditions.push(gte(commodityDaily.date, cutoff.toISOString().split("T")[0]!));
    const rows = await db
      .select({
        itemId: commodityDaily.itemId,
        time: commodityDaily.date,
        min_price: commodityDaily.minPrice,
        avg_price: commodityDaily.avgPrice,
        median_price: sql<number | null>`NULL`,
        max_price: commodityDaily.maxPrice,
        total_quantity: commodityDaily.avgQuantity,
      })
      .from(commodityDaily)
      .where(and(...conditions))
      .orderBy(commodityDaily.itemId, desc(commodityDaily.date));
    return groupHistory(rows, itemIds);
  }

  const conditions = [inArray(commoditySnapshots.itemId, itemIds), eq(commoditySnapshots.regionId, regionId)];
  if (cutoff) conditions.push(gte(commoditySnapshots.snapshotTime, cutoff));
  const hourBucket = sql<Date>`date_trunc('hour', ${commoditySnapshots.snapshotTime})`;
  const rows = await db
    .select({
      itemId: commoditySnapshots.itemId,
      time: hourBucket,
      min_price: sql<number>`(array_agg(${commoditySnapshots.minPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      avg_price: sql<number>`(array_agg(${commoditySnapshots.avgPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      median_price: sql<number>`(array_agg(${commoditySnapshots.medianPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      max_price: sql<number>`(array_agg(${commoditySnapshots.maxPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      total_quantity: sql<number>`(array_agg(${commoditySnapshots.totalQuantity} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
    })
    .from(commoditySnapshots)
    .where(and(...conditions))
    .groupBy(commoditySnapshots.itemId, hourBucket)
    .orderBy(commoditySnapshots.itemId, desc(hourBucket));
  return groupHistory(rows, itemIds);
}

async function getRealmHistory(
  itemIds: number[],
  regionId: string,
  range: HistoryRange,
  connectedRealmId?: number,
): Promise<Map<number, MarketHistoryPoint[]>> {
  if (itemIds.length === 0) return new Map();
  const cutoff = getTimeRangeCutoff(range);

  if (useDailyTable(range)) {
    const conditions = [inArray(realmDaily.itemId, itemIds), eq(realmDaily.regionId, regionId)];
    if (cutoff) conditions.push(gte(realmDaily.date, cutoff.toISOString().split("T")[0]!));
    if (connectedRealmId !== undefined) conditions.push(eq(realmDaily.connectedRealmId, connectedRealmId));
    const rows = await db
      .select({
        itemId: realmDaily.itemId,
        time: realmDaily.date,
        min_price: realmDaily.minBuyout,
        avg_price: realmDaily.avgBuyout,
        median_price: sql<number | null>`NULL`,
        max_price: realmDaily.maxBuyout,
        total_quantity: realmDaily.avgQuantity,
      })
      .from(realmDaily)
      .where(and(...conditions))
      .orderBy(realmDaily.itemId, desc(realmDaily.date));
    return groupHistory(rows, itemIds);
  }

  const conditions = [inArray(realmSnapshots.itemId, itemIds), eq(realmSnapshots.regionId, regionId)];
  if (cutoff) conditions.push(gte(realmSnapshots.snapshotTime, cutoff));
  if (connectedRealmId !== undefined) conditions.push(eq(realmSnapshots.connectedRealmId, connectedRealmId));
  const hourBucket = sql<Date>`date_trunc('hour', ${realmSnapshots.snapshotTime})`;
  const rows = await db
    .select({
      itemId: realmSnapshots.itemId,
      time: hourBucket,
      min_price: sql<number>`(array_agg(${realmSnapshots.minBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      avg_price: sql<number>`(array_agg(${realmSnapshots.avgBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      median_price: sql<number>`(array_agg(${realmSnapshots.medianBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      max_price: sql<number>`(array_agg(${realmSnapshots.maxBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      total_quantity: sql<number>`(array_agg(${realmSnapshots.totalQuantity} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
    })
    .from(realmSnapshots)
    .where(and(...conditions))
    .groupBy(realmSnapshots.itemId, hourBucket)
    .orderBy(realmSnapshots.itemId, desc(hourBucket));
  return groupHistory(rows, itemIds);
}

export async function getMarketHistories(request: MarketHistoryRequest): Promise<Map<number, MarketHistoryPoint[]>> {
  const { regionId, range, connectedRealmId, type = "auto" } = request;
  const itemIds = [...new Set(request.itemIds)];
  if (itemIds.length === 0) return new Map();

  const [commodityHistory, realmHistory] = await Promise.all([
    type === "realm" ? Promise.resolve(new Map<number, MarketHistoryPoint[]>()) : getCommodityHistory(itemIds, regionId, range),
    type === "commodity"
      ? Promise.resolve(new Map<number, MarketHistoryPoint[]>())
      : getRealmHistory(itemIds, regionId, range, connectedRealmId),
  ]);

  const itemIdsNeedingCurrent = itemIds.filter((itemId) => {
    if (type === "commodity") return (commodityHistory.get(itemId) ?? []).length === 0;
    if (type === "realm") return (realmHistory.get(itemId) ?? []).length === 0;
    return (commodityHistory.get(itemId) ?? []).length === 0;
  });
  const currentMarkets =
    itemIdsNeedingCurrent.length === 0
      ? new Map()
      : await getCurrentItemMarkets(regionId, itemIdsNeedingCurrent, connectedRealmId);

  const result = new Map<number, MarketHistoryPoint[]>();
  for (const itemId of itemIds) {
    const commodity = commodityHistory.get(itemId) ?? [];
    const realm = realmHistory.get(itemId) ?? [];
    const market = currentMarkets.get(itemId);
    if (type === "commodity") {
      result.set(itemId, commodity.length > 0 ? commodity : quoteAsPoint(market?.commodityQuote));
      continue;
    }
    if (type === "realm") {
      const quote = connectedRealmId === undefined ? market?.euRealmBenchmark : market?.selectedRealmQuote;
      result.set(itemId, realm.length > 0 ? realm : quoteAsPoint(quote));
      continue;
    }

    if (commodity.length > 0) {
      result.set(itemId, commodity);
    } else if (market?.commodityQuote) {
      result.set(itemId, quoteAsPoint(market.commodityQuote));
    } else if (realm.length > 0) {
      result.set(itemId, realm);
    } else {
      result.set(itemId, quoteAsPoint(market?.currentQuote));
    }
  }

  return result;
}

export async function getItemMarketHistory(
  itemId: number,
  regionId: string,
  range: HistoryRange,
  type: MarketHistoryType = "auto",
  connectedRealmId?: number,
): Promise<MarketHistoryPoint[]> {
  return (await getMarketHistories({ itemIds: [itemId], regionId, range, type, connectedRealmId })).get(itemId) ?? [];
}
