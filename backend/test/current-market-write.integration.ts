import { afterAll, describe, expect, test } from "bun:test";
import { db, sql } from "../src/db";
import { commodityLatest, regions } from "../src/db/schema";
import { createAuctionRefreshModule, type CommodityAuctionInput, type RealmAuctionInput } from "../src/services/auction-refresh";
import { getCurrentItemMarkets, getCurrentRealmComparison } from "../src/services/current-market";
import { writeCurrentMarket } from "../src/services/current-market-write";
import { unpackRealmListings } from "../src/services/realm-variant-storage";

const region = "writetest";
const item = 2_100_002_000;
async function clean() {
  for (const table of ["commodity_snapshots", "realm_snapshots", "commodity_latest", "realm_latest", "auction_sync_runs"]) {
    await sql.unsafe(`DELETE FROM ${table} WHERE region_id = $1`, [region]);
  }
  await sql`DELETE FROM regions WHERE id = ${region}`;
  await sql`DELETE FROM items WHERE id BETWEEN ${item} AND ${item + 3}`;
}
afterAll(async () => { await clean(); await sql.end(); });

describe.serial("incremental current market", () => {
  test("unchanged content avoids heap rewrites while quotes and weighted history stay fresh", async () => {
    await clean();
    await db.insert(regions).values({ id: region, name: "Write test", apiHost: "invalid.local", oauthHost: "invalid.local" });
    let now = new Date("2026-09-10T10:00:00Z");
    let commodities: CommodityAuctionInput[] = [{ item: { id: item }, quantity: 3, unit_price: 100 }];
    let auctions: RealmAuctionInput[] = [
      { id: 2, item: { id: item + 1, bonus_lists: [2, 1] }, buyout: 101, quantity: 3, time_left: "LONG" },
      { id: 1, item: { id: item + 1, bonus_lists: [1, 2] }, buyout: 200, quantity: 2, time_left: "LONG" },
    ];
    const refresh = createAuctionRefreshModule({ realmHistoryIntervalHours: 1, now: () => now, source: {
      fetchCommodityAuctions: async () => commodities, fetchRealmAuctions: async () => auctions,
    } });
    await refresh.refreshCommodities(region);
    await refresh.refreshRealm(region, 123, new Set([item + 1]));
    await refresh.refreshRealm(region, 124, new Set());
    const commodityBefore = [...await sql`SELECT xmin::text, ctid::text FROM commodity_latest WHERE region_id=${region}`];
    const realmBefore = [...await sql`SELECT xmin::text, ctid::text FROM realm_latest WHERE region_id=${region} AND connected_realm_id=123`];
    const catalogBefore = [...await sql`SELECT id,xmin::text FROM items WHERE id IN (${item},${item + 1}) ORDER BY id`];
    expect((await sql`SELECT count(DISTINCT variant_id)::int AS n FROM realm_latest WHERE region_id=${region}`)[0]?.n).toBe(1);
    const sequenceBefore = [...await sql`SELECT last_value FROM realm_variants_id_seq`];
    now = new Date("2026-09-10T11:00:00Z");
    auctions.reverse();
    await refresh.refreshCommodities(region);
    await refresh.refreshRealm(region, 123, new Set([item + 1]));
    expect([...await sql`SELECT xmin::text, ctid::text FROM commodity_latest WHERE region_id=${region}`]).toEqual(commodityBefore);
    expect([...await sql`SELECT xmin::text, ctid::text FROM realm_latest WHERE region_id=${region} AND connected_realm_id=123`]).toEqual(realmBefore);
    expect([...await sql`SELECT id,xmin::text FROM items WHERE id IN (${item},${item + 1}) ORDER BY id`]).toEqual(catalogBefore);
    expect([...await sql`SELECT last_value FROM realm_variants_id_seq`]).toEqual(sequenceBefore);
    const quotes = await getCurrentItemMarkets(region, [item, item + 1], 123);
    expect(quotes.get(item)?.currentQuote?.observedAt).toEqual(now);
    expect(quotes.get(item + 1)?.currentQuote).toMatchObject({ observedAt: now, avgPrice: 60, totalQuantity: 5 });
    expect(quotes.get(item + 1)?.euRealmBenchmark?.observedAt).toEqual(now);
    const realms = await getCurrentRealmComparison(region, item + 1);
    expect(realms.find((row) => row.connectedRealmId === 123)?.quote.observedAt).toEqual(now);
    expect(realms.find((row) => row.connectedRealmId === 124)?.quote.observedAt).toEqual(new Date("2026-09-10T10:00:00Z"));
    expect([...await sql`SELECT total_value::text FROM realm_snapshots WHERE region_id=${region} ORDER BY snapshot_time`]).toEqual([{ total_value: "301" }, { total_value: "301" }]);
    expect((await sql`SELECT count(*)::int AS n FROM commodity_snapshots WHERE region_id=${region}`)[0]?.n).toBe(2);

    // Listing time/bid changes must publish even when aggregate prices are equal.
    auctions[0]!.time_left = "SHORT";
    auctions[0]!.bid = 80;
    now = new Date("2026-09-10T11:10:00Z");
    await refresh.refreshRealm(region, 123, new Set());
    const changed = await sql`SELECT listings FROM realm_latest WHERE region_id=${region} AND connected_realm_id=123`;
    expect(unpackRealmListings(changed[0]!.listings)[0]).toMatchObject({ id: "1", bid: 80, timeLeft: "SHORT" });

    auctions = [{ id: 3, item: { id: item + 2 }, buyout: Number.MAX_SAFE_INTEGER, quantity: 2 },
      { id: 4, item: { id: item + 2 }, buyout: Number.MAX_SAFE_INTEGER, quantity: 3 }];
    await refresh.refreshRealm(region, 123, new Set());
    expect([...await sql`SELECT item_id,total_value::text FROM realm_latest WHERE region_id=${region} AND connected_realm_id=123`])
      .toEqual([{ item_id: item + 2, total_value: "18014398509481982" }]);
    expect((await sql`SELECT item_id FROM realm_latest WHERE region_id=${region} AND connected_realm_id=124`)[0]?.item_id).toBe(item + 1);
    commodities = [];
    auctions = [];
    await refresh.refreshCommodities(region);
    await refresh.refreshRealm(region, 123, new Set());
    expect((await getCurrentItemMarkets(region, [item, item + 2], 123)).get(item)?.currentQuote).toBeNull();
    expect([...await sql`SELECT item_id FROM realm_latest WHERE region_id=${region} AND connected_realm_id=123`]).toHaveLength(0);
  });

  test("rollback and an older observation cannot replace published content or freshness", async () => {
    await clean();
    await db.insert(regions).values({ id: region, name: "Write test", apiHost: "invalid.local", oauthHost: "invalid.local" });
    await sql`INSERT INTO items(id,name) VALUES (${item},'Rollback fixture')`;
    await db.transaction((tx) => writeCurrentMarket(tx, commodityLatest, [], region, 0, 1, new Date("2026-09-10T11:00:00Z")));
    const before = [...await sql`SELECT * FROM market_observations WHERE region_id=${region} AND connected_realm_id=0`];
    await expect(db.transaction(async (tx) => {
      await writeCurrentMarket(tx, commodityLatest, [{ regionId: region, itemId: item, syncRunId: 999,
        observedAt: new Date("2026-09-10T12:00:00Z"), minPrice: 1, avgPrice: 1, medianPrice: 1, maxPrice: 1,
        totalQuantity: 1, numAuctions: 1, priceP10: 1, priceP25: 1, totalValue: "1" }], region, 0, 999, new Date("2026-09-10T12:00:00Z"));
      throw new Error("fixture commit failure");
    })).rejects.toThrow("fixture commit failure");
    expect([...await sql`SELECT * FROM market_observations WHERE region_id=${region} AND connected_realm_id=0`]).toEqual(before);
    expect([...await sql`SELECT * FROM commodity_latest WHERE region_id=${region}`]).toHaveLength(0);
    await expect(db.transaction((tx) => writeCurrentMarket(tx, commodityLatest, [], region, 0, 1000, new Date("2026-09-10T09:00:00Z"))))
      .rejects.toThrow("newer auction observation");
  });
});
