import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { items, professions } from "../db/schema";
import { isDatabaseId } from "../routes/validation";
import { currentMarketFilterQuery, getCurrentItemMarkets } from "./current-market";
import { MAX_ITEM_EXPANSION } from "./item-expansion-data";

const sorts = {
  "name-asc": sql`i.name ASC, i.id ASC`,
  "name-desc": sql`i.name DESC, i.id ASC`,
  "price-asc": sql`quote.min_price ASC NULLS LAST, i.name ASC, i.id ASC`,
  "price-desc": sql`quote.min_price DESC NULLS LAST, i.name ASC, i.id ASC`,
  "quantity-asc": sql`quote.quantity ASC NULLS LAST, i.name ASC, i.id ASC`,
  "quantity-desc": sql`quote.quantity DESC NULLS LAST, i.name ASC, i.id ASC`,
};

export function parseItemFilters(query: Record<string, string>) {
  const filters: SQL[] = [];
  const region = query.region || "eu";
  const type = query.type || "all";
  const search = (query.search || "").trim();
  const sort = query.sort || "name-asc";
  if (region !== "eu") throw new Error("Only the EU region is available");
  if (!["all", "commodity", "realm", "gear", "reagent", "crafted"].includes(type)) throw new Error("Invalid item type");
  if (!Object.hasOwn(sorts, sort)) throw new Error("Invalid sort order");
  if (search.length > 100) throw new Error("Search must be 100 characters or fewer");
  if (query.searchMode && !["contains", "exact"].includes(query.searchMode)) throw new Error("Invalid search mode");
  if (search) {
    const nameMatch = query.searchMode === "exact"
      ? sql`lower(i.name) = lower(${search})`
      : sql`i.name ILIKE ${`%${search.replace(/[%_\\]/g, "\\$&")}%`}`;
    filters.push(/^\d+$/.test(search) && isDatabaseId(Number(search)) ? sql`(${nameMatch} OR i.id = ${Number(search)})` : nameMatch);
  }
  if (type === "commodity") filters.push(sql`i.market_type = 'commodity'`);
  if (type === "realm" || type === "gear") filters.push(sql`i.market_type = 'realm'`);
  const usage = query.usage || (type === "reagent" || type === "crafted" ? type : "all");
  if (!["all", "reagent", "crafted"].includes(usage)) throw new Error("Invalid crafting use");
  if (usage === "reagent") filters.push(sql`i.is_reagent = true`);
  if (usage === "crafted") filters.push(sql`i.is_crafted_output = true`);

  for (const [key, column] of [["category", sql`i.item_class`], ["subcategory", sql`i.item_subclass`], ["slot", sql`i.inventory_type`]] as const) {
    const value = query[key];
    if (!value) continue;
    if (value.length > 100) throw new Error(`${key} must be 100 characters or fewer`);
    filters.push(value === "unknown" ? sql`${column} IS NULL` : sql`${column} = ${value}`);
  }
  function integer(key: string, max = Number.MAX_SAFE_INTEGER) {
    const raw = query[key];
    if (raw === undefined || raw === "") return undefined;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value > max) throw new Error(`Invalid ${key}`);
    return value;
  }
  const connectedRealmId = integer("connectedRealmId", 2147483647);
  if (connectedRealmId !== undefined && !isDatabaseId(connectedRealmId)) throw new Error("Invalid connected realm ID");
  if (query.expansion === "unknown") filters.push(sql`NOT EXISTS (SELECT 1 FROM item_expansions e WHERE e.item_id = i.id)`);
  else if (query.expansion) {
    const expansion = integer("expansion", MAX_ITEM_EXPANSION);
    if (!expansion || String(expansion) !== query.expansion) throw new Error("Invalid expansion");
    filters.push(sql`EXISTS (SELECT 1 FROM item_expansions e WHERE e.item_id = i.id AND e.expansion = ${expansion})`);
  }
  const profession = integer("profession", 2147483647);
  if (profession !== undefined) {
    if (!isDatabaseId(profession)) throw new Error("Invalid profession");
    // Catalog reagent links plus every output rank, without multiplying rows.
    filters.push(sql`EXISTS (
      SELECT 1 FROM item_professions ip WHERE ip.item_id = i.id AND ip.profession_id = ${profession}
      UNION ALL SELECT 1 FROM recipes r WHERE r.output_item_id = i.id AND r.profession_id = ${profession}
      UNION ALL SELECT 1 FROM recipe_output_qualities oq JOIN recipes r ON r.id = oq.recipe_id
        WHERE oq.item_id = i.id AND r.profession_id = ${profession}
    )`);
  }
  if (query.rarity === "unknown") filters.push(sql`i.item_quality IS NULL`);
  else {
    const rarity = integer("rarity", 8);
    if (rarity !== undefined) filters.push(sql`i.item_quality = ${rarity}`);
  }
  if (query.rank === "none") filters.push(sql`i.quality_rank IS NULL`);
  else {
    const rank = integer("rank", 5);
    if (rank !== undefined) {
      if (rank === 0) throw new Error("Invalid rank");
      filters.push(sql`i.quality_rank = ${rank}`);
    }
  }
  let needsQuotes = sort.startsWith("price-") || sort.startsWith("quantity-");
  const availability = query.availability || "all";
  if (!["all", "listed", "unlisted"].includes(availability)) throw new Error("Invalid availability");
  if (availability !== "all") {
    needsQuotes = true;
    filters.push(availability === "listed"
      ? sql`quote.min_price IS NOT NULL AND quote.quantity > 0`
      : sql`(quote.min_price IS NULL OR quote.quantity = 0)`);
  }
  for (const [minKey, maxKey, column] of [
    ["minPrice", "maxPrice", sql`quote.min_price`],
    ["minQuantity", "maxQuantity", sql`quote.quantity`],
  ] as const) {
    const min = integer(minKey);
    const max = integer(maxKey);
    if (min !== undefined && max !== undefined && min > max) throw new Error(`${minKey} must not exceed ${maxKey}`);
    if (min !== undefined) { filters.push(sql`${column} >= ${min}`); needsQuotes = true; }
    if (max !== undefined) { filters.push(sql`${column} <= ${max}`); needsQuotes = true; }
  }
  const page = integer("page") ?? 1;
  const limit = integer("limit") ?? 50;
  return { region, connectedRealmId, search, filters, needsQuotes, commodityOnly: type === "commodity", sort: sort as keyof typeof sorts,
    page: Math.min(5000, Math.max(1, page)), limit: Math.min(200, Math.max(1, limit)) };
}

