import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { archiveExpiredPriceHistory, verifyHistoryArchive } from "../src/services/price-history-archive";
import { getCurrentItemMarkets } from "../src/services/current-market";
import { getMarketHistories } from "../src/services/market-history";
import { sql } from "../src/db";
import { aggregateDailyPrices } from "../src/services/price-maintenance";

const REGION = "test-maintenance";
const ITEM_ID = 1_900_004_001;
let previousJob: { last_success_at: Date | null } | undefined;

beforeAll(async () => {
  [previousJob] = await sql<{ last_success_at: Date | null }[]>`
    SELECT last_success_at FROM sync_jobs WHERE name = 'quantity-weighted-rollups'
  `;
  await sql`INSERT INTO regions (id, name, api_host) VALUES (${REGION}, 'Maintenance test', 'test.invalid')`;
  await sql`INSERT INTO items (id, name) VALUES (${ITEM_ID}, 'Maintenance test item')`;
  await sql`
    INSERT INTO sync_jobs (name, last_success_at)
    VALUES ('quantity-weighted-rollups', '2090-01-02T03:15:00Z')
    ON CONFLICT (name) DO UPDATE SET last_success_at = excluded.last_success_at
  `;
  for (const [time, price, quantity] of [
    ["2090-01-01T01:05:00Z", 100, 1],
    ["2090-01-01T10:05:00Z", 300, 9],
    ["2090-01-02T01:05:00Z", 500, 10],
  ] as const) {
    await sql`
      INSERT INTO commodity_snapshots (region_id, item_id, snapshot_time, min_price, avg_price, max_price, total_quantity)
      VALUES (${REGION}, ${ITEM_ID}, ${time}, ${price}, ${price}, ${price}, ${quantity})
    `;
    await sql`
      INSERT INTO realm_snapshots (region_id, connected_realm_id, item_id, snapshot_time, min_buyout, avg_buyout, max_buyout, total_quantity)
      VALUES (${REGION}, 1, ${ITEM_ID}, ${time}, ${price}, ${price}, ${price}, ${quantity})
    `;
  }
  await sql`
    INSERT INTO commodity_daily (region_id, item_id, date, min_price, avg_price, max_price, avg_quantity)
    VALUES (${REGION}, ${ITEM_ID}, '2090-01-01', 100, 280, 300, 5)
  `;
  await sql`
    INSERT INTO realm_daily (region_id, connected_realm_id, item_id, date, min_buyout, avg_buyout, max_buyout, avg_quantity)
    VALUES (${REGION}, 1, ${ITEM_ID}, '2090-01-01', 100, 280, 300, 5)
  `;
});

afterAll(async () => {
  await sql`DELETE FROM commodity_daily WHERE region_id = ${REGION}`;
  await sql`DELETE FROM realm_daily WHERE region_id = ${REGION}`;
  await sql`DELETE FROM commodity_snapshots WHERE region_id = ${REGION}`;
  await sql`DELETE FROM realm_snapshots WHERE region_id = ${REGION}`;
  await sql`DELETE FROM realm_latest WHERE region_id = ${REGION}`;
  await sql`DELETE FROM items WHERE id = ${ITEM_ID}`;
  await sql`DELETE FROM regions WHERE id = ${REGION}`;
  if (previousJob) {
    await sql`UPDATE sync_jobs SET last_success_at = ${previousJob.last_success_at} WHERE name = 'quantity-weighted-rollups'`;
  } else {
    await sql`DELETE FROM sync_jobs WHERE name = 'quantity-weighted-rollups'`;
  }
  await sql.end();
});

