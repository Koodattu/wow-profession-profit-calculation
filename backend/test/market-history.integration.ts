import "./support/local-env";
import { afterAll, beforeAll, expect, test } from "bun:test";
import app from "../src/app";
import { sql } from "../src/db";

const historicalItem = 990031;
const currentOnlyItem = 990032;

beforeAll(async () => {
  await sql`INSERT INTO items (id, name, market_type) VALUES
    (${historicalItem}, 'Synthetic history provenance', 'commodity'),
    (${currentOnlyItem}, 'Synthetic current quote only', 'commodity')`;
  await sql`INSERT INTO commodity_snapshots
    (region_id, item_id, snapshot_time, min_price, avg_price, median_price, max_price, total_quantity)
    VALUES ('eu', ${historicalItem}, date_trunc('hour', now()) - interval '2 hours', 10000, 20000, 15000, 40000, 6)`;
  await sql`INSERT INTO commodity_daily
    (region_id, item_id, date, min_price, avg_price, max_price, avg_quantity, sample_count, observed_quantity, total_value, average_is_exact)
    VALUES ('eu', ${historicalItem}, CURRENT_DATE - 2, 10000, 20000, 40000, 6, 3, 18, 360000, false)`;
  await sql`INSERT INTO commodity_latest
    (region_id, item_id, sync_run_id, observed_at, min_price, avg_price, median_price, max_price, total_quantity, num_auctions, price_p10, price_p25)
    VALUES ('eu', ${currentOnlyItem}, 1, now(), 50000, 60000, 55000, 90000, 7, 2, 50000, 55000)`;
  await sql`INSERT INTO realm_daily
    (connected_realm_id, region_id, item_id, date, min_buyout, avg_buyout, max_buyout, avg_quantity, sample_count, observed_quantity, total_value, average_is_exact)
    VALUES
      (1, 'eu', ${historicalItem}, CURRENT_DATE - 2, 10000, 20000, 40000, 2, 3, 6, 120000, true),
      (2, 'eu', ${historicalItem}, CURRENT_DATE - 2, 20000, 30000, 60000, 12, 2, 24, 720000, false)`;
});

afterAll(async () => {
  await sql`DELETE FROM commodity_latest WHERE item_id IN (${historicalItem}, ${currentOnlyItem})`;
  await sql`DELETE FROM commodity_daily WHERE item_id = ${historicalItem}`;
  await sql`DELETE FROM realm_daily WHERE item_id = ${historicalItem}`;
  await sql`DELETE FROM commodity_snapshots WHERE item_id = ${historicalItem}`;
  await sql`DELETE FROM items WHERE id IN (${historicalItem}, ${currentOnlyItem})`;
  await sql.end();
});

test("daily realm history preserves scope, weighted values, sample coverage and approximate precision", async () => {
  const response = await app.request(`/api/items/${historicalItem}/prices?type=realm&range=6m&connectedRealmId=1`);
  const [selected] = await response.json() as Array<Record<string, unknown>>;
  expect(selected).toMatchObject({ resolution: "daily", min_price: 10000, avg_price: 20000,
    total_quantity: 2, sample_count: 3, average_is_exact: true });
  const pooledResponse = await app.request(`/api/items/${historicalItem}/prices?type=realm&range=6m`);
  const [pooled] = await pooledResponse.json() as Array<Record<string, unknown>>;
  expect(pooled).toMatchObject({ avg_price: 28000, sample_count: 5, average_is_exact: false });
  const missingResponse = await app.request(`/api/items/${historicalItem}/prices?type=realm&range=6m&connectedRealmId=3`);
  expect(await missingResponse.json()).toEqual([]);
});

async function history(itemId: number, range: string) {
  const response = await app.request(`/api/items/${itemId}/prices?type=commodity&range=${range}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Array<Record<string, unknown>>>;
}

test("history identifies a current quote fallback instead of presenting it as a daily summary", async () => {
  const [current] = await history(currentOnlyItem, "6m");
  expect(current).toMatchObject({ resolution: "current", min_price: 50000, total_quantity: 7 });
  expect(current?.sample_count).toBeNull();

  const [hourly] = await history(historicalItem, "24h");
  expect(hourly).toMatchObject({ resolution: "hourly", min_price: 10000, avg_price: 20000, total_quantity: 6 });

  const [daily] = await history(historicalItem, "6m");
  expect(daily).toMatchObject({ resolution: "daily", min_price: 10000, avg_price: 20000,
    median_price: null, total_quantity: 6, sample_count: 3, average_is_exact: false });
});
