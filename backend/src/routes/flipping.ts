import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db";

const flippingRoutes = new Hono();

// ─── GET /categories — All flipping categories for dropdown ─────────

flippingRoutes.get("/categories", async (c) => {
  const region = c.req.query("region") || "eu";

  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT
        r.category_id,
        rc.name AS category_name
      FROM recipes r
      JOIN items i ON i.id = r.output_item_id
      LEFT JOIN recipe_categories rc ON rc.id = r.category_id
      WHERE i.is_crafted_output = true
      ORDER BY (r.category_id IS NULL) ASC, rc.name ASC
    `);

    const categories = Array.from(rows as Iterable<Record<string, unknown>>).map((row) => ({
      categoryId: row.category_id ? Number(row.category_id) : null,
      categoryName: (row.category_name as string | null) ?? null,
    }));

    console.log(`[Flipping] Found ${categories.length} categories for region ${region}`);
    return c.json(categories);
  } catch (err) {
    console.error("[Flipping] Error fetching categories:", err);
    return c.json({ error: "Failed to fetch flipping categories" }, 500);
  }
});

// ─── GET /opportunities — Flipping opportunities across realms ──────

flippingRoutes.get("/opportunities", async (c) => {
  const region = c.req.query("region") || "eu";
  const minSpread = Math.max(0, Number(c.req.query("minSpread")) || 0);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));

  try {
    const rows = await db.execute(sql`
      WITH latest_time AS (
        SELECT max(snapshot_time) AS max_time
        FROM realm_snapshots
        WHERE region_id = ${region}
      ),
      latest_per_realm AS (
        SELECT DISTINCT ON (rs.connected_realm_id, rs.item_id)
          rs.item_id, rs.connected_realm_id, rs.min_buyout
        FROM realm_snapshots rs, latest_time lt
        WHERE rs.region_id = ${region}
          AND rs.snapshot_time >= lt.max_time - interval '4 hours'
        ORDER BY rs.connected_realm_id, rs.item_id, rs.snapshot_time DESC
      ),
      item_agg AS (
        SELECT
          lpr.item_id,
          avg(lpr.min_buyout)::bigint AS region_avg_price,
          min(lpr.min_buyout)::bigint AS min_price,
          max(lpr.min_buyout)::bigint AS max_price,
          count(*)::int AS realm_count
        FROM latest_per_realm lpr
        GROUP BY lpr.item_id
        HAVING (max(lpr.min_buyout) - min(lpr.min_buyout)) >= ${minSpread}
      ),
      cheapest AS (
        SELECT DISTINCT ON (lpr.item_id)
          lpr.item_id, lpr.connected_realm_id, lpr.min_buyout
        FROM latest_per_realm lpr
        INNER JOIN item_agg ia ON ia.item_id = lpr.item_id
        ORDER BY lpr.item_id, lpr.min_buyout ASC
      ),
      expensive AS (
        SELECT DISTINCT ON (lpr.item_id)
          lpr.item_id, lpr.connected_realm_id, lpr.min_buyout
        FROM latest_per_realm lpr
        INNER JOIN item_agg ia ON ia.item_id = lpr.item_id
        ORDER BY lpr.item_id, lpr.min_buyout DESC
      )
      SELECT
        ia.item_id,
        i.name AS item_name,
        i.item_quality,
        i.quality_rank,
        cat.category_id,
        cat.category_name,
        cat.profession_name,
        ia.region_avg_price,
        c.connected_realm_id AS cheapest_realm_id,
        (SELECT r.name FROM realms r
         WHERE r.connected_realm_id = c.connected_realm_id AND r.region_id = ${region}
         LIMIT 1) AS cheapest_realm_name,
        c.min_buyout AS cheapest_min_buyout,
        e.connected_realm_id AS expensive_realm_id,
        (SELECT r.name FROM realms r
         WHERE r.connected_realm_id = e.connected_realm_id AND r.region_id = ${region}
         LIMIT 1) AS expensive_realm_name,
        e.min_buyout AS expensive_min_buyout,
        (ia.max_price - ia.min_price) AS spread,
        round((ia.max_price - ia.min_price)::numeric / nullif(ia.min_price, 0) * 100, 1) AS spread_percent,
        ia.realm_count
      FROM item_agg ia
      JOIN items i ON i.id = ia.item_id
      LEFT JOIN LATERAL (
        SELECT
          rc.id AS category_id,
          rc.name AS category_name,
          p.name AS profession_name
        FROM recipes r
        LEFT JOIN recipe_categories rc ON rc.id = r.category_id
        LEFT JOIN professions p ON p.id = r.profession_id
        WHERE r.output_item_id = ia.item_id
        ORDER BY (r.category_id IS NULL) ASC, rc.name ASC, r.id ASC
        LIMIT 1
      ) cat ON true
      JOIN cheapest c ON c.item_id = ia.item_id
      JOIN expensive e ON e.item_id = ia.item_id
      WHERE i.is_crafted_output = true
      ORDER BY (ia.max_price - ia.min_price) DESC
      LIMIT ${limit}
    `);

    const opportunities = Array.from(rows as Iterable<Record<string, unknown>>).map((row) => ({
      itemId: Number(row.item_id),
      itemName: row.item_name as string,
      itemQuality: row.item_quality ? Number(row.item_quality) : null,
      qualityRank: row.quality_rank ? Number(row.quality_rank) : null,
      categoryId: row.category_id ? Number(row.category_id) : null,
      categoryName: (row.category_name as string | null) ?? null,
      professionName: (row.profession_name as string | null) ?? null,
      regionAvgPrice: Number(row.region_avg_price),
      cheapestRealm: {
        realmId: Number(row.cheapest_realm_id),
        realmName: (row.cheapest_realm_name as string) ?? `Realm ${row.cheapest_realm_id}`,
        minBuyout: Number(row.cheapest_min_buyout),
      },
      mostExpensiveRealm: {
        realmId: Number(row.expensive_realm_id),
        realmName: (row.expensive_realm_name as string) ?? `Realm ${row.expensive_realm_id}`,
        minBuyout: Number(row.expensive_min_buyout),
      },
      spread: Number(row.spread),
      spreadPercent: Number(row.spread_percent),
      realmCount: Number(row.realm_count),
    }));

    console.log(`[Flipping] Found ${opportunities.length} opportunities in region ${region}`);
    return c.json(opportunities);
  } catch (err) {
    console.error("[Flipping] Error computing flipping opportunities:", err);
    return c.json({ error: "Failed to compute flipping opportunities" }, 500);
  }
});

export default flippingRoutes;
