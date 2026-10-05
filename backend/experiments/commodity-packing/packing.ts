// Opt-in local experiment. Nothing in src/ imports this module.
import type { Sql } from "postgres";

export const columns = "id,region_id,item_id,snapshot_time,min_price,avg_price,median_price,max_price,total_quantity,num_auctions,price_p10,price_p25,total_value";

export async function createCandidate(sql: Sql) {
  await sql.unsafe(`
    CREATE SCHEMA packing_candidate;
    CREATE TABLE packing_candidate.commodity_raw
      (LIKE packing_baseline.commodity_snapshots INCLUDING ALL);
    INSERT INTO packing_candidate.commodity_raw SELECT * FROM packing_baseline.commodity_snapshots;
    -- LIKE INCLUDING ALL does not copy foreign keys; retain real ingestion checks.
    ALTER TABLE packing_candidate.commodity_raw ADD FOREIGN KEY(region_id) REFERENCES public.regions(id);
    ALTER TABLE packing_candidate.commodity_raw ADD FOREIGN KEY(item_id) REFERENCES public.items(id);
    CREATE TABLE packing_candidate.commodity_daily (LIKE public.commodity_daily INCLUDING ALL);
    CREATE TABLE packing_candidate.sync_jobs (LIKE public.sync_jobs INCLUDING ALL);
    CREATE TABLE packing_candidate.commodity_history_blocks (
      region_id text NOT NULL REFERENCES public.regions(id),
      item_id integer NOT NULL REFERENCES public.items(id),
      day date NOT NULL,
      observations jsonb NOT NULL,
      PRIMARY KEY(region_id,item_id,day)
    );
    -- The primary key already serves region/item/day reads; day serves maintenance.
    CREATE INDEX ON packing_candidate.commodity_history_blocks(day);
    CREATE VIEW packing_candidate.commodity_history AS
      SELECT *, (snapshot_time AT TIME ZONE 'UTC')::date AS history_day
      FROM packing_candidate.commodity_raw
      UNION ALL
      SELECT o.id,b.region_id,b.item_id,o.snapshot_time,o.min_price,o.avg_price,o.median_price,
        o.max_price,o.total_quantity,o.num_auctions,o.price_p10,o.price_p25,o.total_value,b.day
      FROM packing_candidate.commodity_history_blocks b
      CROSS JOIN LATERAL jsonb_to_recordset(b.observations) AS o(
        id bigint,snapshot_time timestamptz,min_price bigint,avg_price bigint,median_price bigint,
        max_price bigint,total_quantity bigint,num_auctions integer,price_p10 bigint,price_p25 bigint,
        total_value numeric(40,0));
    -- Benchmark adapter ONLY: exercise today's unmodified application readers.
    -- A real migration would retain commodity_snapshots and switch readers to commodity_history.
    CREATE VIEW packing_candidate.commodity_snapshots AS
      SELECT ${columns} FROM packing_candidate.commodity_history;
  `);
}

