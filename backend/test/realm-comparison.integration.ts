import "./support/local-env";
import { afterAll, beforeAll, expect, test } from "bun:test";
import app from "../src/app";
import { sql } from "../src/db";
import { createAuctionRefreshModule } from "../src/services/auction-refresh";

const itemIds = [1900090001, 1900090002, 1900090003];
const realmIds = [1900090401, 1900090402];

beforeAll(async () => {
  await sql`INSERT INTO professions (id, name) VALUES (1900090201, 'Comparison fixture')`;
  await sql`INSERT INTO recipe_categories (id, name, profession_id)
    VALUES (1900090301, 'Ranked gems fixture', 1900090201)`;
  for (const id of itemIds) {
    await sql`INSERT INTO items (id, name, is_crafted_output)
      VALUES (${id}, ${`Comparison fixture ${id}`}, true)`;
  }
  await sql`INSERT INTO recipes (id, name, profession_id, category_id, output_item_id)
    VALUES (1900090101, 'Ranked gem', 1900090201, 1900090301, 1900090001),
           (1900090102, 'Uncategorized craft', 1900090201, NULL, 1900090003)`;
  await sql`INSERT INTO recipe_output_qualities (recipe_id, rank, quality_id, item_id)
    VALUES (1900090101, 1, 1, 1900090001), (1900090101, 2, 2, 1900090002)`;
  const refresh = createAuctionRefreshModule({ realmHistoryIntervalHours: 1, source: {
    fetchCommodityAuctions: async () => [],
    fetchRealmAuctions: async (_region, realmId) => itemIds.map((id) => ({
      id, item: { id }, quantity: 1, buyout: realmId === realmIds[0] ? 10_000 : 100_010_000,
    })),
  } });
  for (const realmId of realmIds) await refresh.refreshRealm("eu", realmId, new Set());
});

afterAll(async () => {
  await sql`DELETE FROM realm_latest WHERE item_id IN ${sql(itemIds)}`;
  await sql`DELETE FROM market_observations WHERE region_id = 'eu' AND connected_realm_id IN ${sql(realmIds)}`;
  await sql`DELETE FROM auction_sync_runs WHERE connected_realm_id IN ${sql(realmIds)}`;
  await sql`DELETE FROM recipe_output_qualities WHERE recipe_id = 1900090101`;
  await sql`DELETE FROM recipes WHERE profession_id = 1900090201`;
  await sql`DELETE FROM recipe_categories WHERE profession_id = 1900090201`;
  await sql`DELETE FROM professions WHERE id = 1900090201`;
  await sql`DELETE FROM items WHERE id IN ${sql(itemIds)}`;
  await sql.end();
});

test("realm comparison categorizes every crafted output rank and filters them consistently", async () => {
  async function opportunities(filter = "") {
    const response = await app.request(`/api/flipping/opportunities?minSpread=90000000${filter}`);
    expect(response.status).toBe(200);
    return await response.json() as { itemId: number; categoryId: number | null; categoryName: string | null; professionName: string | null }[];
  }
  const all = await opportunities();
  expect(all.find((row) => row.itemId === 1900090002)).toMatchObject({
    categoryId: 1900090301, categoryName: "Ranked gems fixture", professionName: "Comparison fixture",
  });
  expect(all.filter((row) => row.itemId === 1900090001)).toHaveLength(1);
  for (const filter of ["&categoryId=1900090301", "&categoryName=Ranked%20gems%20fixture"]) {
    expect((await opportunities(filter)).map((row) => row.itemId).sort()).toEqual([1900090001, 1900090002]);
  }
  expect((await opportunities("&uncategorized=true")).map((row) => row.itemId)).toEqual([1900090003]);
  const categories = await (await app.request("/api/flipping/categories")).json() as { categoryName: string | null }[];
  expect(categories.filter((row) => row.categoryName === "Ranked gems fixture")).toHaveLength(1);
});
