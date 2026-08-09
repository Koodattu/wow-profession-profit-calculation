import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { commodityLatest, realmLatest, realms } from "../db/schema";

const ITEM_BATCH_SIZE = 500;

export interface MarketQuote {
  minPrice: number;
  avgPrice: number;
  medianPrice: number;
  maxPrice: number;
  totalQuantity: number;
  numAuctions: number;
  observedAt: Date;
  variantCount?: number;
  realmCount?: number;
}

export interface CurrentItemMarket {
  priceSource: "commodity" | "realm" | null;
  currentQuote: MarketQuote | null;
  commodityQuote: MarketQuote | null;
  selectedRealmQuote: MarketQuote | null;
  euRealmBenchmark: MarketQuote | null;
}

export interface ConnectedRealmQuote {
  connectedRealmId: number;
  connectedRealmName: string | null;
  quote: MarketQuote;
}

export type RealmSpreadSort = "spread" | "regionAvgPrice";

export interface RealmSpreadQuery {
  regionId: string;
  minSpread: number;
  limit: number;
  categoryId?: number;
  categoryName?: string;
  uncategorized?: boolean;
  sortBy: RealmSpreadSort;
}

export interface RealmSpreadOpportunity {
  itemId: number;
  itemName: string;
  itemQuality: number | null;
  qualityRank: number | null;
  categoryId: number | null;
  categoryName: string | null;
  professionName: string | null;
  regionAvgPrice: number;
  cheapestRealm: { realmId: number; realmName: string; minBuyout: number };
  mostExpensiveRealm: { realmId: number; realmName: string; minBuyout: number };
  spread: number;
  spreadPercent: number;
  realmCount: number;
}

function batches<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += ITEM_BATCH_SIZE) {
    result.push(values.slice(index, index + ITEM_BATCH_SIZE));
  }
  return result;
}

async function loadCommodityQuotes(regionId: string, itemIds: number[]): Promise<Map<number, MarketQuote>> {
  const quotes = new Map<number, MarketQuote>();

  for (const batch of batches(itemIds)) {
    const rows = await db
      .select({
        itemId: commodityLatest.itemId,
        minPrice: commodityLatest.minPrice,
        avgPrice: commodityLatest.avgPrice,
        medianPrice: commodityLatest.medianPrice,
        maxPrice: commodityLatest.maxPrice,
        totalQuantity: commodityLatest.totalQuantity,
        numAuctions: commodityLatest.numAuctions,
        observedAt: commodityLatest.observedAt,
      })
      .from(commodityLatest)
      .where(and(eq(commodityLatest.regionId, regionId), inArray(commodityLatest.itemId, batch)));

    for (const row of rows) {
      quotes.set(row.itemId, {
        minPrice: Number(row.minPrice),
        avgPrice: Number(row.avgPrice),
        medianPrice: Number(row.medianPrice),
        maxPrice: Number(row.maxPrice),
        totalQuantity: Number(row.totalQuantity),
        numAuctions: row.numAuctions,
        observedAt: row.observedAt,
      });
    }
  }

  return quotes;
}

async function loadSelectedRealmQuotes(regionId: string, itemIds: number[], connectedRealmId: number): Promise<Map<number, MarketQuote>> {
  const quotes = new Map<number, MarketQuote>();

  for (const batch of batches(itemIds)) {
    const rows = await db
      .select({
        itemId: realmLatest.itemId,
        minPrice: sql<number>`min(${realmLatest.minBuyout})::bigint`,
        avgPrice: sql<number>`(sum(${realmLatest.avgBuyout} * ${realmLatest.totalQuantity}) / nullif(sum(${realmLatest.totalQuantity}), 0))::bigint`,
        medianPrice: sql<number>`(sum(${realmLatest.medianBuyout} * ${realmLatest.totalQuantity}) / nullif(sum(${realmLatest.totalQuantity}), 0))::bigint`,
        maxPrice: sql<number>`max(${realmLatest.maxBuyout})::bigint`,
        totalQuantity: sql<number>`sum(${realmLatest.totalQuantity})::bigint`,
        numAuctions: sql<number>`sum(${realmLatest.numAuctions})::int`,
        observedAt: sql<Date>`max(${realmLatest.observedAt})`,
        variantCount: sql<number>`count(*)::int`,
      })
      .from(realmLatest)
      .where(
        and(
          eq(realmLatest.regionId, regionId),
          eq(realmLatest.connectedRealmId, connectedRealmId),
          inArray(realmLatest.itemId, batch),
        ),
      )
      .groupBy(realmLatest.itemId);

    for (const row of rows) {
      quotes.set(Number(row.itemId), {
        minPrice: Number(row.minPrice),
        avgPrice: Number(row.avgPrice),
        medianPrice: Number(row.medianPrice),
        maxPrice: Number(row.maxPrice),
        totalQuantity: Number(row.totalQuantity),
        numAuctions: Number(row.numAuctions),
        observedAt: row.observedAt,
        variantCount: Number(row.variantCount),
      });
    }
  }

  return quotes;
}