export async function browseItems(query: ReturnType<typeof parseItemFilters>) {
  const quoteJoin = query.needsQuotes
    ? sql`LEFT JOIN (${currentMarketFilterQuery(query.region, query.connectedRealmId, query.commodityOnly)}) quote ON quote.item_id = i.id`
    : sql``;
  const from = sql`FROM items i ${quoteJoin} WHERE ${query.filters.length ? sql.join(query.filters, sql` AND `) : sql`true`}`;
  // Counts, matching rows and displayed quotes must agree during market refreshes.
  return db.transaction(async (tx) => {
    const [count] = await tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total ${from}`);
    const total = count?.total ?? 0;
    const totalPages = Math.ceil(total / query.limit);
    const page = Math.min(query.page, Math.max(1, totalPages));
    const rows = await tx.execute<Omit<typeof items.$inferSelect, "metadataStatus" | "metadataUpdatedAt">>(sql`
      SELECT i.id, i.name, i.item_quality AS "itemQuality", i.quality_rank AS "qualityRank",
        i.is_reagent AS "isReagent", i.is_crafted_output AS "isCraftedOutput", i.market_type AS "marketType",
        i.item_class AS "itemClass", i.item_subclass AS "itemSubclass", i.inventory_type AS "inventoryType"
      ${from} ORDER BY ${sorts[query.sort]} LIMIT ${query.limit} OFFSET ${(page - 1) * query.limit}
    `);
    const markets = await getCurrentItemMarkets(query.region, rows.map(row => row.id), query.connectedRealmId, query.commodityOnly, tx);
    return {
      items: rows.map(item => {
        const market = markets.get(item.id);
        return { ...item, priceSource: market?.priceSource ?? null, latestPrice: market?.currentQuote ?? null,
          regionLatestPrice: market?.commodityQuote ?? market?.euRealmBenchmark ?? null,
          realmLatestPrice: market?.selectedRealmQuote ?? null };
      }), total, page, totalPages,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getItemFilterOptions() {
  const [metadata, catalogProfessions] = await Promise.all([
    db.selectDistinct({ category: items.itemClass, subcategory: items.itemSubclass, slot: items.inventoryType }).from(items),
    db.select({ id: professions.id, name: professions.name, expansion: professions.expansion }).from(professions).orderBy(professions.name),
  ]);
  const categories = new Map<string, Set<string>>();
  const slots = new Set<string>();
  for (const row of metadata) {
    if (row.category) {
      const subcategories = categories.get(row.category) ?? new Set<string>();
      if (row.subcategory) subcategories.add(row.subcategory);
      categories.set(row.category, subcategories);
    }
    if (row.slot && !["Non-equippable", "NON_EQUIP"].includes(row.slot)) slots.add(row.slot);
  }
  return { categories: [...categories].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => ({ name, subcategories: [...values].sort() })),
    slots: [...slots].sort(), professions: catalogProfessions };
}
