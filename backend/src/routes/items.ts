import { Hono } from "hono";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { items, commoditySnapshots, realmSnapshots, commodityDaily, realmDaily, realms, connectedRealms } from "../db/schema";

const itemRoutes = new Hono();

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

  try {
    if (type === "commodity" || type === "auto") {
      // Try commodity data first (or if type is commodity)
      const data = useDailyTable(range) ? await getCommodityDaily(itemId, region, range) : await getCommoditySnapshots(itemId, region, range);

      if (data.length > 0 || type === "commodity") {
        return c.json(data);
      }
    }

    // Realm data (or auto fallback)
    const data = useDailyTable(range) ? await getRealmDaily(itemId, region, range) : await getRealmSnapshots(itemId, region, range);

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

  return db
    .select({
      time: commoditySnapshots.snapshotTime,
      min_price: commoditySnapshots.minPrice,
      avg_price: commoditySnapshots.avgPrice,
      median_price: commoditySnapshots.medianPrice,
      max_price: commoditySnapshots.maxPrice,
      total_quantity: commoditySnapshots.totalQuantity,
    })
    .from(commoditySnapshots)
    .where(and(...conditions))
    .orderBy(desc(commoditySnapshots.snapshotTime));
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

async function getRealmSnapshots(itemId: number, regionId: string, range: string) {
  const cutoff = getTimeRangeCutoff(range);
  const conditions = [eq(realmSnapshots.itemId, itemId), eq(realmSnapshots.regionId, regionId)];
  if (cutoff) conditions.push(gte(realmSnapshots.snapshotTime, cutoff));

  return db
    .select({
      time: realmSnapshots.snapshotTime,
      min_price: realmSnapshots.minBuyout,
      avg_price: realmSnapshots.avgBuyout,
      median_price: realmSnapshots.medianBuyout,
      max_price: realmSnapshots.maxBuyout,
      total_quantity: realmSnapshots.totalQuantity,
    })
    .from(realmSnapshots)
    .where(and(...conditions))
    .orderBy(desc(realmSnapshots.snapshotTime));
}

async function getRealmDaily(itemId: number, regionId: string, range: string) {
  const cutoff = getTimeRangeCutoff(range);
  const conditions = [eq(realmDaily.itemId, itemId), eq(realmDaily.regionId, regionId)];
  if (cutoff) {
    conditions.push(gte(realmDaily.date, cutoff.toISOString().split("T")[0]!));
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

// ─── GET /:itemId/realm-prices — Per-realm price comparison ─────────

itemRoutes.get("/:itemId/realm-prices", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const range = c.req.query("range") || "24h";
  const region = c.req.query("region") || "eu";

  try {
    const cutoff = getTimeRangeCutoff(range);
    const conditions = [eq(realmSnapshots.itemId, itemId), eq(realmSnapshots.regionId, region)];
    if (cutoff) conditions.push(gte(realmSnapshots.snapshotTime, cutoff));

    const data = await db
      .select({
        realm_id: realmSnapshots.connectedRealmId,
        realm_name: sql<string>`(
          SELECT ${realms.name} FROM ${realms}
          WHERE ${realms.connectedRealmId} = ${realmSnapshots.connectedRealmId}
            AND ${realms.regionId} = ${realmSnapshots.regionId}
          LIMIT 1
        )`,
        min_buyout: sql<number>`min(${realmSnapshots.minBuyout})`,
        avg_buyout: sql<number>`avg(${realmSnapshots.avgBuyout})::bigint`,
        total_quantity: sql<number>`sum(${realmSnapshots.totalQuantity})`,
      })
      .from(realmSnapshots)
      .where(and(...conditions))
      .groupBy(realmSnapshots.connectedRealmId, realmSnapshots.regionId);

    return c.json(data);
  } catch (err) {
    console.error(`[Items] Error fetching realm prices for item ${itemId}:`, err);
    return c.json({ error: "Failed to fetch realm price data" }, 500);
  }
});

export default itemRoutes;