async function loadEuRealmBenchmarks(regionId: string, itemIds: number[]): Promise<Map<number, MarketQuote>> {
  const quotes = new Map<number, MarketQuote>();

  for (const batch of batches(itemIds)) {
    const perRealm = db
      .select({
        itemId: realmLatest.itemId,
        connectedRealmId: realmLatest.connectedRealmId,
        minPrice: sql<number>`min(${realmLatest.minBuyout})::bigint`.as("realm_min_price"),
        totalQuantity: sql<number>`sum(${realmLatest.totalQuantity})::bigint`.as("realm_total_quantity"),
        numAuctions: sql<number>`sum(${realmLatest.numAuctions})::int`.as("realm_num_auctions"),
        observedAt: sql<Date>`max(${realmLatest.observedAt})`.as("realm_observed_at"),
        variantCount: sql<number>`count(*)::int`.as("realm_variant_count"),
      })
      .from(realmLatest)
      .where(and(eq(realmLatest.regionId, regionId), inArray(realmLatest.itemId, batch)))
      .groupBy(realmLatest.itemId, realmLatest.connectedRealmId)
      .as("current_realm_quotes");

    const rows = await db
      .select({
        itemId: perRealm.itemId,
        averageMinPrice: sql<number>`avg(${perRealm.minPrice})::bigint`,
        totalQuantity: sql<number>`sum(${perRealm.totalQuantity})::bigint`,
        numAuctions: sql<number>`sum(${perRealm.numAuctions})::int`,
        observedAt: sql<Date>`max(${perRealm.observedAt})`,
        variantCount: sql<number>`sum(${perRealm.variantCount})::int`,
        realmCount: sql<number>`count(*)::int`,
      })
      .from(perRealm)
      .groupBy(perRealm.itemId);

    for (const row of rows) {
      const averageMinPrice = Number(row.averageMinPrice);
      quotes.set(Number(row.itemId), {
        minPrice: averageMinPrice,
        avgPrice: averageMinPrice,
        medianPrice: averageMinPrice,
        maxPrice: averageMinPrice,
        totalQuantity: Number(row.totalQuantity),
        numAuctions: Number(row.numAuctions),
        observedAt: row.observedAt,
        variantCount: Number(row.variantCount),
        realmCount: Number(row.realmCount),
      });
    }
  }

  return quotes;
}

export async function getCurrentItemMarkets(regionId: string, itemIds: number[], connectedRealmId?: number): Promise<Map<number, CurrentItemMarket>> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return new Map();

  const commodityQuotes = await loadCommodityQuotes(regionId, uniqueItemIds);
  const realmItemIds = uniqueItemIds.filter((itemId) => !commodityQuotes.has(itemId));
  const [selectedRealmQuotes, euRealmBenchmarks] = await Promise.all([
    connectedRealmId === undefined || realmItemIds.length === 0
      ? Promise.resolve(new Map<number, MarketQuote>())
      : loadSelectedRealmQuotes(regionId, realmItemIds, connectedRealmId),
    realmItemIds.length === 0 ? Promise.resolve(new Map<number, MarketQuote>()) : loadEuRealmBenchmarks(regionId, realmItemIds),
  ]);

  const markets = new Map<number, CurrentItemMarket>();
  for (const itemId of uniqueItemIds) {
    const commodityQuote = commodityQuotes.get(itemId) ?? null;
    const selectedRealmQuote = selectedRealmQuotes.get(itemId) ?? null;
    const euRealmBenchmark = euRealmBenchmarks.get(itemId) ?? null;
    const currentQuote = commodityQuote ?? (connectedRealmId === undefined ? euRealmBenchmark : selectedRealmQuote);
    const priceSource = commodityQuote ? "commodity" : currentQuote ? "realm" : null;

    markets.set(itemId, {
      priceSource,
      currentQuote,
      commodityQuote,
      selectedRealmQuote,
      euRealmBenchmark,
    });
  }

  return markets;
}

