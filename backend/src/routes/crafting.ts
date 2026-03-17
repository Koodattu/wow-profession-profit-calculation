import { Hono } from "hono";
import { computeRecipeProfit, computeProfessionRecipeCosts } from "../services/crafting-cost";

const craftingRoutes = new Hono();

// ─── GET /professions/:professionId — All recipes with costs ────────

craftingRoutes.get("/professions/:professionId", async (c) => {
  const professionId = Number(c.req.param("professionId"));
  if (isNaN(professionId)) return c.json({ error: "Invalid profession ID" }, 400);

  const region = c.req.query("region") || "eu";
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !Number.isFinite(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    const results = await computeProfessionRecipeCosts(professionId, region, connectedRealmId);
    return c.json(results);
  } catch (err) {
    console.error(`[Crafting] Error computing costs for profession ${professionId}:`, err);
    return c.json({ error: "Failed to compute crafting costs" }, 500);
  }
});

// ─── GET /recipes/:recipeId — Single recipe cost breakdown ──────────

craftingRoutes.get("/recipes/:recipeId", async (c) => {
  const recipeId = Number(c.req.param("recipeId"));
  if (isNaN(recipeId)) return c.json({ error: "Invalid recipe ID" }, 400);

  const region = c.req.query("region") || "eu";
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !Number.isFinite(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    const result = await computeRecipeProfit(recipeId, region, connectedRealmId);
    return c.json(result);
  } catch (err) {
    console.error(`[Crafting] Error computing cost for recipe ${recipeId}:`, err);
    return c.json({ error: "Failed to compute recipe cost" }, 500);
  }
});

export default craftingRoutes;
