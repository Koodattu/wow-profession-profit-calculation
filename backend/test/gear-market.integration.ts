import { afterAll, expect, test } from "bun:test";
import { db, sql } from "../src/db";
import { items, regions } from "../src/db/schema";
import itemRoutes from "../src/routes/items";
import { createAuctionRefreshModule, type RealmAuctionInput } from "../src/services/auction-refresh";
import { getGearListings, getGearVariants } from "../src/services/gear-market";

const itemId = 2_147_480_001;
const realmId = 2_147_480_001;
async function clean() {
  await sql`DELETE FROM realm_latest WHERE item_id = ${itemId}`;
  await sql`DELETE FROM auction_sync_runs WHERE connected_realm_id IN (${realmId}, ${realmId + 1})`;
  await sql`DELETE FROM items WHERE id = ${itemId}`;
}
afterAll(async () => { await clean(); await sql.end(); });

test("current listings preserve exact quantities, isolate realms and versions, paginate, and survive failed refreshes", async () => {
  await clean();
  await db.insert(regions).values({ id: "eu", name: "Europe", apiHost: "eu.api.blizzard.com", oauthHost: "oauth.battle.net" }).onConflictDoNothing();
  await db.insert(items).values({ id: itemId, name: "Gear listing integration fixture", metadataStatus: "complete" });
  let fail = false;
  let auctions: RealmAuctionInput[] = [
    { id: 9001, item: { id: itemId, bonus_lists: [12849, 13335], modifiers: [{ type: 29, value: 32 }] }, buyout: 101, quantity: 3, bid: 90, time_left: "LONG" },
    ...Array.from({ length: 51 }, (_, index) => ({ id: 10000 + index, item: { id: itemId, bonus_lists: [13335, 12849], modifiers: [{ type: 29, value: 32 }] }, buyout: 200 + index, quantity: 2 })),
    { id: 9002, item: { id: itemId, bonus_lists: [12854, 13335] }, buyout: 1000, quantity: 1 },
    { id: 9003, item: { id: itemId }, bid: 50, quantity: 1 },
  ];
  const refresh = createAuctionRefreshModule({ realmHistoryIntervalHours: 1, source: {
    fetchCommodityAuctions: async () => [], fetchRealmAuctions: async () => { if (fail) throw new Error("fixture unavailable"); return auctions; },
  } });
  await refresh.refreshRealm("eu", realmId, new Set());
  const variants = await getGearVariants(itemId);
  expect(variants.variants).toHaveLength(2);
  const key = variants.variants.find((variant) => variant.bonusLists.includes(12849))!.key;
  const page1 = await getGearListings(itemId, realmId, key, 1);
  expect(page1).toMatchObject({ total: 52, totalPages: 2, detailsAvailable: true });
  expect(page1.listings).toHaveLength(50);
  expect(page1.listings[0]).toEqual({ id: "9001", buyout: 101, quantity: 3, bid: 90, timeLeft: "LONG" });
  expect((await getGearListings(itemId, realmId, key, 2)).listings).toHaveLength(2);
  expect((await getGearListings(itemId, realmId + 1, key, 1)).listings).toHaveLength(0);
  const response = await itemRoutes.request(`/${itemId}/listings?connectedRealmId=${realmId}&variant=${key}`);
  expect(response.status).toBe(200);
  const payload = await response.json() as Awaited<ReturnType<typeof getGearListings>>;
  expect(payload.listings[0]!.buyout).toBe(101);
  fail = true;
  await expect(refresh.refreshRealm("eu", realmId, new Set())).rejects.toThrow("fixture unavailable");
  expect(await getGearListings(itemId, realmId, key, 1)).toEqual(page1);
  fail = false; auctions = [];
  await refresh.refreshRealm("eu", realmId, new Set());
  expect((await getGearVariants(itemId)).variants).toHaveLength(0);
  expect((await getGearListings(itemId, realmId, key, 1)).listings).toHaveLength(0);
});

test("listing endpoints reject invalid identities and pagination", async () => {
  for (const path of ["/0/variants", "/NaN/variants", "/1/listings", "/1/listings?connectedRealmId=1&variant=bad", "/1/listings?connectedRealmId=1&variant=base&page=-1", "/1/listings?connectedRealmId=1&variant=base&page=1.5"]) {
    expect((await itemRoutes.request(path)).status).toBe(400);
  }
});