export async function getCurrentRealmComparison(regionId: string, itemId: number): Promise<ConnectedRealmQuote[]> {
  const latestPrices = await db
    .select({
      connectedRealmId: realmLatest.connectedRealmId,
      minPrice: sql<number>`min(${realmLatest.minBuyout})::bigint`,
      avgPrice: sql<number>`(sum(${realmLatest.avgBuyout} * ${realmLatest.totalQuantity}) / nullif(sum(${realmLatest.totalQuantity}), 0))::bigint`,
      medianPrice: sql<number>`(sum(${realmLatest.medianBuyout} * ${realmLatest.totalQuantity}) / nullif(sum(${realmLatest.totalQuantity}), 0))::bigint`,
      maxPrice: sql<number>`max(${realmLatest.maxBuyout})::bigint`,
      totalQuantity: sql<number>`sum(${realmLatest.totalQuantity})::bigint`,
      numAuctions: sql<number>`sum(${realmLatest.numAuctions})::int`,
      variantCount: sql<number>`count(*)::int`,
      observedAt: sql<Date>`max(${realmLatest.observedAt})`,
    })
    .from(realmLatest)
    .where(and(eq(realmLatest.regionId, regionId), eq(realmLatest.itemId, itemId)))
    .groupBy(realmLatest.connectedRealmId, realmLatest.regionId);

  if (latestPrices.length === 0) return [];

  const connectedRealmIds = latestPrices.map((row) => row.connectedRealmId);
  const realmRows = await db
    .select({ connectedRealmId: realms.connectedRealmId, name: realms.name })
    .from(realms)
    .where(and(eq(realms.regionId, regionId), inArray(realms.connectedRealmId, connectedRealmIds)))
    .orderBy(realms.name);

  const namesByConnectedRealm = new Map<number, string[]>();
  for (const row of realmRows) {
    const names = namesByConnectedRealm.get(row.connectedRealmId) ?? [];
    names.push(row.name);
    namesByConnectedRealm.set(row.connectedRealmId, names);
  }

  return latestPrices
    .map((row) => ({
      connectedRealmId: row.connectedRealmId,
      connectedRealmName: namesByConnectedRealm.get(row.connectedRealmId)?.join(" / ") ?? null,
      quote: {
        minPrice: Number(row.minPrice),
        avgPrice: Number(row.avgPrice),
        medianPrice: Number(row.medianPrice),
        maxPrice: Number(row.maxPrice),
        totalQuantity: Number(row.totalQuantity),
        numAuctions: Number(row.numAuctions),
        observedAt: row.observedAt,
        variantCount: Number(row.variantCount),
      },
    }))
    .sort((a, b) => b.quote.minPrice - a.quote.minPrice);
}