test("incremental rollups weight quantities and preserve the complete previous UTC day", async () => {
  await aggregateDailyPrices();
  const commodity = await sql`
    SELECT date::text, min_price::int, avg_price::int, max_price::int
    FROM commodity_daily WHERE region_id = ${REGION} ORDER BY date
  `;
  const realm = await sql`
    SELECT date::text, min_buyout::int AS min_price, avg_buyout::int AS avg_price, max_buyout::int AS max_price
    FROM realm_daily WHERE region_id = ${REGION} ORDER BY date
  `;
  const expected = [
    { date: "2090-01-01", min_price: 100, avg_price: 280, max_price: 300 },
    { date: "2090-01-02", min_price: 500, avg_price: 500, max_price: 500 },
  ];
  expect(Array.from(commodity)).toEqual(expected);
  expect(Array.from(realm)).toEqual(expected);
});


test("exact totals survive rounding and very large weighted values", async () => {
  await sql`UPDATE sync_jobs SET last_success_at = '2090-01-03T03:15:00Z' WHERE name = 'quantity-weighted-rollups'`;
  await sql`
    INSERT INTO commodity_snapshots (region_id, item_id, snapshot_time, min_price, avg_price, max_price, total_quantity, total_value)
    VALUES (${REGION}, ${ITEM_ID}, '2090-01-03T01:00:00Z', 100000000000, 100000000000, 100000000000, 1000000, '100000000000000001'),
           (${REGION}, ${ITEM_ID}, '2090-01-03T02:00:00Z', 200000000000, 200000000000, 200000000000, 3000000, '600000000000000002')
  `;
  await aggregateDailyPrices();
  const [daily] = await sql`
    SELECT avg_price::text, total_value::text, observed_quantity::text, sample_count, average_is_exact
    FROM commodity_daily WHERE region_id = ${REGION} AND date = '2090-01-03'
  `;
  expect(daily).toEqual({ avg_price: "175000000000", total_value: "700000000000000003", observed_quantity: "4000000", sample_count: 2, average_is_exact: true });
  const [legacy] = await sql`SELECT average_is_exact FROM commodity_daily WHERE region_id = ${REGION} AND date = '2090-01-01'`;
  expect(legacy?.average_is_exact).toBe(false);
});

