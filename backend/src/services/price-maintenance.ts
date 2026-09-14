import { sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { archiveExpiredPriceHistory } from "./price-history-archive";

export async function aggregateDailyPrices(): Promise<void> {
  await db.execute(sql`
    INSERT INTO commodity_daily (
      region_id, item_id, date, min_price, avg_price, max_price, avg_quantity, total_value, observed_quantity, sample_count, average_is_exact
    )
    SELECT
      region_id,
      item_id,
      (snapshot_time AT TIME ZONE 'UTC')::date,
      min(min_price),
      round(sum(coalesce(total_value, coalesce(avg_price, min_price)::numeric * total_quantity)) / nullif(sum(total_quantity), 0))::bigint,
      max(max_price),
      round(avg(total_quantity))::bigint,
      sum(coalesce(total_value, coalesce(avg_price, min_price)::numeric * total_quantity)),
      sum(total_quantity), count(*)::int, bool_and(total_value IS NOT NULL)
    FROM commodity_snapshots
    WHERE snapshot_time >= coalesce(
      (SELECT (date_trunc('day', last_success_at AT TIME ZONE 'UTC') - interval '1 day') AT TIME ZONE 'UTC'
       FROM sync_jobs WHERE name = 'quantity-weighted-rollups'),
      '-infinity'::timestamptz
    )
    GROUP BY region_id, item_id, (snapshot_time AT TIME ZONE 'UTC')::date
    ON CONFLICT (region_id, item_id, date) DO UPDATE SET
      min_price = excluded.min_price,
      avg_price = excluded.avg_price,
      max_price = excluded.max_price,
      avg_quantity = excluded.avg_quantity,
      total_value = excluded.total_value,
      observed_quantity = excluded.observed_quantity,
      sample_count = excluded.sample_count,
      average_is_exact = excluded.average_is_exact
  `);

  await db.execute(sql`
    INSERT INTO realm_daily (
      connected_realm_id, region_id, item_id, date,
      min_buyout, avg_buyout, max_buyout, avg_quantity, total_value, observed_quantity, sample_count, average_is_exact
    )
    SELECT
      connected_realm_id,
      region_id,
      item_id,
      (snapshot_time AT TIME ZONE 'UTC')::date,
      min(min_buyout),
      round(sum(coalesce(total_value, coalesce(avg_buyout, min_buyout)::numeric * total_quantity)) / nullif(sum(total_quantity), 0))::bigint,
      max(max_buyout),
      round(avg(total_quantity))::bigint,
      sum(coalesce(total_value, coalesce(avg_buyout, min_buyout)::numeric * total_quantity)),
      sum(total_quantity), count(*)::int, bool_and(total_value IS NOT NULL)
    FROM realm_snapshots
    WHERE snapshot_time >= coalesce(
      (SELECT (date_trunc('day', last_success_at AT TIME ZONE 'UTC') - interval '1 day') AT TIME ZONE 'UTC'
       FROM sync_jobs WHERE name = 'quantity-weighted-rollups'),
      '-infinity'::timestamptz
    )
    GROUP BY connected_realm_id, region_id, item_id, (snapshot_time AT TIME ZONE 'UTC')::date
    ON CONFLICT (connected_realm_id, region_id, item_id, date) DO UPDATE SET
      min_buyout = excluded.min_buyout,
      avg_buyout = excluded.avg_buyout,
      max_buyout = excluded.max_buyout,
      avg_quantity = excluded.avg_quantity,
      total_value = excluded.total_value,
      observed_quantity = excluded.observed_quantity,
      sample_count = excluded.sample_count,
      average_is_exact = excluded.average_is_exact
  `);
  await db.execute(sql`
    INSERT INTO sync_jobs (name, status, last_success_at)
    VALUES ('quantity-weighted-rollups', 'succeeded', now())
    ON CONFLICT (name) DO UPDATE SET status = 'succeeded', last_success_at = excluded.last_success_at
  `);
}

export async function pruneRawPrices(): Promise<void> {
  await archiveExpiredPriceHistory();
  await db.execute(sql`
    DELETE FROM auction_sync_runs
    WHERE coalesce(finished_at, started_at) < now() - (${env.RAW_SNAPSHOT_RETENTION_DAYS} * interval '1 day')
  `);
  await db.execute(sql`
    DELETE FROM market_refresh_cycles
    WHERE coalesce(finished_at, started_at) < now() - (${env.RAW_SNAPSHOT_RETENTION_DAYS} * interval '1 day')
  `);
}

export async function runPriceMaintenance(): Promise<void> {
  console.log("[Maintenance] Aggregating daily price history");
  await aggregateDailyPrices();
  console.log(`[Maintenance] Archiving raw snapshots older than ${env.RAW_SNAPSHOT_RETENTION_DAYS} days`);
  await pruneRawPrices();
  console.log("[Maintenance] Price history maintenance complete");
}
