import { isDatabaseId } from "./validation";
import { Hono } from "hono";
import { isHistoryRange } from "../services/market-history";
import { getRecipeHistory } from "../services/recipe-history";
import { getProfessionRecipeValuations, getRecipeValuation, getRecipeValuations } from "../services/recipe-valuation";

const craftingRoutes = new Hono();

// One bounded read for a browser's craft plan. Missing catalog recipes are omitted.
craftingRoutes.get("/recipes", async (c) => {
  const rawIds = c.req.query("ids")?.split(",") ?? [];
  if (rawIds.length === 0 || rawIds.length > 50 || rawIds.some((id) => !/^\d+$/.test(id) || !isDatabaseId(Number(id)))) {
    return c.json({ error: "Provide between 1 and 50 valid recipe IDs" }, 400);
  }
  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);
  const connectedRealmId = Number(c.req.query("connectedRealmId"));
  if (!isDatabaseId(connectedRealmId)) return c.json({ error: "A connected realm is required" }, 400);

  try {
    return c.json(await getRecipeValuations([...new Set(rawIds.map(Number))], region, connectedRealmId));
  } catch (err) {
    console.error("[Crafting] Error computing recipe batch:", err);
    return c.json({ error: "Failed to compute crafting costs" }, 500);
  }
});

// ─── GET /professions/:professionId — All recipes with costs ────────

craftingRoutes.get("/professions/:professionId", async (c) => {
  const professionId = Number(c.req.param("professionId"));
  if (!isDatabaseId(professionId)) return c.json({ error: "Invalid profession ID" }, 400);

  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !isDatabaseId(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    const results = await getProfessionRecipeValuations(professionId, region, connectedRealmId);
    return c.json(results);
  } catch (err) {
    console.error(`[Crafting] Error computing costs for profession ${professionId}:`, err);
    return c.json({ error: "Failed to compute crafting costs" }, 500);
  }
});

// ─── GET /recipes/:recipeId/history — Aligned scenario history ───────

craftingRoutes.get("/recipes/:recipeId/history", async (c) => {
  const recipeId = Number(c.req.param("recipeId"));
  if (!isDatabaseId(recipeId)) return c.json({ error: "Invalid recipe ID" }, 400);

  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);
  const rangeQuery = c.req.query("range") || "24h";
  if (!isHistoryRange(rangeQuery)) return c.json({ error: "Invalid history range" }, 400);
  const connectedRealmId = Number(c.req.query("connectedRealmId"));
  if (!isDatabaseId(connectedRealmId)) {
    return c.json({ error: "A connected realm is required" }, 400);
  }

  try {
    const result = await getRecipeHistory(recipeId, region, connectedRealmId, rangeQuery);
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json(result);
  } catch (err) {
    console.error(`[Crafting] Error building history for recipe ${recipeId}:`, err);
    return c.json({ error: "Failed to build recipe history" }, 500);
  }
});

// ─── GET /recipes/:recipeId — Single recipe cost breakdown ──────────

craftingRoutes.get("/recipes/:recipeId", async (c) => {
  const recipeId = Number(c.req.param("recipeId"));
  if (!isDatabaseId(recipeId)) return c.json({ error: "Invalid recipe ID" }, 400);

  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);
  const connectedRealmIdQuery = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdQuery ? Number(connectedRealmIdQuery) : undefined;
  if (connectedRealmIdQuery && !isDatabaseId(connectedRealmId)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    const result = await getRecipeValuation(recipeId, region, connectedRealmId);
    return c.json(result);
  } catch (err) {
    console.error(`[Crafting] Error computing cost for recipe ${recipeId}:`, err);
    return c.json({ error: "Failed to compute recipe cost" }, 500);
  }
});

export default craftingRoutes;