test("compaction requires matching daily totals and verified recoverable archives", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wow-history-archive-"));
  const cutoff = new Date("2000-01-02T12:00:00Z");
  try {
    await sql`
      INSERT INTO commodity_snapshots (region_id, item_id, snapshot_time, min_price, avg_price, max_price, total_quantity, total_value)
      VALUES (${REGION}, ${ITEM_ID}, '2000-01-01T01:00:00Z', 33, 33, 33, 3, 100)
    `;
    await sql`
      INSERT INTO realm_snapshots (region_id, connected_realm_id, item_id, snapshot_time, min_buyout, avg_buyout, max_buyout, total_quantity, total_value)
      VALUES (${REGION}, 1, ${ITEM_ID}, '2000-01-01T01:00:00Z', 33, 33, 33, 3, 100)
    `;
    await expect(archiveExpiredPriceHistory({ directory, cutoff })).rejects.toThrow("coverage is incomplete");
    const [retained] = await sql`SELECT count(*)::int AS count FROM commodity_snapshots WHERE region_id = ${REGION} AND snapshot_time < '2000-01-02'`;
    expect(retained?.count).toBe(1);
    await sql`
      INSERT INTO commodity_daily (region_id, item_id, date, min_price, avg_price, max_price, avg_quantity, total_value, observed_quantity, sample_count, average_is_exact)
      VALUES (${REGION}, ${ITEM_ID}, '2000-01-01', 33, 33, 33, 3, 100, 3, 1, true)
    `;
    await sql`
      INSERT INTO realm_daily (region_id, connected_realm_id, item_id, date, min_buyout, avg_buyout, max_buyout, avg_quantity, total_value, observed_quantity, sample_count, average_is_exact)
      VALUES (${REGION}, 1, ${ITEM_ID}, '2000-01-01', 33, 33, 33, 3, 100, 3, 1, true)
    `;
    const blockedPath = join(directory, "not-a-directory");
    await writeFile(blockedPath, "blocked");
    await expect(archiveExpiredPriceHistory({ directory: blockedPath, cutoff })).rejects.toThrow();
    await archiveExpiredPriceHistory({ directory, cutoff });
    await archiveExpiredPriceHistory({ directory, cutoff });
    const files = (await readdir(directory)).filter(name => name.endsWith(".gz"));
    expect(files).toHaveLength(2);
    for (const file of files) {
      const actual = await verifyHistoryArchive(join(directory, file));
      const manifest = JSON.parse(await readFile(join(directory, file + ".json"), "utf8"));
      expect(actual.rows).toBe(1);
      expect(actual.sha256).toBe(manifest.sha256);
      const record = gunzipSync(await readFile(join(directory, file))).toString("utf8").trim();
      const [restored] = await sql`
        SELECT (json_populate_record(NULL::commodity_snapshots, ${record}::json)).total_value::text AS value
      `;
      expect(restored?.value).toBe("100");
    }
    const [raw] = await sql`SELECT count(*)::int AS count FROM commodity_snapshots WHERE region_id = ${REGION} AND snapshot_time < '2000-01-02'`;
    const [rawRealm] = await sql`SELECT count(*)::int AS count FROM realm_snapshots WHERE region_id = ${REGION} AND snapshot_time < '2000-01-02'`;
    expect(raw?.count).toBe(0);
    expect(rawRealm?.count).toBe(0);
    const [daily] = await sql`SELECT total_value::text FROM commodity_daily WHERE region_id = ${REGION} AND date = '2000-01-01'`;
    expect(daily?.total_value).toBe("100");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("current realm averages use exact totals without inventing a combined median", async () => {
  await sql`
    INSERT INTO realm_latest (region_id, connected_realm_id, item_id, variant_key, sync_run_id, observed_at, min_buyout, avg_buyout, median_buyout, max_buyout, total_quantity, num_auctions, total_value)
    VALUES (${REGION}, 1, ${ITEM_ID}, 'a', 0, now(), 2, 2, 2, 2, 2, 1, 3),
           (${REGION}, 1, ${ITEM_ID}, 'b', 0, now(), 1, 1, 1, 1, 1, 1, 1)
  `;
  const quote = (await getCurrentItemMarkets(REGION, [ITEM_ID], 1)).get(ITEM_ID)?.selectedRealmQuote;
  expect(quote?.avgPrice).toBe(1);
  expect(quote?.totalQuantity).toBe(3);
  expect(quote?.medianPrice).toBeNull();
});

test("region history combines realms by quantity and retains old daily history", async () => {
  await sql`
    INSERT INTO realm_daily (region_id, connected_realm_id, item_id, date, min_buyout, avg_buyout, max_buyout, avg_quantity, total_value, observed_quantity, sample_count, average_is_exact)
    VALUES (${REGION}, 2, ${ITEM_ID}, '2000-01-01', 100, 100, 100, 1, 100, 1, 1, true)
  `;
  const all = (await getMarketHistories({ regionId: REGION, itemIds: [ITEM_ID], range: 'all', type: 'realm' })).get(ITEM_ID)!;
  const old = all.filter(point => String(point.time).startsWith('2000-01-01'));
  expect(old).toHaveLength(1);
  expect(old[0]?.avg_price).toBe(50);
  expect(old[0]?.median_price).toBeNull();
  expect(old[0]?.total_quantity).toBe(4);

  await sql`
    INSERT INTO realm_snapshots (region_id, connected_realm_id, item_id, snapshot_time, min_buyout, avg_buyout, max_buyout, total_quantity, total_value)
    VALUES (${REGION}, 1, ${ITEM_ID}, now(), 100, 100, 100, 1, 100),
           (${REGION}, 2, ${ITEM_ID}, now(), 300, 300, 300, 9, 2700)
  `;
  const recent = (await getMarketHistories({ regionId: REGION, itemIds: [ITEM_ID], range: '24h', type: 'realm' })).get(ITEM_ID)!;
  const point = recent.find(point => Number(point.avg_price) === 280);
  expect(point?.total_quantity).toBe(10);
  expect(point?.median_price).toBeNull();
});
