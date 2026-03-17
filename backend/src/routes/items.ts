import { Hono } from "hono";
import { eq, and, gte, desc, sql, ilike, inArray } from "drizzle-orm";
import { db } from "../db";
import { items, commoditySnapshots, realmSnapshots, commodityDaily, realmDaily, realms, connectedRealms } from "../db/schema";
import { getLatestCommodityPrices, getLatestRealmPrices, getLatestRealmPricesForConnectedRealm, type PriceData } from "../services/crafting-cost";

const itemRoutes = new Hono();

// ─── GET / — List all items with latest prices ─────────────────────

itemRoutes.get("/", async (c) => {
  const region = c.req.query("region") || "eu";
  const type = c.req.query("type") || "all";
  const search = c.req.query("search") || "";
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !Number.isFinite(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(2000, Math.max(1, Number(c.req.query("limit")) || 50));
  const offset = (page - 1) * limit;

  try {
    // Build filter conditions
    const conditions = [];
    if (type === "reagent") conditions.push(eq(items.isReagent, true));
    else if (type === "crafted") conditions.push(eq(items.isCraftedOutput, true));
    else if (type === "commodity") {
      conditions.push(sql`exists (
        select 1
        from commodity_snapshots cs
        where cs.item_id = ${items.id}
          and cs.region_id = ${region}
      )`);
    } else if (type === "gear") {
      conditions.push(sql`not exists (
        select 1
        from commodity_snapshots cs
        where cs.item_id = ${items.id}
          and cs.region_id = ${region}
      )`);
    }
    if (search) {
      const safeSearch = search.replace(/[%_\\]/g, "\\$&");
      conditions.push(ilike(items.name, `%${safeSearch}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total matching items
    const countResult = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(items)
      .where(whereClause);
    const total = countResult[0]?.total ?? 0;

    // Get paginated items
    const itemRows = await db.select().from(items).where(whereClause).orderBy(items.name).limit(limit).offset(offset);

    // Fetch prices for these items
    const itemIds = itemRows.map((i) => i.id);
    const commodityPrices = await getLatestCommodityPrices(region, itemIds);

    const needRealmPriceIds = itemIds.filter((id) => !commodityPrices.has(id));
    const regionRealmPrices = needRealmPriceIds.length > 0 ? await getLatestRealmPrices(region, needRealmPriceIds) : new Map<number, PriceData>();
    const selectedRealmPrices =
      connectedRealmId !== undefined && needRealmPriceIds.length > 0
        ? await getLatestRealmPricesForConnectedRealm(region, needRealmPriceIds, connectedRealmId)
        : new Map<number, PriceData>();

    // Build response with price source info
    const enrichedItems = itemRows.map((item) => {
      const comPrice = commodityPrices.get(item.id);
      const regionRealmPrice = regionRealmPrices.get(item.id);
      const selectedRealmPrice = selectedRealmPrices.get(item.id);
      const effectiveRealmPrice = selectedRealmPrice ?? regionRealmPrice;

      return {
        id: item.id,
        name: item.name,
        itemQuality: item.itemQuality,
        qualityRank: item.qualityRank,
        isReagent: item.isReagent,
        isCraftedOutput: item.isCraftedOutput,
        priceSource: comPrice ? ("commodity" as const) : effectiveRealmPrice ? ("realm" as const) : null,
        latestPrice: comPrice ?? effectiveRealmPrice ?? null,
        regionLatestPrice: comPrice ?? regionRealmPrice ?? null,
        realmLatestPrice: selectedRealmPrice ?? null,
      };
    });

    return c.json({
      items: enrichedItems,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[Items] Error listing items:", err);
    return c.json({ error: "Failed to list items" }, 500);
  }
});

// ─── GET /:itemId — Item metadata ───────────────────────────────────

itemRoutes.get("/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);

  if (!item) return c.json({ error: "Item not found" }, 404);
  return c.json(item);
});

// ─── GET /:itemId/prices — Price history ────────────────────────────

function getTimeRangeCutoff(range: string): Date | null {
  const now = new Date();
  switch (range) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "14d":
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "6m":
      return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    case "1y":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}

function useDailyTable(range: string): boolean {
  return range === "6m" || range === "1y" || range === "all";
}

itemRoutes.get("/:itemId/prices", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const range = c.req.query("range") || "24h";
  const region = c.req.query("region") || "eu";
  const type = c.req.query("type") || "auto";
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !Number.isFinite(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    if (type === "commodity" || type === "auto") {
      // Try commodity data first (or if type is commodity)
      const data = useDailyTable(range) ? await getCommodityDaily(itemId, region, range) : await getCommoditySnapshots(itemId, region, range);

      if (data.length > 0 || type === "commodity") {
        return c.json(data);
      }
    }

    // Realm data (or auto fallback)
    const data = useDailyTable(range) ? await getRealmDaily(itemId, region, range, connectedRealmId) : await getRealmSnapshots(itemId, region, range, connectedRealmId);

    return c.json(data);
  } catch (err) {
    console.error(`[Items] Error fetching prices for item ${itemId}:`, err);
    return c.json({ error: "Failed to fetch price data" }, 500);
  }
});

async function getCommoditySnapshots(itemId: number, regionId: string, range: string) {
  const cutoff = getTimeRangeCutoff(range);
  const conditions = [eq(commoditySnapshots.itemId, itemId), eq(commoditySnapshots.regionId, regionId)];
  if (cutoff) conditions.push(gte(commoditySnapshots.snapshotTime, cutoff));

  const hourBucket = sql<Date>`date_trunc('hour', ${commoditySnapshots.snapshotTime})`;

  return db
    .select({
      time: hourBucket,
      min_price: sql<number>`(array_agg(${commoditySnapshots.minPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      avg_price: sql<number>`(array_agg(${commoditySnapshots.avgPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      median_price: sql<number>`(array_agg(${commoditySnapshots.medianPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      max_price: sql<number>`(array_agg(${commoditySnapshots.maxPrice} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
      total_quantity: sql<number>`(array_agg(${commoditySnapshots.totalQuantity} ORDER BY ${commoditySnapshots.snapshotTime} DESC))[1]`,
    })
    .from(commoditySnapshots)
    .where(and(...conditions))
    .groupBy(hourBucket)
    .orderBy(desc(hourBucket));
}

async function getCommodityDaily(itemId: number, regionId: string, range: string) {
  const cutoff = getTimeRangeCutoff(range);
  const conditions = [eq(commodityDaily.itemId, itemId), eq(commodityDaily.regionId, regionId)];
  if (cutoff) {
    conditions.push(gte(commodityDaily.date, cutoff.toISOString().split("T")[0]!));
  }

  return db
    .select({
      time: commodityDaily.date,
      min_price: commodityDaily.minPrice,
      avg_price: commodityDaily.avgPrice,
      max_price: commodityDaily.maxPrice,
      total_quantity: commodityDaily.avgQuantity,
    })
    .from(commodityDaily)
    .where(and(...conditions))
    .orderBy(desc(commodityDaily.date));
}

async function getRealmSnapshots(itemId: number, regionId: string, range: string, connectedRealmId?: number) {
  const cutoff = getTimeRangeCutoff(range);
  const conditions = [eq(realmSnapshots.itemId, itemId), eq(realmSnapshots.regionId, regionId)];
  if (cutoff) conditions.push(gte(realmSnapshots.snapshotTime, cutoff));
  if (connectedRealmId !== undefined) conditions.push(eq(realmSnapshots.connectedRealmId, connectedRealmId));

  const hourBucket = sql<Date>`date_trunc('hour', ${realmSnapshots.snapshotTime})`;

  return db
    .select({
      time: hourBucket,
      min_price: sql<number>`(array_agg(${realmSnapshots.minBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      avg_price: sql<number>`(array_agg(${realmSnapshots.avgBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      median_price: sql<number>`(array_agg(${realmSnapshots.medianBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      max_price: sql<number>`(array_agg(${realmSnapshots.maxBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      total_quantity: sql<number>`(array_agg(${realmSnapshots.totalQuantity} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
    })
    .from(realmSnapshots)
    .where(and(...conditions))
    .groupBy(hourBucket)
    .orderBy(desc(hourBucket));
}

async function getRealmDaily(itemId: number, regionId: string, range: string, connectedRealmId?: number) {
  const cutoff = getTimeRangeCutoff(range);
  const conditions = [eq(realmDaily.itemId, itemId), eq(realmDaily.regionId, regionId)];
  if (cutoff) {
    conditions.push(gte(realmDaily.date, cutoff.toISOString().split("T")[0]!));
  }
  if (connectedRealmId !== undefined) {
    conditions.push(eq(realmDaily.connectedRealmId, connectedRealmId));
  }

  return db
    .select({
      time: realmDaily.date,
      min_price: realmDaily.minBuyout,
      avg_price: realmDaily.avgBuyout,
      max_price: realmDaily.maxBuyout,
      total_quantity: realmDaily.avgQuantity,
    })
    .from(realmDaily)
    .where(and(...conditions))
    .orderBy(desc(realmDaily.date));
}

// ─── GET /:itemId/realm-prices — Per-realm current snapshot ─────────

itemRoutes.get("/:itemId/realm-prices", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const region = c.req.query("region") || "eu";

  try {
    const conditions = [eq(realmSnapshots.itemId, itemId), eq(realmSnapshots.regionId, region)];

    const latestPrices = await db
      .select({
        realm_id: realmSnapshots.connectedRealmId,
        min_buyout: sql<number>`(array_agg(${realmSnapshots.minBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
        avg_buyout: sql<number>`(array_agg(coalesce(${realmSnapshots.avgBuyout}, ${realmSnapshots.minBuyout}) ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
        total_quantity: sql<number>`(array_agg(${realmSnapshots.totalQuantity} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
      })
      .from(realmSnapshots)
      .where(and(...conditions))
      .groupBy(realmSnapshots.connectedRealmId, realmSnapshots.regionId);

    if (latestPrices.length === 0) {
      return c.json([]);
    }

    const connectedRealmIds = [...new Set(latestPrices.map((row) => row.realm_id))];
    const realmRows = await db
      .select({ connectedRealmId: realms.connectedRealmId, name: realms.name })
      .from(realms)
      .where(and(eq(realms.regionId, region), inArray(realms.connectedRealmId, connectedRealmIds)))
      .orderBy(realms.name);

    const realmNameByConnectedRealm = new Map<number, string>();
    for (const row of realmRows) {
      if (!realmNameByConnectedRealm.has(row.connectedRealmId)) {
        realmNameByConnectedRealm.set(row.connectedRealmId, row.name);
      }
    }

    const data = latestPrices
      .map((row) => ({
        realm_id: row.realm_id,
        realm_name: realmNameByConnectedRealm.get(row.realm_id) ?? null,
        min_buyout: row.min_buyout,
        avg_buyout: row.avg_buyout,
        total_quantity: row.total_quantity,
      }))
      .sort((a, b) => b.min_buyout - a.min_buyout);

    return c.json(data);
  } catch (err) {
    console.error(`[Items] Error fetching realm prices for item ${itemId}:`, err);
    return c.json({ error: "Failed to fetch realm price data" }, 500);
  }
});

export default itemRoutes;
