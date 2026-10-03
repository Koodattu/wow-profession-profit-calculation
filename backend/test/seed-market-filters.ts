import "./support/local-env";
import { sql } from "../src/db";

// Optional, bounded catalog-size fixture for filtering and pagination QA.
// These are explicitly fictional items; no Blizzard requests or scheduler.
try {
  await sql.begin(async tx => {
    await tx`INSERT INTO items (id, name, market_type, item_class, item_subclass, inventory_type,
      item_quality, quality_rank, is_reagent, is_crafted_output)
      SELECT 1900200000 + n, 'Synthetic filter ' ||
        CASE n % 4 WHEN 0 THEN 'Cloth Hood' WHEN 1 THEN 'Plate Helm' WHEN 2 THEN 'Herb' ELSE 'Potion' END || ' ' || lpad(n::text, 5, '0'),
        CASE WHEN n % 4 < 2 THEN 'realm' ELSE 'commodity' END,
        CASE WHEN n % 4 < 2 THEN 'Armor' WHEN n % 4 = 2 THEN 'Trade Goods' ELSE 'Consumable' END,
        CASE n % 4 WHEN 0 THEN 'Cloth' WHEN 1 THEN 'Plate' WHEN 2 THEN 'Herb' ELSE 'Potion' END,
        CASE WHEN n % 4 < 2 THEN 'Head' ELSE NULL END,
        1 + n % 4, CASE WHEN n % 4 >= 2 THEN 1 + n % 3 ELSE NULL END,
        n % 4 = 2, n % 4 = 3
      FROM generate_series(1, 30000) n ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO commodity_latest
      (region_id, item_id, sync_run_id, observed_at, min_price, avg_price, median_price, max_price, total_quantity, num_auctions, price_p10, price_p25)
      SELECT 'eu', id, 1, now(), (id % 1000 + 1) * 100, (id % 1000 + 1) * 100, (id % 1000 + 1) * 100,
        (id % 1000 + 1) * 100, id % 500 + 1, 1, (id % 1000 + 1) * 100, (id % 1000 + 1) * 100
      FROM items WHERE id > 1900200000 AND id <= 1900230000 AND market_type = 'commodity' AND id % 7 != 0
      ON CONFLICT DO NOTHING`;
    const [variant] = await tx`INSERT INTO realm_variants (variant_key, bonus_lists, modifiers)
      VALUES ('synthetic-filter-demo', '[]', '[]') ON CONFLICT (variant_key) DO UPDATE SET variant_key = excluded.variant_key RETURNING id`;
    await tx`INSERT INTO realm_latest
      (region_id, connected_realm_id, item_id, variant_id, sync_run_id, observed_at, min_buyout, avg_buyout, median_buyout, max_buyout, total_quantity, num_auctions)
      SELECT 'eu', realm, id, ${variant!.id}, 1, now(), (id % 1000 + 1) * 10000 * realm, (id % 1000 + 1) * 10000 * realm,
        (id % 1000 + 1) * 10000 * realm, (id % 1000 + 1) * 10000 * realm, id % 10 + 1, 1
      FROM items CROSS JOIN generate_series(1, 2) realm
      WHERE id > 1900200000 AND id <= 1900230000 AND market_type = 'realm' AND id % (5 + realm) != 0
      ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO item_professions (item_id, profession_id)
      SELECT id, 2906 FROM items WHERE id > 1900200000 AND id <= 1900230000 AND is_reagent
      ON CONFLICT DO NOTHING`;
    await tx`ANALYZE items`;
    await tx`ANALYZE commodity_latest`;
    await tx`ANALYZE realm_latest`;
  });
  console.log("30,000 synthetic filter items ready. Prices are fictional; realm 3 is empty.");
} finally { await sql.end(); }
