import { sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { archiveExpiredPriceHistory } from "./price-history-archive";
import { packRealmHistory } from "./realm-history-storage";

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
    FROM realm_history
    WHERE history_day >= coalesce(
      (SELECT (last_success_at AT TIME ZONE 'UTC')::date - 1
       FROM sync_jobs WHERE name = 'quantity-weighted-rollups'),
      '-infinity'::date
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
  console.log(`[Maintenance] Packed ${await packRealmHistory()} realm observations without discarding detail`);
  const variants = await pruneUnusedRealmVariants();
  console.log(`[Maintenance] Variant retirement: ${JSON.stringify(variants)}`);
  console.log("[Maintenance] Price history maintenance complete");
}

export async function pruneUnusedRealmVariants(now = new Date()): Promise<{ marked: number; deleted: number; skipped: boolean }> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('realm-variant-retirement', 0)) AS acquired`);
    if (!lock?.acquired) return { marked: 0, deleted: 0, skipped: true };
    await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
    await tx.execute(sql`SET LOCAL work_mem = '32MB'`);
    // Materialize once rather than probing every realm for each definition.
    await tx.execute(sql`CREATE TEMP TABLE referenced_realm_variants ON COMMIT DROP AS SELECT DISTINCT variant_id FROM realm_latest`);
    await tx.execute(sql`CREATE UNIQUE INDEX ON referenced_realm_variants (variant_id)`);
    await tx.execute(sql`ANALYZE referenced_realm_variants`);
    await tx.execute(sql`
      UPDATE realm_variants v SET unreferenced_at = NULL FROM referenced_realm_variants r
      WHERE v.id = r.variant_id AND v.unreferenced_at IS NOT NULL
    `);
    const [marked] = await tx.execute(sql`WITH marked AS (
      UPDATE realm_variants v SET unreferenced_at = ${now.toISOString()}::timestamptz
      WHERE v.unreferenced_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM referenced_realm_variants r WHERE r.variant_id = v.id)
      RETURNING id
    ) SELECT count(*)::int AS count FROM marked`);
    const [deleted] = await tx.execute(sql`WITH deleted AS (
      DELETE FROM realm_variants v
      WHERE unreferenced_at < ${now.toISOString()}::timestamptz - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM referenced_realm_variants r WHERE r.variant_id = v.id)
      RETURNING id
    ) SELECT count(*)::int AS count FROM deleted`);
    return { marked: Number(marked!.count), deleted: Number(deleted!.count), skipped: false };
  });
}
