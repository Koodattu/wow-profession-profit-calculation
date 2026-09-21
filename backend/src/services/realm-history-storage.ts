import { sql } from "../db";

// Keep today and yesterday mutable; completed older days are losslessly packed.
// One day per transaction bounds locks, memory and recovery work.
export async function packRealmHistory(cutoff = new Date(Date.now() - 2 * 86_400_000)): Promise<number> {
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const days = await sql<{ day: string }[]>`
    SELECT DISTINCT (snapshot_time AT TIME ZONE 'UTC')::date::text AS day
    FROM realm_snapshots WHERE snapshot_time < ${cutoffDay}::date AT TIME ZONE 'UTC' ORDER BY day
  `;
  let packed = 0;
  for (const { day } of days) {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('realm-history-storage', 0))`;
      await tx`SET LOCAL lock_timeout = '5s'`;
      await tx`LOCK TABLE realm_snapshots IN SHARE ROW EXCLUSIVE MODE`;
      await tx`
        CREATE TEMP TABLE packing_source ON COMMIT DROP AS
        SELECT * FROM realm_history WHERE history_day = ${day}::date
          AND snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
          AND snapshot_time < (${day}::date+1) AT TIME ZONE 'UTC'
      `;
      await tx`
        INSERT INTO realm_history_blocks (region_id,connected_realm_id,item_id,day,observations)
        SELECT region_id,connected_realm_id,item_id,history_day,
          jsonb_agg(to_jsonb(s)-'region_id'-'connected_realm_id'-'item_id'-'history_day' ORDER BY snapshot_time,id)
        FROM packing_source s GROUP BY region_id,connected_realm_id,item_id,history_day
        ON CONFLICT (region_id,connected_realm_id,item_id,day) DO UPDATE SET observations=excluded.observations
      `;
      const [difference] = await tx`
        WITH expanded AS (
          SELECT o.id,b.connected_realm_id,b.region_id,b.item_id,o.snapshot_time,o.min_buyout,o.avg_buyout,
            o.median_buyout,o.max_buyout,o.total_quantity,o.num_auctions,o.total_value,b.day AS history_day
          FROM realm_history_blocks b CROSS JOIN LATERAL jsonb_to_recordset(b.observations) AS o(
            id bigint,snapshot_time timestamptz,min_buyout bigint,avg_buyout bigint,median_buyout bigint,
            max_buyout bigint,total_quantity bigint,num_auctions integer,total_value numeric(40,0))
          WHERE b.day=${day}::date
        ), differences AS (
          (SELECT * FROM packing_source EXCEPT ALL SELECT * FROM expanded)
          UNION ALL (SELECT * FROM expanded EXCEPT ALL SELECT * FROM packing_source)
        ) SELECT EXISTS(SELECT 1 FROM differences) AS differs
      `;
      if (difference?.differs !== false) throw new Error(`Realm history reconstruction failed for ${day}`);
      const deleted = await tx`
        DELETE FROM realm_snapshots WHERE snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
          AND snapshot_time < (${day}::date+1) AT TIME ZONE 'UTC'
      `;
      packed += deleted.count;
    });
  }
  return packed;
}
