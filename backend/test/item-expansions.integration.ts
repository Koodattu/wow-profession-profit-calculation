import "./support/local-env";
import { afterAll, expect, test } from "bun:test";
import { sql } from "../src/db";
import app from "../src/app";
import { createAuctionRefreshModule } from "../src/services/auction-refresh";
import { ensureItemExpansions } from "../src/services/item-expansions";
import { readBundledItemExpansions } from "../src/services/item-expansion-data";

const unknownId = 1900200001;
const fixtureRealm = 1900200001;
let newItemIds: number[] = [];

afterAll(async () => {
  await sql`DELETE FROM realm_latest WHERE connected_realm_id = ${fixtureRealm}`;
  await sql`DELETE FROM realm_history_blocks WHERE connected_realm_id = ${fixtureRealm}`;
  await sql`DELETE FROM market_observations WHERE connected_realm_id = ${fixtureRealm}`;
  await sql`DELETE FROM auction_sync_runs WHERE connected_realm_id = ${fixtureRealm}`;
  await sql`DELETE FROM connected_realms WHERE id = ${fixtureRealm}`;
  if (newItemIds.length) await sql`DELETE FROM items WHERE id IN ${sql(newItemIds)}`;
  await sql.end();
});

test("bundled eras classify subsequently discovered auctions without assuming unknown IDs are Midnight", async () => {
  const expected = [[2447, "1"], [210796, "11"], [236761, "12"], [unknownId, "unknown"]] as const;
  const existing = await sql<{ id: number }[]>`SELECT id FROM items WHERE id IN ${sql(expected.map(([id]) => id))}`;
  newItemIds = expected.map(([id]) => id).filter(id => !existing.some(item => item.id === id));
  await sql`INSERT INTO connected_realms (id, region_id) VALUES (${fixtureRealm}, 'eu')`;
  expect(await ensureItemExpansions()).toBe("already-present");
  const refresh = createAuctionRefreshModule({ realmHistoryIntervalHours: 1, source: {
    fetchCommodityAuctions: async () => [],
    fetchRealmAuctions: async () => expected.map(([id]) => ({ id, item: { id }, quantity: 1, buyout: 10000 })),
  } });
  await refresh.refreshRealm("eu", fixtureRealm, new Set());
  for (const [id, expansion] of expected) {
    const response = await app.request(`/api/items?search=${id}&expansion=${expansion}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { items: Array<{ id: number }> };
    expect(result.items.map(item => item.id)).toEqual([id]);
  }
  const midnight = await app.request(`/api/items?search=${unknownId}&expansion=12`);
  expect(await midnight.json()).toMatchObject({ total: 0, items: [] });
  const before = await app.request('/api/items?search=236761&expansion=12');
  const invalid = await readBundledItemExpansions();
  invalid.expansions['236761'] = 0;
  await expect(ensureItemExpansions(invalid)).rejects.toThrow('Invalid item expansion reference');
  const after = await app.request('/api/items?search=236761&expansion=12');
  expect(await after.json()).toEqual(await before.json());
  expect(await ensureItemExpansions()).toBe("already-present");
}, 15000);
