import { Hono } from "hono";
import { eq, and, sql, ilike } from "drizzle-orm";
import { db } from "../db";
import { items } from "../db/schema";
import { getCurrentItemMarkets, getCurrentRealmComparison } from "../services/current-market";
import { getItemMarketHistory, isHistoryRange, type MarketHistoryType } from "../services/market-history";
import { getGearListings, getGearVariants } from "../services/gear-market";
import { isDatabaseId } from "./validation";

const itemRoutes = new Hono();

itemRoutes.get("/:itemId/variants", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (!isDatabaseId(itemId)) return c.json({ error: "Invalid item ID" }, 400);
  try {
    const result = await getGearVariants(itemId);
    c.header("Cache-Control", "public, max-age=30");
    return c.json(result);
  } catch (error) {
    console.error("[Items] Error loading gear versions:", error);
    return c.json({ error: "Could not load item versions" }, 500);
  }
});

itemRoutes.get("/:itemId/listings", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const realmId = Number(c.req.query("connectedRealmId"));
  const variantKey = c.req.query("variant") ?? "";
  const page = Number(c.req.query("page") ?? 1);
  if (!isDatabaseId(itemId) || !isDatabaseId(realmId)
    || !/^(base|[a-f0-9]{32})$/.test(variantKey) || !Number.isInteger(page) || page < 1 || page > 5_000) {
    return c.json({ error: "Invalid listing filters" }, 400);
  }
  try {
    const result = await getGearListings(itemId, realmId, variantKey, page);
    c.header("Cache-Control", "public, max-age=15");
    return c.json(result);
  } catch (error) {
    console.error("[Items] Error loading gear listings:", error);
    return c.json({ error: "Could not load auction listings" }, 500);
  }
});

// ─── GET / — List all items with latest prices ─────────────────────

itemRoutes.get("/", async (c) => {
  const region = c.req.query("region") || "eu";
  const type = c.req.query("type") || "all";
  const search = (c.req.query("search") || "").trim();
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);
  if (!["all", "reagent", "crafted", "commodity", "gear", "realm"].includes(type)) return c.json({ error: "Invalid item type" }, 400);
  if (search.length > 100) return c.json({ error: "Search must be 100 characters or fewer" }, 400);
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !isDatabaseId(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }
  const requestedPage = Number(c.req.query("page") ?? 1);
  const requestedLimit = Number(c.req.query("limit") ?? 50);
  if (!Number.isSafeInteger(requestedPage) || !Number.isSafeInteger(requestedLimit)) {
    return c.json({ error: "Page and limit must be whole numbers" }, 400);
  }
  const page = Math.min(5_000, Math.max(1, requestedPage));
  const limit = Math.min(200, Math.max(1, requestedLimit));

  try {
    // Build filter conditions
    const conditions = [];
    if (type === "reagent") conditions.push(eq(items.isReagent, true));
    else if (type === "crafted") conditions.push(eq(items.isCraftedOutput, true));
    else if (type === "commodity") {
      conditions.push(eq(items.marketType, "commodity"));
    } else if (type === "gear" || type === "realm") {
      conditions.push(eq(items.marketType, "realm"));
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
    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.min(page, Math.max(1, totalPages));
    const offset = (currentPage - 1) * limit;

    // Get paginated items
    const itemRows = await db.select().from(items).where(whereClause).orderBy(items.name, items.id).limit(limit).offset(offset);

    // Fetch current market state for these items.
    const itemIds = itemRows.map((i) => i.id);
    const currentMarkets = await getCurrentItemMarkets(region, itemIds, connectedRealmId);

    // Build response with price source info
    const enrichedItems = itemRows.map((item) => {
      const market = currentMarkets.get(item.id);

      return {
        id: item.id,
        name: item.name,
        itemQuality: item.itemQuality,
        qualityRank: item.qualityRank,
        isReagent: item.isReagent,
        isCraftedOutput: item.isCraftedOutput,
        marketType: item.marketType,
        priceSource: market?.priceSource ?? null,
        latestPrice: market?.currentQuote ?? null,
        regionLatestPrice: market?.commodityQuote ?? market?.euRealmBenchmark ?? null,
        realmLatestPrice: market?.selectedRealmQuote ?? null,
      };
    });

    c.header("Cache-Control", search ? "public, max-age=15" : "public, max-age=30, stale-while-revalidate=120");
    return c.json({
      items: enrichedItems,
      total,
      page: currentPage,
      totalPages,
    });
  } catch (err) {
    console.error("[Items] Error listing items:", err);
    return c.json({ error: "Failed to list items" }, 500);
  }
});

// ─── GET /:itemId — Item metadata ───────────────────────────────────

itemRoutes.get("/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (!isDatabaseId(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);

  if (!item) return c.json({ error: "Item not found" }, 404);
  return c.json(item);
});

// ─── GET /:itemId/prices — Price history ────────────────────────────

itemRoutes.get("/:itemId/prices", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (!isDatabaseId(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const rangeQuery = c.req.query("range") || "24h";
  if (!isHistoryRange(rangeQuery)) return c.json({ error: "Invalid history range" }, 400);
  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);
  const typeQuery = c.req.query("type") || "auto";
  if (!["auto", "commodity", "realm"].includes(typeQuery)) return c.json({ error: "Invalid market history type" }, 400);
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !isDatabaseId(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    return c.json(
      await getItemMarketHistory(itemId, region, rangeQuery, typeQuery as MarketHistoryType, connectedRealmId),
    );
  } catch (err) {
    console.error(`[Items] Error fetching prices for item ${itemId}:`, err);
    return c.json({ error: "Failed to fetch price data" }, 500);
  }
});

// ─── GET /:itemId/realm-prices — Per-realm current snapshot ─────────

itemRoutes.get("/:itemId/realm-prices", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  if (!isDatabaseId(itemId)) return c.json({ error: "Invalid item ID" }, 400);

  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);

  try {
    const data = (await getCurrentRealmComparison(region, itemId)).map((row) => ({
      realm_id: row.connectedRealmId,
      realm_name: row.connectedRealmName,
      min_buyout: row.quote.minPrice,
      avg_buyout: row.quote.avgPrice,
      total_quantity: row.quote.totalQuantity,
      variant_count: row.quote.variantCount ?? 0,
      observed_at: row.quote.observedAt,
    }));

    return c.json(data);
  } catch (err) {
    console.error(`[Items] Error fetching realm prices for item ${itemId}:`, err);
    return c.json({ error: "Failed to fetch realm price data" }, 500);
  }
});

export default itemRoutes;
