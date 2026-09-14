import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "../src/db";
import { findRealmSpreadOpportunities, getCurrentItemMarkets } from "../src/services/current-market";
import { getRecipeHistory } from "../src/services/recipe-history";
import { getProfessionRecipeValuations, getRecipeValuation } from "../src/services/recipe-valuation";

type Row = Record<string, unknown>;

function firstRow(rows: Iterable<object | undefined>, message: string): Row {
  const row = Array.from(rows)[0] as Row | undefined;
  if (!row) throw new Error(message);
  return row;
}

afterAll(async () => {
  await sql.end();
});

describe("current market interface", () => {
  test("commodity quotes remain EU-wide when a connected realm is selected", async () => {
    const commodity = firstRow(
      await sql`SELECT item_id FROM commodity_latest WHERE region_id = 'eu' ORDER BY item_id LIMIT 1`,
      "Integration database has no EU commodity data",
    );
    const realm = firstRow(
      await sql`SELECT id FROM connected_realms WHERE region_id = 'eu' ORDER BY id LIMIT 1`,
      "Integration database has no EU connected realms",
    );
    const itemId = Number(commodity.item_id);

    const [withoutRealm, withRealm] = await Promise.all([
      getCurrentItemMarkets("eu", [itemId]),
      getCurrentItemMarkets("eu", [itemId], Number(realm.id)),
    ]);

    expect(withRealm.get(itemId)?.priceSource).toBe("commodity");
    expect(withRealm.get(itemId)?.currentQuote).toEqual(withoutRealm.get(itemId)?.currentQuote);
    expect(withRealm.get(itemId)?.selectedRealmQuote).toBeNull();
    expect(withRealm.get(itemId)?.euRealmBenchmark).toBeNull();
  });

  test("EU realm benchmark is the unweighted mean of connected-realm minima", async () => {
    const item = firstRow(
      await sql`
        SELECT realm_latest.item_id
        FROM realm_latest
        WHERE realm_latest.region_id = 'eu'
          AND NOT EXISTS (
            SELECT 1 FROM commodity_latest
            WHERE commodity_latest.region_id = realm_latest.region_id
              AND commodity_latest.item_id = realm_latest.item_id
          )
        GROUP BY realm_latest.item_id
        HAVING count(DISTINCT realm_latest.connected_realm_id) > 1
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      "Integration database has no EU realm-only item data",
    );
    const itemId = Number(item.item_id);
    const expected = firstRow(
      await sql`
        SELECT avg(realm_min)::bigint AS benchmark, count(*)::int AS realm_count
        FROM (
          SELECT connected_realm_id, min(min_buyout)::bigint AS realm_min
          FROM realm_latest
          WHERE region_id = 'eu' AND item_id = ${itemId}
          GROUP BY connected_realm_id
        ) realm_quotes
      `,
      "Failed to calculate the expected EU realm benchmark",
    );

    const market = (await getCurrentItemMarkets("eu", [itemId])).get(itemId);

    expect(market?.priceSource).toBe("realm");
    expect(market?.euRealmBenchmark?.minPrice).toBe(Number(expected.benchmark));
    expect(market?.euRealmBenchmark?.realmCount).toBe(Number(expected.realm_count));
    expect(market?.currentQuote).toEqual(market?.euRealmBenchmark);
  });

  test("a missing selected realm quote does not fall back to the EU benchmark", async () => {
    const pair = firstRow(
      await sql`
        SELECT candidate.item_id, missing_realm.id AS connected_realm_id
        FROM (
          SELECT realm_latest.item_id
          FROM realm_latest
          WHERE realm_latest.region_id = 'eu'
            AND NOT EXISTS (
              SELECT 1 FROM commodity_latest
              WHERE commodity_latest.region_id = realm_latest.region_id
                AND commodity_latest.item_id = realm_latest.item_id
            )
          GROUP BY realm_latest.item_id
          HAVING count(DISTINCT realm_latest.connected_realm_id) < (
            SELECT count(*) FROM connected_realms WHERE region_id = 'eu'
          )
          ORDER BY count(*) DESC
          LIMIT 1
        ) candidate
        CROSS JOIN LATERAL (
          SELECT connected_realms.id
          FROM connected_realms
          WHERE connected_realms.region_id = 'eu'
            AND NOT EXISTS (
              SELECT 1 FROM realm_latest
              WHERE realm_latest.region_id = 'eu'
                AND realm_latest.item_id = candidate.item_id
                AND realm_latest.connected_realm_id = connected_realms.id
            )
          ORDER BY connected_realms.id
          LIMIT 1
        ) missing_realm
      `,
      "Integration database has no partially listed EU realm item",
    );
    const itemId = Number(pair.item_id);
    const market = (await getCurrentItemMarkets("eu", [itemId], Number(pair.connected_realm_id))).get(itemId);

    expect(market?.euRealmBenchmark).not.toBeNull();
    expect(market?.selectedRealmQuote).toBeNull();
    expect(market?.currentQuote).toBeNull();
    expect(market?.priceSource).toBeNull();
  });

  test("flipping uses the same EU realm benchmark", async () => {
    const [opportunity] = await findRealmSpreadOpportunities({
      regionId: "eu",
      minSpread: 0,
      limit: 1,
      sortBy: "spread",
    });
    if (!opportunity) throw new Error("Integration database has no EU flipping opportunities");

    const market = (await getCurrentItemMarkets("eu", [opportunity.itemId])).get(opportunity.itemId);
    const benchmark = market?.euRealmBenchmark;
    if (!benchmark) throw new Error(`Item ${opportunity.itemId} has no EU realm benchmark`);
    if (benchmark.realmCount === undefined) throw new Error(`Item ${opportunity.itemId} benchmark has no realm count`);

    expect(opportunity.regionAvgPrice).toBe(benchmark.minPrice);
    expect(opportunity.realmCount).toBe(benchmark.realmCount);
  });
});

describe("recipe valuation interface", () => {
  test("single-recipe and profession views share the same standard scenarios", async () => {
    const recipe = firstRow(
      await sql`
        SELECT recipes.id, recipes.profession_id
        FROM recipes
        WHERE recipes.output_item_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM recipe_reagent_slots
            WHERE recipe_reagent_slots.recipe_id = recipes.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM recipe_salvage_targets
            WHERE recipe_salvage_targets.recipe_id = recipes.id
          )
        ORDER BY recipes.id
        LIMIT 1
      `,
      "Integration database has no standard recipe",
    );
    const recipeId = Number(recipe.id);
    const [single, profession] = await Promise.all([
      getRecipeValuation(recipeId, "eu"),
      getProfessionRecipeValuations(Number(recipe.profession_id), "eu"),
    ]);
    const summary = profession.find((entry) => entry.recipeId === recipeId);
    if (!summary) throw new Error(`Profession valuation omitted recipe ${recipeId}`);

    expect(single.scenarios).toEqual(summary.scenarios);
    expect(single.scenarios).toHaveLength(3);
    expect(single.scenarios.map((scenario) => [scenario.reagentRank, scenario.outputRank])).toEqual([
      [1, 1],
      [2, 2],
      [1, 2],
    ]);
  });

  test("salvage detail and profession summary project one canonical valuation", async () => {
    const recipe = firstRow(
      await sql`
        SELECT recipes.id, recipes.profession_id
        FROM recipes
        WHERE recipes.output_item_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM recipe_salvage_targets
            WHERE recipe_salvage_targets.recipe_id = recipes.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM recipe_reagent_slots
            WHERE recipe_reagent_slots.recipe_id = recipes.id
          )
        ORDER BY recipes.id
        LIMIT 1
      `,
      "Integration database has no salvage recipe",
    );
    const recipeId = Number(recipe.id);
    const [single, profession] = await Promise.all([
      getRecipeValuation(recipeId, "eu"),
      getProfessionRecipeValuations(Number(recipe.profession_id), "eu"),
    ]);
    const summary = profession.find((entry) => entry.recipeId === recipeId);
    if (!summary) throw new Error(`Profession valuation omitted salvage recipe ${recipeId}`);

    expect(single.scenarios.length).toBeGreaterThan(0);
    expect(single.scenarios.every((scenario) => scenario.isSalvage)).toBe(true);
    expect(summary.scenarios).toEqual(single.scenarios);

    const pricedCosts = single.scenarios.flatMap((scenario) => (scenario.cost.totalCost === null ? [] : [scenario.cost.totalCost]));
    expect(pricedCosts).toEqual([...pricedCosts].sort((left, right) => left - right));
  });
});

describe("recipe history interface", () => {
  test("returns every canonical scenario through one aligned history operation", async () => {
    const recipe = firstRow(
      await sql`
        SELECT recipes.id
        FROM recipes
        WHERE EXISTS (
          SELECT 1
          FROM recipe_reagent_slots
          WHERE recipe_reagent_slots.recipe_id = recipes.id
        )
          AND EXISTS (
            SELECT 1
            FROM recipe_output_qualities
            JOIN commodity_snapshots
              ON commodity_snapshots.item_id = recipe_output_qualities.item_id
             AND commodity_snapshots.region_id = 'eu'
            WHERE recipe_output_qualities.recipe_id = recipes.id
          )
        ORDER BY recipes.id
        LIMIT 1
      `,
      "Integration database has no recipe with output history",
    );
    const realm = firstRow(
      await sql`SELECT id FROM connected_realms WHERE region_id = 'eu' ORDER BY id LIMIT 1`,
      "Integration database has no EU connected realms",
    );
    const recipeId = Number(recipe.id);
    const [valuation, history] = await Promise.all([
      getRecipeValuation(recipeId, "eu", Number(realm.id)),
      getRecipeHistory(recipeId, "eu", Number(realm.id), "24h"),
    ]);

    expect(history.scenarios.map((scenario) => scenario.scenarioKey)).toEqual(
      valuation.scenarios.map((scenario) => scenario.scenarioKey),
    );
    expect(history.scenarios.some((scenario) => scenario.points.length > 0)).toBe(true);
    for (const scenario of history.scenarios) {
      const times = scenario.points.map((point) => new Date(point.time).getTime());
      expect(times).toEqual([...times].sort((left, right) => left - right));
    }
  });
});
