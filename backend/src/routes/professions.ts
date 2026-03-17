import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { professions, recipeCategories, recipes, recipeReagentSlots, recipeReagentSlotOptions, recipeOutputQualities, recipeSalvageTargets, items } from "../db/schema";

const professionRoutes = new Hono();

// ─── GET / — List all professions ───────────────────────────────────

professionRoutes.get("/", async (c) => {
  try {
    const rows = await db.select().from(professions);
    return c.json(rows);
  } catch (err) {
    console.error("[Professions] Error listing professions:", err);
    return c.json({ error: "Failed to fetch professions" }, 500);
  }
});

// ─── GET /:professionId — Profession detail with categories ─────────

professionRoutes.get("/:professionId", async (c) => {
  const professionId = Number(c.req.param("professionId"));
  if (isNaN(professionId)) return c.json({ error: "Invalid profession ID" }, 400);

  try {
    const [profession] = await db.select().from(professions).where(eq(professions.id, professionId)).limit(1);
    if (!profession) return c.json({ error: "Profession not found" }, 404);

    const categories = await db.select().from(recipeCategories).where(eq(recipeCategories.professionId, professionId));

    return c.json({ ...profession, categories });
  } catch (err) {
    console.error(`[Professions] Error fetching profession ${professionId}:`, err);
    return c.json({ error: "Failed to fetch profession" }, 500);
  }
});

// ─── GET /:professionId/recipes — All recipes for a profession ──────

professionRoutes.get("/:professionId/recipes", async (c) => {
  const professionId = Number(c.req.param("professionId"));
  if (isNaN(professionId)) return c.json({ error: "Invalid profession ID" }, 400);

  try {
    const categories = await db.select().from(recipeCategories).where(eq(recipeCategories.professionId, professionId));
    const recipeRows = await db.select().from(recipes).where(eq(recipes.professionId, professionId));

    const grouped = categories.map((cat) => ({
      ...cat,
      recipes: recipeRows.filter((r) => r.categoryId === cat.id),
    }));

    return c.json(grouped);
  } catch (err) {
    console.error(`[Professions] Error fetching recipes for profession ${professionId}:`, err);
    return c.json({ error: "Failed to fetch recipes" }, 500);
  }
});

// ─── GET /recipes/:recipeId — Single recipe detail ──────────────────

professionRoutes.get("/recipes/:recipeId", async (c) => {
  const recipeId = Number(c.req.param("recipeId"));
  if (isNaN(recipeId)) return c.json({ error: "Invalid recipe ID" }, 400);

  try {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
    if (!recipe) return c.json({ error: "Recipe not found" }, 404);

    // Output item
    let outputItem: typeof items.$inferSelect | null = null;
    if (recipe.outputItemId != null) {
      const [item] = await db.select().from(items).where(eq(items.id, recipe.outputItemId)).limit(1);
      outputItem = item ?? null;
    }

    // Output qualities
    const outputQualities = await db.select().from(recipeOutputQualities).where(eq(recipeOutputQualities.recipeId, recipeId));

    // Reagent slots with options
    const slots = await db.select().from(recipeReagentSlots).where(eq(recipeReagentSlots.recipeId, recipeId));

    const slotsWithOptions = await Promise.all(
      slots.map(async (slot) => {
        const options = await db.select().from(recipeReagentSlotOptions).where(eq(recipeReagentSlotOptions.slotId, slot.id));
        return { ...slot, options };
      }),
    );

    // Salvage targets
    const salvageTargets = await db
      .select({
        id: recipeSalvageTargets.id,
        itemId: recipeSalvageTargets.itemId,
        itemName: items.name,
      })
      .from(recipeSalvageTargets)
      .leftJoin(items, eq(recipeSalvageTargets.itemId, items.id))
      .where(eq(recipeSalvageTargets.recipeId, recipeId));

    return c.json({
      ...recipe,
      outputItem,
      outputQualities,
      reagentSlots: slotsWithOptions,
      salvageTargets,
    });
  } catch (err) {
    console.error(`[Professions] Error fetching recipe ${recipeId}:`, err);
    return c.json({ error: "Failed to fetch recipe" }, 500);
  }
});

export default professionRoutes;
