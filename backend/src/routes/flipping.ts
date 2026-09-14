import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { findRealmSpreadOpportunities } from "../services/current-market";

const flippingRoutes = new Hono();

// ─── GET /categories — All flipping categories for dropdown ─────────

flippingRoutes.get("/categories", async (c) => {
  const region = c.req.query("region") || "eu";

  try {
    const rows = await db.execute(sql`
      SELECT
        rc.name AS category_name
      FROM recipes r
      JOIN items i ON i.id = r.output_item_id
      LEFT JOIN recipe_categories rc ON rc.id = r.category_id
      WHERE i.is_crafted_output = true
      GROUP BY rc.name
      ORDER BY (rc.name IS NULL) ASC, rc.name ASC
    `);

    const categories = Array.from(rows as Iterable<Record<string, unknown>>).map((row) => ({
      categoryId: null,
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
  const categoryIdQuery = c.req.query("categoryId");
  const parsedCategoryId = categoryIdQuery ? Number(categoryIdQuery) : undefined;
  const categoryId = Number.isFinite(parsedCategoryId) ? parsedCategoryId : undefined;
  const categoryNameQuery = c.req.query("categoryName")?.trim();
  const categoryName = categoryNameQuery && categoryNameQuery.length > 0 ? categoryNameQuery : undefined;
  const uncategorized = c.req.query("uncategorized") === "true";
  const sortByQuery = c.req.query("sortBy");
  const sortBy = sortByQuery === "regionAvgPrice" ? "regionAvgPrice" : "spread";

  try {
    const opportunities = await findRealmSpreadOpportunities({
      regionId: region,
      minSpread,
      limit,
      categoryId,
      categoryName,
      uncategorized,
      sortBy,
    });

    console.log(`[Flipping] Found ${opportunities.length} opportunities in region ${region}`);
    return c.json(opportunities);
  } catch (err) {
    console.error("[Flipping] Error computing flipping opportunities:", err);
    return c.json({ error: "Failed to compute flipping opportunities" }, 500);
  }
});

export default flippingRoutes;
