import "./support/local-env";
import { afterAll, beforeAll, expect, test } from "bun:test";
import app from "../src/app";
import { sql } from "../src/db";

const firstId = 1900100001;
let variantId: number;
beforeAll(async () => {
  for (let index = 0; index < 6; index++) {
    const id = firstId + index;
    await sql`INSERT INTO items (id, name, market_type, item_class, item_subclass, inventory_type, item_quality, quality_rank, is_reagent)
      VALUES (${id}, ${`Filter fixture ${index}`}, ${index < 3 ? 'commodity' : 'realm'},
        ${index < 3 ? 'Trade Goods' : 'Armor'}, ${index < 3 ? 'Herb' : 'Cloth'},
        ${index < 3 ? null : 'Head'}, ${index === 4 ? 3 : 4}, ${index < 3 ? index + 1 : null}, ${index < 3})`;
  }
  for (const [index, price, quantity] of [[0, 30000, 10], [1, 10000, 50], [2, 20000, 100]]) {
    await sql`INSERT INTO commodity_latest
      (region_id, item_id, sync_run_id, observed_at, min_price, avg_price, median_price, max_price, total_quantity, num_auctions, price_p10, price_p25)
      VALUES ('eu', ${firstId + index!}, 1, now(), ${price!}, ${price!}, ${price!}, ${price!}, ${quantity!}, 1, ${price!}, ${price!})`;
  }
  const [variant] = await sql`INSERT INTO realm_variants (variant_key, bonus_lists, modifiers)
    VALUES ('filter-fixture', '[]', '[]') RETURNING id`;
  variantId = Number(variant!.id);
  for (const [index, realm, price, quantity] of [[3, 1, 200000, 4], [3, 2, 10000, 100], [4, 2, 5000, 20]]) {
    await sql`INSERT INTO realm_latest
      (region_id, connected_realm_id, item_id, variant_id, sync_run_id, observed_at, min_buyout, avg_buyout, median_buyout, max_buyout, total_quantity, num_auctions)
      VALUES ('eu', ${realm!}, ${firstId + index!}, ${variantId}, 1, now(), ${price!}, ${price!}, ${price!}, ${price!}, ${quantity!}, 1)`;
  }
  await sql`INSERT INTO item_professions (item_id, profession_id) VALUES (${firstId}, 2906)`;
  await sql`UPDATE items SET name = 'Filter fixture 100%_literal' WHERE id = ${firstId + 5}`;
});
afterAll(async () => {
  await sql`DELETE FROM item_professions WHERE item_id = ${firstId}`;
  await sql`DELETE FROM realm_latest WHERE item_id BETWEEN ${firstId} AND ${firstId + 5}`;
  await sql`DELETE FROM realm_variants WHERE id = ${variantId}`;
  await sql`DELETE FROM commodity_latest WHERE item_id BETWEEN ${firstId} AND ${firstId + 5}`;
  await sql`DELETE FROM items WHERE id BETWEEN ${firstId} AND ${firstId + 5}`;
  await sql.end();
});

test("stock and numeric filters use the selected realm, never its EU benchmark", async () => {
  const missing = await browse('type=realm&connectedRealmId=1&availability=unlisted&sort=price-asc');
  expect(missing.items.map(item => item.id)).toEqual([firstId + 5, firstId + 4]);
  expect(missing.items.every(item => item.latestPrice === null)).toBe(true);
  expect((await browse('type=realm&connectedRealmId=1&maxPrice=10000')).total).toBe(0);
  const other = await browse('type=realm&connectedRealmId=2&maxPrice=10000&sort=price-asc');
  expect(other.items.map(item => item.id)).toEqual([firstId + 4, firstId + 3]);
  expect((await browse('type=commodity&connectedRealmId=3&availability=listed')).total).toBe(3);
  const sorted = await browse('type=realm&connectedRealmId=1&sort=quantity-desc');
  expect(sorted.items[0]?.id).toBe(firstId + 3);
  expect(sorted.items.slice(1).every(item => item.latestPrice === null)).toBe(true);
});

