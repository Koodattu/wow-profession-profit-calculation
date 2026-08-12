import { describe, expect, test } from "bun:test";
import type { MarketHistoryPoint, MarketHistoryRequest } from "./market-history";
import { createRecipeHistoryModule } from "./recipe-history";
import type { RecipeScenario, RecipeValuation } from "./recipe-valuation";

function point(time: string, minPrice: number | null, quantity: number | null = null): MarketHistoryPoint {
  return {
    time,
    min_price: minPrice,
    avg_price: minPrice,
    median_price: minPrice,
    max_price: minPrice,
    total_quantity: quantity,
  };
}

function scenario(overrides: Partial<RecipeScenario> = {}): RecipeScenario {
  return {
    scenarioKey: "rank:1:1",
    reagentRank: 1,
    outputRank: 1,
    cost: {
      reagents: [
        {
          slotIndex: 1,
          itemId: 10,
          itemName: "First reagent",
          itemQuality: null,
          quantity: 2,
          unitPrice: 0,
          totalPrice: 0,
        },
        {
          slotIndex: 2,
          itemId: 20,
          itemName: "Second reagent",
          itemQuality: null,
          quantity: 3,
          unitPrice: 0,
          totalPrice: 0,
        },
      ],
      totalCost: 0,
    },
    outputItemId: 30,
    outputItemName: "Output",
    outputItemQuality: null,
    outputQuantity: 5,
    outputUnitPrice: null,
    outputTotalPrice: null,
    profit: null,
    ...overrides,
  };
}

function valuation(scenarios: RecipeScenario[]): RecipeValuation {
  return {
    recipeId: 100,
    recipeName: "Fixture Recipe",
    qualityTierType: "2rank",
    affectedByMulticraft: false,
    affectedByResourcefulness: false,
    professionId: 200,
    professionName: "Fixture Profession",
    scenarios,
  };
}

describe("recipe history interface", () => {
  test("aligns sparse item series and carries prices forward per scenario", async () => {
    const t1 = "2026-08-09T00:00:00.000Z";
    const t2 = "2026-08-09T01:00:00.000Z";
    const t3 = "2026-08-09T02:00:00.000Z";
    let marketRequest: MarketHistoryRequest | undefined;
    const module = createRecipeHistoryModule({
      loadValuation: async () => valuation([scenario()]),
      loadMarketHistories: async (request) => {
        marketRequest = request;
        return new Map([
          [10, [point(t3, 20), point(t1, 10)]],
          [20, [point(t2, 4)]],
          [30, [point(t3, 110, 6), point(t2, 100, 7)]],
        ]);
      },
    });

    const result = await module.getRecipeHistory(100, "eu", 3679, "24h");

    expect(marketRequest).toEqual({
      regionId: "eu",
      itemIds: [30, 10, 20],
      range: "24h",
      type: "auto",
      connectedRealmId: 3679,
    });
    expect(result.scenarios).toEqual([
      {
        scenarioKey: "rank:1:1",
        points: [
          { time: t1, cost: null, output: null, outputQuantity: null },
          { time: t2, cost: 32, output: 500, outputQuantity: 7 },
          { time: t3, cost: 52, output: 550, outputQuantity: 6 },
        ],
      },
    ]);
  });

  test("keeps scenario timelines independent while loading shared items once", async () => {
    const t1 = "2026-08-09T00:00:00.000Z";
    const t2 = "2026-08-09T01:00:00.000Z";
    const scenarios = [
      scenario(),
      scenario({
        scenarioKey: "salvage:40",
        isSalvage: true,
        inputItemId: 40,
        cost: {
          reagents: [
            {
              slotIndex: 1,
              itemId: 40,
              itemName: "Salvage input",
              itemQuality: null,
              quantity: 1,
              unitPrice: 0,
              totalPrice: 0,
            },
          ],
          totalCost: 0,
        },
      }),
    ];
    const module = createRecipeHistoryModule({
      loadValuation: async () => valuation(scenarios),
      loadMarketHistories: async () =>
        new Map([
          [10, [point(t1, 10)]],
          [20, []],
          [30, [point(t1, 100, 5)]],
          [40, [point(t2, 7)]],
        ]),
    });

    const result = await module.getRecipeHistory(100, "eu", 3679, "7d");

    expect(result.scenarios[0]).toEqual({
      scenarioKey: "rank:1:1",
      points: [{ time: t1, cost: null, output: 500, outputQuantity: 5 }],
    });
    expect(result.scenarios[1]).toEqual({
      scenarioKey: "salvage:40",
      points: [
        { time: t1, cost: null, output: 500, outputQuantity: 5 },
        { time: t2, cost: 7, output: 500, outputQuantity: 5 },
      ],
    });
  });
});
