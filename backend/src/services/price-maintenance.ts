import { sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";

export async function aggregateDailyPrices(): Promise<void> {
  await db.execute(sql`
    INSERT INTO commodity_daily (
      region_id, item_id, date, min_price, avg_price, max_price, avg_quantity
    )
    SELECT
      region_id,
      item_id,
      (snapshot_time AT TIME ZONE 'UTC')::date,
      min(min_price),
      round(avg(coalesce(avg_price, min_price)))::bigint,
      max(max_price),
      round(avg(total_quantity))::bigint
    FROM commodity_snapshots
    GROUP BY region_id, item_id, (snapshot_time AT TIME ZONE 'UTC')::date
    ON CONFLICT (region_id, item_id, date) DO UPDATE SET
      min_price = excluded.min_price,
      avg_price = excluded.avg_price,
      max_price = excluded.max_price,
      avg_quantity = excluded.avg_quantity
  `);

  await db.execute(sql`
    INSERT INTO realm_daily (
      connected_realm_id, region_id, item_id, date,
      min_buyout, avg_buyout, max_buyout, avg_quantity
    )
    SELECT
      connected_realm_id,
      region_id,
      item_id,
      (snapshot_time AT TIME ZONE 'UTC')::date,
      min(min_buyout),
      round(avg(coalesce(avg_buyout, min_buyout)))::bigint,
      max(max_buyout),
      round(avg(total_quantity))::bigint
    FROM realm_snapshots
    GROUP BY connected_realm_id, region_id, item_id, (snapshot_time AT TIME ZONE 'UTC')::date
    ON CONFLICT (connected_realm_id, region_id, item_id, date) DO UPDATE SET
      min_buyout = excluded.min_buyout,
      avg_buyout = excluded.avg_buyout,
      max_buyout = excluded.max_buyout,
      avg_quantity = excluded.avg_quantity
  `);
}

export async function pruneRawPrices(): Promise<void> {
  await db.execute(sql`
    DELETE FROM commodity_snapshots
    WHERE snapshot_time < now() - (${env.RAW_SNAPSHOT_RETENTION_DAYS} * interval '1 day')
  `);
  await db.execute(sql`
    DELETE FROM realm_snapshots
    WHERE snapshot_time < now() - (${env.RAW_SNAPSHOT_RETENTION_DAYS} * interval '1 day')
  `);
}

export async function runPriceMaintenance(): Promise<void> {
  console.log("[Maintenance] Aggregating daily price history");
  await aggregateDailyPrices();
  console.log(`[Maintenance] Pruning raw snapshots older than ${env.RAW_SNAPSHOT_RETENTION_DAYS} days`);
  await pruneRawPrices();
  console.log("[Maintenance] Price history maintenance complete");
}