// Mirrors realm-history-storage: one transaction/day, matching writer lock,
// merge late observations, bidirectional EXCEPT ALL before deleting raw rows.
export async function packDay(sql: Sql, day: string): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('commodity-packing-experiment',0))`;
    await tx`SET LOCAL lock_timeout='2s'`;
    await tx`LOCK TABLE packing_candidate.commodity_raw IN SHARE ROW EXCLUSIVE MODE`;
    const [raw] = await tx`SELECT count(*)::int AS n FROM packing_candidate.commodity_raw
      WHERE snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
        AND snapshot_time < (${day}::date+1) AT TIME ZONE 'UTC'`;
    if (!raw!.n) return 0;
    await tx`CREATE TEMP TABLE packing_source ON COMMIT DROP AS
      SELECT * FROM packing_candidate.commodity_history WHERE history_day=${day}::date
        AND snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
        AND snapshot_time < (${day}::date+1) AT TIME ZONE 'UTC'`;
    await tx`INSERT INTO packing_candidate.commodity_history_blocks
      SELECT region_id,item_id,history_day,
        jsonb_agg(to_jsonb(s)-'region_id'-'item_id'-'history_day' ORDER BY snapshot_time,id)
      FROM packing_source s GROUP BY region_id,item_id,history_day
      ON CONFLICT(region_id,item_id,day) DO UPDATE SET observations=excluded.observations`;
    const [difference] = await tx.unsafe(`WITH expanded AS (
      SELECT o.id,b.region_id,b.item_id,o.snapshot_time,o.min_price,o.avg_price,o.median_price,
        o.max_price,o.total_quantity,o.num_auctions,o.price_p10,o.price_p25,o.total_value,b.day AS history_day
      FROM packing_candidate.commodity_history_blocks b
      CROSS JOIN LATERAL jsonb_to_recordset(b.observations) AS o(
        id bigint,snapshot_time timestamptz,min_price bigint,avg_price bigint,median_price bigint,
        max_price bigint,total_quantity bigint,num_auctions integer,price_p10 bigint,price_p25 bigint,
        total_value numeric(40,0)) WHERE b.day=$1::date
    ), differences AS (
      (SELECT * FROM packing_source EXCEPT ALL SELECT * FROM expanded)
      UNION ALL (SELECT * FROM expanded EXCEPT ALL SELECT * FROM packing_source)
    ) SELECT count(*)::int AS n FROM differences`, [day]);
    if (difference!.n !== 0) throw new Error("Commodity reconstruction failed; day rolled back");
    const deleted = await tx`DELETE FROM packing_candidate.commodity_raw
      WHERE snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
        AND snapshot_time < (${day}::date+1) AT TIME ZONE 'UTC'`;
    if (deleted.count !== raw!.n) throw new Error("Raw count changed; day rolled back");
    return deleted.count;
  });
}

export async function pack(sql: Sql, cutoffDay: string) {
  const days = await sql`SELECT DISTINCT (snapshot_time AT TIME ZONE 'UTC')::date::text AS day
    FROM packing_candidate.commodity_raw
    WHERE snapshot_time < ${cutoffDay}::date AT TIME ZONE 'UTC' ORDER BY day`;
  let rows = 0;
  const timings = [];
  for (const { day } of days) {
    const started = performance.now();
    const count = await packDay(sql, day);
    timings.push({ day, rows: count, milliseconds: performance.now() - started });
    rows += count;
  }
  return { rows, timings };
}

export async function assertExact(sql: Sql) {
  const [difference] = await sql.unsafe(`WITH differences AS (
    (SELECT ${columns} FROM packing_baseline.commodity_snapshots
      EXCEPT ALL SELECT ${columns} FROM packing_candidate.commodity_history)
    UNION ALL
    (SELECT ${columns} FROM packing_candidate.commodity_history
      EXCEPT ALL SELECT ${columns} FROM packing_baseline.commodity_snapshots)
  ) SELECT count(*)::int AS n FROM differences`);
  if (difference!.n !== 0) throw new Error(`Exact reconstruction differs in ${difference!.n} records`);
}

// Same quantity-weighted daily calculation used by price-maintenance.ts.
export function rollupQuery(relation: string) {
  return `SELECT region_id,item_id,(snapshot_time AT TIME ZONE 'UTC')::date AS date,
    min(min_price) AS min_price,
    round(sum(coalesce(total_value,coalesce(avg_price,min_price)::numeric*total_quantity))
      /nullif(sum(total_quantity),0))::bigint AS avg_price,
    max(max_price) AS max_price,round(avg(total_quantity))::bigint AS avg_quantity,
    sum(coalesce(total_value,coalesce(avg_price,min_price)::numeric*total_quantity)) AS total_value,
    sum(total_quantity) AS observed_quantity,count(*)::int AS sample_count,
    bool_and(total_value IS NOT NULL) AS average_is_exact
    FROM ${relation} GROUP BY region_id,item_id,(snapshot_time AT TIME ZONE 'UTC')::date`;
}
