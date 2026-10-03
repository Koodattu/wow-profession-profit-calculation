import "./support/local-env";
import { afterAll, expect, test } from "bun:test";
import app from "../src/app";
import { sql } from "../src/db";
import type { RecipeValuation } from "../src/services/recipe-valuation";

afterAll(async () => {
  await sql`DELETE FROM recipe_reagent_slot_options WHERE slot_id IN (SELECT id FROM recipe_reagent_slots WHERE recipe_id = 1900090001)`;
  await sql`DELETE FROM recipe_reagent_slots WHERE recipe_id = 1900090001`;
  await sql`DELETE FROM recipes WHERE id = 1900090001`;
  await sql`DELETE FROM items WHERE id = 1900090003`;
  await sql.end();
});

test("a bounded recipe batch returns the canonical valuations once per existing recipe", async () => {
  const ids = [1230864, 1230860];
  const response = await app.request(`/api/crafting/recipes?ids=${ids.join(",")},1230864,2147483647&connectedRealmId=1`);
  expect(response.status).toBe(200);
  const batch = await response.json() as RecipeValuation[];
  expect(batch.map((recipe) => recipe.recipeId).sort()).toEqual([...ids].sort());
  for (const id of ids) {
    const single = await app.request(`/api/crafting/recipes/${id}?connectedRealmId=1`);
    expect(batch.find((recipe) => recipe.recipeId === id)).toEqual(await single.json() as RecipeValuation);
  }
  const scenario = batch.find((recipe) => recipe.recipeId === 1230864)!.scenarios[0]!;
  expect(scenario.outputQuantity).toBe(5);
  expect(scenario.cost.reagents.find((reagent) => reagent.itemId === 236761)?.quantity).toBe(8);
});

test("an unresolved required reagent is distinguished from an unavailable quote for a known material", async () => {
  await sql`INSERT INTO recipes (id, name, profession_id, quality_tier_type) VALUES (1900090001, 'Incomplete plan fixture', 2906, 'none')`;
  await sql`INSERT INTO recipe_reagent_slots (recipe_id, slot_index, reagent_type, quantity, required) VALUES (1900090001, 0, 1, 3, true)`;
  const response = await app.request('/api/crafting/recipes?ids=1900090001,1230864&connectedRealmId=3');
  const batch = await response.json() as Array<{ recipeId: number; scenarios: Array<{ cost: { reagentsComplete: boolean; totalCost: number | null } }> }>;
  expect(batch.find((recipe) => recipe.recipeId === 1900090001)!.scenarios[0]!.cost.reagentsComplete).toBe(false);
  expect(batch.find((recipe) => recipe.recipeId === 1230864)!.scenarios[0]!.cost.reagentsComplete).toBe(true);
  await sql`INSERT INTO items (id, name) VALUES (1900090003, 'Unquoted material fixture')`;
  await sql`INSERT INTO recipe_reagent_slot_options (slot_id, option_index, item_id, reagent_name)
    SELECT id, 1, 1900090003, 'Unquoted material fixture' FROM recipe_reagent_slots WHERE recipe_id = 1900090001`;
  const known = await (await app.request('/api/crafting/recipes?ids=1900090001&connectedRealmId=3')).json() as RecipeValuation[];
  expect(known[0]!.scenarios[0]!.cost.reagentsComplete).toBe(true);
  expect(known[0]!.scenarios[0]!.cost.totalCost).toBeNull();
});

test("batch input bounds and explicit realm scope are enforced before database work", async () => {
  for (const query of [
    "", "ids=1", "ids=&connectedRealmId=1305", "ids=1,,2&connectedRealmId=1305",
    "ids=1.5&connectedRealmId=1305", "ids=2147483648&connectedRealmId=1305",
    "ids=1&connectedRealmId=Infinity", "ids=1&connectedRealmId=1305&region=us",
    `ids=${Array.from({ length: 51 }, (_, i) => i + 1).join(",")}&connectedRealmId=1305`,
  ]) {
    expect((await app.request(`/api/crafting/recipes?${query}`)).status, query).toBe(400);
  }
});
