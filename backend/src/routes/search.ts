import { Hono } from "hono";
import { eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { items, recipes, professions } from "../db/schema";

const searchRoutes = new Hono();

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

// ─── GET / — Unified search across items and recipes ────────────────

searchRoutes.get("/", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Search query 'q' is required" }, 400);

  const region = c.req.query("region") || "eu";
  const safeQ = escapeLike(q);

  try {
    // Search items by name
    const matchedItems = await db
      .select({
        id: items.id,
        name: items.name,
        itemQuality: items.itemQuality,
        qualityRank: items.qualityRank,
        isReagent: items.isReagent,
        isCraftedOutput: items.isCraftedOutput,
      })
      .from(items)
      .where(ilike(items.name, `%${safeQ}%`))
      .limit(20);

    // Search recipes by name, with profession info
    const matchedRecipes = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        professionId: recipes.professionId,
        professionName: professions.name,
      })
      .from(recipes)
      .innerJoin(professions, eq(recipes.professionId, professions.id))
      .where(ilike(recipes.name, `%${safeQ}%`))
      .limit(20);

    return c.json({ items: matchedItems, recipes: matchedRecipes });
  } catch (err) {
    console.error(`[Search] Error searching for "${q}":`, err);
    return c.json({ error: "Search failed" }, 500);
  }
});

export default searchRoutes;