test("category, slot, rarity, crafting rank and catalog profession combine independently", async () => {
  expect((await browse('category=Armor&subcategory=Cloth&slot=Head&rarity=4&rank=none')).items.map(item => item.id)).toEqual([firstId + 5, firstId + 3]);
  expect((await browse('rank=2')).items.map(item => item.id)).toEqual([firstId + 1]);
  expect((await browse('profession=2906&usage=reagent')).items.map(item => item.id)).toEqual([firstId]);
  const response = await app.request('/api/items/filters');
  expect(response.status).toBe(200);
  const options = await response.json() as { categories: Array<{ name: string; subcategories: string[] }>; slots: string[]; professions: Array<{ id: number }> };
  expect(options.categories.find(category => category.name === 'Armor')?.subcategories).toContain('Cloth');
  expect(options.slots).toContain('Head');
  expect(options.professions.some(profession => profession.id === 2906)).toBe(true);
});

test("search supports exact names and IDs while treating wildcard characters literally", async () => {
  for (const [query, id] of [[`search=${firstId + 2}`, firstId + 2], ['search=filter%20fixture%200&searchMode=exact', firstId], ['search=%25_', firstId + 5]] as const) {
    const response = await app.request(`/api/items?${query}`);
    expect(response.status).toBe(200);
    const data = await response.json() as { items: Array<{ id: number }> };
    expect(data.items.map(item => item.id)).toEqual([id]);
  }
  expect((await browse('searchMode=exact')).total).toBe(0);
});

test("invalid ranges, enums and unsafe numeric inputs fail with actionable client errors", async () => {
  for (const query of ['minPrice=-1', 'maxPrice=1.1', 'minPrice=200&maxPrice=100', 'minQuantity=3&maxQuantity=2', 'maxQuantity=Infinity', 'minPrice=9007199254740992', 'rarity=9', 'rank=0', 'rank=6', 'profession=0', 'sort=constructor', 'sort=oops', 'availability=maybe', 'usage=nope', 'searchMode=regex']) {
    const response = await app.request(`/api/items?${query}`);
    expect(response.status, query).toBe(400);
    expect((await response.json() as { error: string }).error).toBeString();
  }
});

async function browse(query: string) {
  const response = await app.request(`/api/items?search=Filter%20fixture&${query}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ total: number; page: number; totalPages: number; items: Array<{ id: number; latestPrice: { minPrice: number; totalQuantity: number } | null }> }>;
}

test("combines metadata, stock and price filters before counting, sorting and pagination", async () => {
  const result = await browse('category=Trade%20Goods&subcategory=Herb&rarity=4&usage=reagent&availability=listed&minPrice=10000&maxPrice=25000&minQuantity=20&sort=price-desc&limit=1');
  expect(result.total).toBe(2);
  expect(result.totalPages).toBe(2);
  expect(result.items.map(item => item.id)).toEqual([firstId + 2]);
  expect(result.items[0]?.latestPrice).toMatchObject({ minPrice: 20000, totalQuantity: 100 });
  const next = await browse('category=Trade%20Goods&subcategory=Herb&rarity=4&usage=reagent&availability=listed&minPrice=10000&maxPrice=25000&minQuantity=20&sort=price-desc&limit=1&page=2');
  expect(next.items.map(item => item.id)).toEqual([firstId + 1]);
});

test("a concurrent refresh cannot change prices between filtering and displaying the same response", async () => {
  let updating = true;
  const refresh = (async () => {
    let low = false;
    while (updating) {
      await sql`UPDATE commodity_latest SET min_price = ${low ? 10000 : 90000}
        WHERE item_id BETWEEN ${firstId} AND ${firstId + 2}`;
      low = !low;
      await Bun.sleep(2);
    }
  })();
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await browse('type=commodity&minPrice=10000&maxPrice=15000');
      expect(result.items).toHaveLength(result.total);
      for (const item of result.items) expect(item.latestPrice?.minPrice).toBe(10000);
    }
  } finally {
    updating = false;
    await refresh;
    for (const [index, price] of [[0, 30000], [1, 10000], [2, 20000]]) {
      await sql`UPDATE commodity_latest SET min_price = ${price!} WHERE item_id = ${firstId + index!}`;
    }
  }
});