export async function findRealmSpreadOpportunities(query: RealmSpreadQuery): Promise<RealmSpreadOpportunity[]> {
  const orderByClause = query.sortBy === "regionAvgPrice" ? sql`item_agg.region_avg_price DESC` : sql`(item_agg.max_price - item_agg.min_price) DESC`;
  const categoryClause = query.uncategorized
    ? sql`AND category.category_name IS NULL`
    : query.categoryName !== undefined
      ? sql`AND category.category_name = ${query.categoryName}`
      : query.categoryId !== undefined
        ? sql`AND category.category_id = ${query.categoryId}`
        : sql``;

  const rows = await db.execute(sql`
    WITH latest_per_realm AS (
      SELECT
        realm_latest.item_id,
        realm_latest.connected_realm_id,
        min(realm_latest.min_buyout)::bigint AS min_buyout
      FROM realm_latest
      INNER JOIN items tracked_item
        ON tracked_item.id = realm_latest.item_id
       AND tracked_item.is_crafted_output = true
      WHERE realm_latest.region_id = ${query.regionId}
      GROUP BY realm_latest.item_id, realm_latest.connected_realm_id
    ),
    item_agg AS (
      SELECT
        latest_per_realm.item_id,
        avg(latest_per_realm.min_buyout)::bigint AS region_avg_price,
        min(latest_per_realm.min_buyout)::bigint AS min_price,
        max(latest_per_realm.min_buyout)::bigint AS max_price,
        count(*)::int AS realm_count
      FROM latest_per_realm
      GROUP BY latest_per_realm.item_id
      HAVING (max(latest_per_realm.min_buyout) - min(latest_per_realm.min_buyout)) >= ${query.minSpread}
    ),
    cheapest AS (
      SELECT DISTINCT ON (latest_per_realm.item_id)
        latest_per_realm.item_id,
        latest_per_realm.connected_realm_id,
        latest_per_realm.min_buyout
      FROM latest_per_realm
      INNER JOIN item_agg ON item_agg.item_id = latest_per_realm.item_id
      ORDER BY latest_per_realm.item_id, latest_per_realm.min_buyout ASC
    ),
    expensive AS (
      SELECT DISTINCT ON (latest_per_realm.item_id)
        latest_per_realm.item_id,
        latest_per_realm.connected_realm_id,
        latest_per_realm.min_buyout
      FROM latest_per_realm
      INNER JOIN item_agg ON item_agg.item_id = latest_per_realm.item_id
      ORDER BY latest_per_realm.item_id, latest_per_realm.min_buyout DESC
    ),
    realm_names AS (
      SELECT connected_realm_id, string_agg(name, ' / ' ORDER BY name) AS name
      FROM realms
      WHERE region_id = ${query.regionId}
      GROUP BY connected_realm_id
    )
    SELECT
      item_agg.item_id,
      items.name AS item_name,
      items.item_quality,
      items.quality_rank,
      category.category_id,
      category.category_name,
      category.profession_name,
      item_agg.region_avg_price,
      cheapest.connected_realm_id AS cheapest_realm_id,
      cheapest_names.name AS cheapest_realm_name,
      cheapest.min_buyout AS cheapest_min_buyout,
      expensive.connected_realm_id AS expensive_realm_id,
      expensive_names.name AS expensive_realm_name,
      expensive.min_buyout AS expensive_min_buyout,
      (item_agg.max_price - item_agg.min_price) AS spread,
      round((item_agg.max_price - item_agg.min_price)::numeric / nullif(item_agg.min_price, 0) * 100, 1) AS spread_percent,
      item_agg.realm_count
    FROM item_agg
    JOIN items ON items.id = item_agg.item_id
    LEFT JOIN LATERAL (
      SELECT
        recipe_categories.id AS category_id,
        recipe_categories.name AS category_name,
        professions.name AS profession_name
      FROM recipes
      LEFT JOIN recipe_categories ON recipe_categories.id = recipes.category_id
      LEFT JOIN professions ON professions.id = recipes.profession_id
      WHERE recipes.output_item_id = item_agg.item_id
      ORDER BY (recipes.category_id IS NULL) ASC, recipe_categories.name ASC, recipes.id ASC
      LIMIT 1
    ) category ON true
    JOIN cheapest ON cheapest.item_id = item_agg.item_id
    JOIN expensive ON expensive.item_id = item_agg.item_id
    LEFT JOIN realm_names cheapest_names ON cheapest_names.connected_realm_id = cheapest.connected_realm_id
    LEFT JOIN realm_names expensive_names ON expensive_names.connected_realm_id = expensive.connected_realm_id
    WHERE items.is_crafted_output = true
    ${categoryClause}
    ORDER BY ${orderByClause}
    LIMIT ${query.limit}
  `);

  return Array.from(rows as Iterable<Record<string, unknown>>).map((row) => ({
    itemId: Number(row.item_id),
    itemName: row.item_name as string,
    itemQuality: row.item_quality == null ? null : Number(row.item_quality),
    qualityRank: row.quality_rank == null ? null : Number(row.quality_rank),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: (row.category_name as string | null) ?? null,
    professionName: (row.profession_name as string | null) ?? null,
    regionAvgPrice: Number(row.region_avg_price),
    cheapestRealm: {
      realmId: Number(row.cheapest_realm_id),
      realmName: (row.cheapest_realm_name as string | null) ?? `Realm ${row.cheapest_realm_id}`,
      minBuyout: Number(row.cheapest_min_buyout),
    },
    mostExpensiveRealm: {
      realmId: Number(row.expensive_realm_id),
      realmName: (row.expensive_realm_name as string | null) ?? `Realm ${row.expensive_realm_id}`,
      minBuyout: Number(row.expensive_min_buyout),
    },
    spread: Number(row.spread),
    spreadPercent: Number(row.spread_percent),
    realmCount: Number(row.realm_count),
  }));
}
