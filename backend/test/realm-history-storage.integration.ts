import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { sql } from "../src/db";
import { packRealmHistory } from "../src/services/realm-history-storage";
import { aggregateDailyPrices } from "../src/services/price-maintenance";
import { archiveExpiredPriceHistory, verifyHistoryArchive } from "../src/services/price-history-archive";
import { getMarketHistories } from "../src/services/market-history";

const region = "packed-test";
const item = 2_100_003_001;
const day = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
const cutoff = new Date(`${day}T00:00:00Z`);
cutoff.setUTCDate(cutoff.getUTCDate() + 1);

afterAll(async () => {
  await sql`DELETE FROM realm_snapshots WHERE region_id=${region}`;
  await sql`DELETE FROM realm_history_blocks WHERE region_id=${region}`;
  await sql`DELETE FROM realm_daily WHERE region_id=${region}`;
  await sql`DELETE FROM items WHERE id=${item}`;
  await sql`DELETE FROM regions WHERE id=${region}`;
  await sql.end();
});

test("packed observations preserve exact values, chart behavior, late data, rollups and recoverable archives", async () => {
  await sql`INSERT INTO regions(id,name,api_host) VALUES (${region},'Packing fixture','test.invalid')`;
  await sql`INSERT INTO items(id,name) VALUES (${item},'Packing fixture')`;
  await sql`
    INSERT INTO realm_snapshots(region_id,connected_realm_id,item_id,snapshot_time,min_buyout,avg_buyout,median_buyout,max_buyout,total_quantity,num_auctions,total_value)
    VALUES (${region},1,${item},${day + 'T01:01:02.123456Z'},33,33,33,33,3,1,100),
           (${region},1,${item},${day + 'T02:03:04.123456Z'},33,33,33,33,3,1,100),
           (${region},1,${item},${day + 'T04:00:00Z'},33,33,NULL,33,9,2,300),
           (${region},2,${item},${day + 'T01:01:02Z'},100000000000,100000000000,NULL,100000000000,1000000,4,100000000000000001),
           (${region},2,${item},${day + 'T04:00:00Z'},99,99,NULL,NULL,2,NULL,NULL)
  `;
  const records = () => sql`SELECT (to_jsonb(h)-'history_day')::text AS row FROM realm_history h WHERE region_id=${region} ORDER BY id`;
  const before = [...await records()];
  const histories = async () => Promise.all([undefined, 1, 2].map(connectedRealmId =>
    getMarketHistories({ regionId: region, itemIds: [item], range: '30d', type: 'realm', connectedRealmId })));
  const charts = await histories();
  const [previousJob] = await sql`SELECT * FROM sync_jobs WHERE name='quantity-weighted-rollups'`;
  try {
    await sql`DELETE FROM sync_jobs WHERE name='quantity-weighted-rollups'`;
    await aggregateDailyPrices();
    const dailyBefore = [...await sql`SELECT * FROM realm_daily WHERE region_id=${region} ORDER BY connected_realm_id`];
    await sql`CREATE FUNCTION test_corrupt_realm_pack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.observations = '[]'::jsonb; RETURN NEW; END $$`;
    await sql`CREATE TRIGGER corrupt_pack BEFORE INSERT ON realm_history_blocks FOR EACH ROW EXECUTE FUNCTION test_corrupt_realm_pack()`;
    try {
      await expect(packRealmHistory(cutoff)).rejects.toThrow('reconstruction failed');
      expect([...await records()]).toEqual(before);
      expect((await sql`SELECT count(*)::int AS n FROM realm_snapshots WHERE region_id=${region}`)[0]?.n).toBe(5);
    } finally { await sql`DROP TRIGGER corrupt_pack ON realm_history_blocks`; await sql`DROP FUNCTION test_corrupt_realm_pack()`; }
    await packRealmHistory(cutoff);
    expect([...await records()]).toEqual(before);
    expect(await histories()).toEqual(charts);
    expect((await sql`SELECT count(*)::int AS n FROM realm_snapshots WHERE region_id=${region}`)[0]?.n).toBe(0);
    expect((await sql`SELECT count(*)::int AS n FROM realm_history_blocks WHERE region_id=${region}`)[0]?.n).toBe(2);
    await sql`DELETE FROM sync_jobs WHERE name='quantity-weighted-rollups'`;
    await aggregateDailyPrices();
    expect([...await sql`SELECT * FROM realm_daily WHERE region_id=${region} ORDER BY connected_realm_id`]).toEqual(dailyBefore);
    await packRealmHistory(cutoff);
    expect([...await records()]).toEqual(before);

    // A late observation must augment the existing block, including its weight.
    await sql`
      INSERT INTO realm_snapshots(region_id,connected_realm_id,item_id,snapshot_time,min_buyout,avg_buyout,max_buyout,total_quantity,total_value)
      VALUES (${region},1,${item},${day + 'T10:00:00Z'},50,50,50,5,250)
    `;
    const withLate = [...await records()];
    await Promise.all([packRealmHistory(cutoff), packRealmHistory(cutoff)]);
    expect([...await records()]).toEqual(withLate);
    const directory = await mkdtemp(join(tmpdir(), 'packed-history-'));
    try {
      await expect(archiveExpiredPriceHistory({ directory, cutoff })).rejects.toThrow('coverage is incomplete');
      expect([...await records()]).toEqual(withLate);
      await sql`DELETE FROM sync_jobs WHERE name='quantity-weighted-rollups'`;
      await aggregateDailyPrices();
      const [daily] = await sql`SELECT avg_buyout::text,total_value::text,observed_quantity::text,sample_count FROM realm_daily WHERE region_id=${region} AND connected_realm_id=1`;
      expect(daily).toEqual({ avg_buyout: '38', total_value: '750', observed_quantity: '20', sample_count: 4 });
      await archiveExpiredPriceHistory({ directory, cutoff });
      const file = (await readdir(directory)).find(f => f.startsWith('realm_snapshots-') && f.endsWith('.gz'))!;
      expect((await verifyHistoryArchive(join(directory,file))).rows).toBe(6);
      const lines = gunzipSync(await readFile(join(directory,file))).toString('utf8').trim().split('\n');
      const recovered = [];
      for (const line of lines) {
        const [record] = await sql`SELECT to_jsonb(json_populate_record(NULL::realm_snapshots,${line}::json))::text AS row`;
        recovered.push(record);
      }
      expect(recovered).toEqual(withLate);
      expect([...await records()]).toHaveLength(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally {
    await sql`DELETE FROM sync_jobs WHERE name='quantity-weighted-rollups'`;
    if (previousJob) await sql`INSERT INTO sync_jobs ${sql(previousJob)}`;
  }
}, 60_000);
