import { describe, expect, test } from "vitest";
import type { ProfessionRecipeCost, RankScenario, RecipeProfitResult } from "./api";
import { projectRecipeDetail, projectRecipeSummary } from "./recipe-scenario-projection";

function scenario(scenarioKey: string, overrides: Partial<RankScenario> = {}): RankScenario {
  return {
    scenarioKey,
    reagentRank: 1,
    outputRank: 1,
    cost: { reagents: [], totalCost: null },
    outputItemId: 2,
    outputItemName: "Output",
    outputItemQuality: null,
    outputQuantity: 1,
    outputUnitPrice: null,
    outputTotalPrice: null,
    profit: null,
    ...overrides,
  };
}

function summary(scenarios: RankScenario[]): ProfessionRecipeCost {
  return {
    recipeId: 1,
    recipeName: "Recipe",
    categoryId: 1,
    qualityTierType: "2rank",
    affectedByMulticraft: false,
    affectedByResourcefulness: false,
    scenarios,
  };
}

describe("Recipe Scenario projection interface", () => {
  test("orders normal scenarios by canonical key without positional fallback", () => {
    const rankTwo = scenario("rank:2:2", { reagentRank: 2, outputRank: 2 });
    const projection = projectRecipeSummary(summary([rankTwo]));

    expect(projection.scenarios.map((entry) => entry.scenarioKey)).toEqual(["rank:1:1", "rank:2:2", "rank:1:2"]);
    expect(projection.scenarios.map((entry) => entry.scenario)).toEqual([null, rankTwo, null]);
  });

  test("keeps every salvage scenario and derives its label from the input", () => {
    const salvage = scenario("salvage:40", {
      isSalvage: true,
      inputItemId: 40,
      cost: {
        totalCost: null,
        reagents: [{ slotIndex: 1, itemId: 40, itemName: "Scrap", itemQuality: null, quantity: 5, unitPrice: null, totalPrice: null }],
      },
    });

    const projection = projectRecipeSummary(summary([salvage]));

    expect(projection.kind).toBe("salvage");
    expect(projection.scenarios).toEqual([{ scenarioKey: "salvage:40", label: "Scrap ×5", scenario: salvage }]);
  });

  test("associates history only by Recipe Scenario Key", () => {
    const valuation: RecipeProfitResult = {
      ...summary([scenario("rank:1:1")]),
      professionId: 1,
      professionName: "Alchemy",
    };
    const point = { time: "2026-08-12T00:00:00.000Z", cost: null, output: 100, outputQuantity: 1 };

    expect(projectRecipeDetail(valuation, { "rank:1:1": [point], "rank:2:2": [] })[0]?.history).toEqual([point]);
  });
});
