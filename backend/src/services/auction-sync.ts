import { eq } from "drizzle-orm";
import { db } from "../db";
import { commoditySnapshots, realmSnapshots, connectedRealms, items } from "../db/schema";
import { BlizzardApi } from "./blizzard-api";

// ─── API Response Types ──────────────────────────────────────────────

interface CommodityAuction {
  id: number;
  item: { id: number };
  quantity: number;
  unit_price: number;
  time_left: string;
}

interface CommodityResponse {
  auctions: CommodityAuction[];
}

interface RealmAuction {
  id: number;
  item: { id: number; bonus_lists?: number[]; modifiers?: unknown[] };
  buyout?: number;
  bid?: number;
  quantity: number;
  time_left: string;
}

interface RealmAuctionResponse {
  auctions: RealmAuction[];
}

// ─── Percentile Helper ──────────────────────────────────────────────

interface PriceEntry {
  price: number;
  quantity: number;
}

/**
 * Compute a weighted percentile from sorted price entries.
 * Entries must be sorted ascending by price.
 * Walks through accumulated quantity to find the value at the target position.
 */
function weightedPercentile(sorted: PriceEntry[], totalQuantity: number, percentile: number): number {
  const targetPos = Math.ceil(totalQuantity * (percentile / 100));
  let accumulated = 0;
  for (const entry of sorted) {
    accumulated += entry.quantity;
    if (accumulated >= targetPos) {
      return entry.price;
    }
  }
  return sorted[sorted.length - 1]!.price;
}

// ─── Commodity Sync ─────────────────────────────────────────────────

export async function syncCommodities(regionId: string): Promise<void> {
  const api = BlizzardApi.getInstance();
  const snapshotTime = new Date();

  console.log(`[AuctionSync] Fetching commodities for ${regionId}...`);
  const data = await api.get<CommodityResponse>(regionId, "/data/wow/auctions/commodities", "dynamic");

  const auctions = data.auctions;
  console.log(`[AuctionSync] Received ${auctions.length} commodity auctions`);

  // Load known item IDs from DB
  const knownRows = await db.select({ id: items.id }).from(items);
  const knownItemIds = new Set(knownRows.map((r) => r.id));

  // Group auctions by item_id, filtering to known items only
  const grouped = new Map<number, PriceEntry[]>();
  for (const auction of auctions) {
    const itemId = auction.item.id;
    if (!knownItemIds.has(itemId)) continue;
    let entries = grouped.get(itemId);
    if (!entries) {
      entries = [];
      grouped.set(itemId, entries);
    }
    entries.push({ price: auction.unit_price, quantity: auction.quantity });
  }

  // Build snapshot rows
  const rows: (typeof commoditySnapshots.$inferInsert)[] = [];

  for (const [itemId, entries] of grouped) {
    // Sort by price ascending for percentile calculations
    entries.sort((a, b) => a.price - b.price);

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let totalValue = 0;
    let totalQuantity = 0;

    for (const e of entries) {
      if (e.price < minPrice) minPrice = e.price;
      if (e.price > maxPrice) maxPrice = e.price;
      totalValue += e.price * e.quantity;
      totalQuantity += e.quantity;
    }

    const avgPrice = Math.round(totalValue / totalQuantity);
    const medianPrice = weightedPercentile(entries, totalQuantity, 50);
    const priceP10 = weightedPercentile(entries, totalQuantity, 10);
    const priceP25 = weightedPercentile(entries, totalQuantity, 25);

    rows.push({
      regionId,
      itemId,
      snapshotTime,
      minPrice,
      avgPrice,
      medianPrice,
      maxPrice,
      totalQuantity,
      numAuctions: entries.length,
      priceP10,
      priceP25,
    });
  }

  // Batch insert snapshots
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(commoditySnapshots).values(batch);
  }

  console.log(`[AuctionSync] Commodity sync complete: ${grouped.size} items (of ${auctions.length} auctions)`);
}

// ─── Realm Auction Sync ─────────────────────────────────────────────

export async function syncRealmAuctions(regionId: string, connectedRealmId: number): Promise<void> {
  const api = BlizzardApi.getInstance();
  const snapshotTime = new Date();

  console.log(`[AuctionSync] Fetching realm auctions for connected realm ${connectedRealmId}...`);
  const data = await api.get<RealmAuctionResponse>(regionId, `/data/wow/connected-realm/${connectedRealmId}/auctions`, "dynamic");

  const auctions = data.auctions;
  console.log(`[AuctionSync] Received ${auctions.length} realm auctions for CR ${connectedRealmId}`);

  // Only process auctions with a buyout
  const buyoutAuctions = auctions.filter((a) => a.buyout != null && a.buyout > 0);

  // Load known item IDs from DB
  const knownRows = await db.select({ id: items.id }).from(items);
  const knownItemIds = new Set(knownRows.map((r) => r.id));

  // Group by item_id — buyout is total price, so per-unit = buyout / quantity
  const grouped = new Map<number, PriceEntry[]>();
  for (const auction of buyoutAuctions) {
    const itemId = auction.item.id;
    if (!knownItemIds.has(itemId)) continue;
    const perUnit = Math.round(auction.buyout! / auction.quantity);
    let entries = grouped.get(itemId);
    if (!entries) {
      entries = [];
      grouped.set(itemId, entries);
    }
    entries.push({ price: perUnit, quantity: auction.quantity });
  }

  // Build snapshot rows
  const rows: (typeof realmSnapshots.$inferInsert)[] = [];

  for (const [itemId, entries] of grouped) {
    entries.sort((a, b) => a.price - b.price);

    let minBuyout = Infinity;
    let maxBuyout = -Infinity;
    let totalValue = 0;
    let totalQuantity = 0;

    for (const e of entries) {
      if (e.price < minBuyout) minBuyout = e.price;
      if (e.price > maxBuyout) maxBuyout = e.price;
      totalValue += e.price * e.quantity;
      totalQuantity += e.quantity;
    }

    const avgBuyout = Math.round(totalValue / totalQuantity);
    const medianBuyout = weightedPercentile(entries, totalQuantity, 50);

    rows.push({
      connectedRealmId,
      regionId,
      itemId,
      snapshotTime,
      minBuyout,
      avgBuyout,
      medianBuyout,
      maxBuyout,
      totalQuantity,
      numAuctions: entries.length,
    });
  }

  // Batch insert snapshots
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(realmSnapshots).values(batch);
  }

  console.log(`[AuctionSync] Realm auction sync complete for CR ${connectedRealmId}: ${grouped.size} items (of ${buyoutAuctions.length} auctions)`);
}

// ─── Sync All Realm Auctions ────────────────────────────────────────

export async function syncAllRealmAuctions(regionId: string): Promise<void> {
  const realmRows = await db.select({ id: connectedRealms.id }).from(connectedRealms).where(eq(connectedRealms.regionId, regionId));

  console.log(`[AuctionSync] Starting realm auction sync for ${realmRows.length} connected realms in ${regionId}`);

  for (let i = 0; i < realmRows.length; i++) {
    const row = realmRows[i]!;
    try {
      await syncRealmAuctions(regionId, row.id);
    } catch (err) {
      console.error(`[AuctionSync] Failed to sync CR ${row.id}:`, err);
    }
    console.log(`[AuctionSync] Realm progress: ${i + 1}/${realmRows.length}`);
  }

  console.log(`[AuctionSync] All realm auctions synced for ${regionId}`);
}
