import type { HistoryRange, MarketHistoryPoint, MarketHistoryRequest } from "./market-history";
import type { RecipeScenario, RecipeValuation } from "./recipe-valuation";

export interface RecipeHistoryPoint {
  time: string;
  cost: number | null;
  output: number | null;
  outputQuantity: number | null;
}

export interface RecipeScenarioHistory {
  scenarioKey: string;
  points: RecipeHistoryPoint[];
}

export interface RecipeHistory {
  recipeId: number;
  range: HistoryRange;
  scenarios: RecipeScenarioHistory[];
}

interface RecipeHistoryDependencies {
  loadValuation(recipeId: number, regionId: string, connectedRealmId?: number): Promise<RecipeValuation>;
  loadMarketHistories(request: MarketHistoryRequest): Promise<Map<number, MarketHistoryPoint[]>>;
}

export interface RecipeHistoryModule {
  getRecipeHistory(
    recipeId: number,
    regionId: string,
    connectedRealmId: number,
    range: HistoryRange,
  ): Promise<RecipeHistory>;
}

function timestamp(point: MarketHistoryPoint): number | null {
  const value = new Date(point.time).getTime();
  return Number.isFinite(value) ? value : null;
}

function timelineForScenario(scenario: RecipeScenario, histories: Map<number, MarketHistoryPoint[]>): number[] {
  if (!scenario.outputItemId) return [];
  const itemIds = new Set([scenario.outputItemId, ...scenario.cost.reagents.map((reagent) => reagent.itemId)]);
  return [
    ...new Set(
      [...itemIds].flatMap((itemId) =>
        (histories.get(itemId) ?? [])
          .map(timestamp)
          .filter((value): value is number => value !== null),
      ),
    ),
  ].sort((left, right) => left - right);
}

function carryForward(
  series: MarketHistoryPoint[],
  timeline: number[],
  valueFor: (point: MarketHistoryPoint) => number | null,
): Array<number | null> {
  const ascending = [...series]
    .map((point) => ({ point, time: timestamp(point) }))
    .filter((entry): entry is { point: MarketHistoryPoint; time: number } => entry.time !== null)
    .sort((left, right) => left.time - right.time);
  const values: Array<number | null> = new Array(timeline.length).fill(null);
  let pointer = 0;
  let lastValue: number | null = null;

  for (let index = 0; index < timeline.length; index++) {
    while (pointer < ascending.length && ascending[pointer]!.time <= timeline[index]!) {
      const nextValue = valueFor(ascending[pointer]!.point);
      if (nextValue !== null) lastValue = nextValue;
      pointer++;
    }
    values[index] = lastValue;
  }

  return values;
}

function buildScenarioHistory(
  scenario: RecipeScenario,
  histories: Map<number, MarketHistoryPoint[]>,
): RecipeScenarioHistory {
  const timeline = timelineForScenario(scenario, histories);
  if (!scenario.outputItemId || timeline.length === 0) return { scenarioKey: scenario.scenarioKey, points: [] };

  const itemIds = new Set([scenario.outputItemId, ...scenario.cost.reagents.map((reagent) => reagent.itemId)]);
  const pricesByItem = new Map<number, Array<number | null>>();
  for (const itemId of itemIds) {
    pricesByItem.set(
      itemId,
      carryForward(histories.get(itemId) ?? [], timeline, (point) => point.min_price),
    );
  }
  const outputQuantities = carryForward(
    histories.get(scenario.outputItemId) ?? [],
    timeline,
    (point) => point.total_quantity,
  );

  const points = timeline.map((time, index): RecipeHistoryPoint => {
    let totalCost = 0;
    let hasCost = scenario.cost.reagents.length > 0;
    for (const reagent of scenario.cost.reagents) {
      const price = pricesByItem.get(reagent.itemId)?.[index] ?? null;
      if (price === null) {
        hasCost = false;
        break;
      }
      totalCost += price * reagent.quantity;
    }

    const outputPrice = pricesByItem.get(scenario.outputItemId!)?.[index] ?? null;
    return {
      time: new Date(time).toISOString(),
      cost: hasCost ? Math.round(totalCost) : null,
      output: outputPrice === null ? null : Math.round(outputPrice * scenario.outputQuantity),
      outputQuantity: outputQuantities[index] ?? null,
    };
  });

  return { scenarioKey: scenario.scenarioKey, points };
}

export function createRecipeHistoryModule(dependencies: RecipeHistoryDependencies): RecipeHistoryModule {
  return {
    async getRecipeHistory(recipeId, regionId, connectedRealmId, range) {
      const valuation = await dependencies.loadValuation(recipeId, regionId, connectedRealmId);
      const itemIds = [
        ...new Set(
          valuation.scenarios.flatMap((scenario) => [
            ...(scenario.outputItemId ? [scenario.outputItemId] : []),
            ...scenario.cost.reagents.map((reagent) => reagent.itemId),
          ]),
        ),
      ];
      const histories = await dependencies.loadMarketHistories({
        regionId,
        itemIds,
        range,
        type: "auto",
        connectedRealmId,
      });

      return {
        recipeId,
        range,
        scenarios: valuation.scenarios.map((scenario) => buildScenarioHistory(scenario, histories)),
      };
    },
  };
}

let productionModulePromise: Promise<RecipeHistoryModule> | undefined;

async function getProductionModule(): Promise<RecipeHistoryModule> {
  productionModulePromise ??= Promise.all([import("./recipe-valuation"), import("./market-history")]).then(
    ([valuation, history]) =>
      createRecipeHistoryModule({
        loadValuation: valuation.getRecipeValuation,
        loadMarketHistories: history.getMarketHistories,
      }),
  );
  return productionModulePromise;
}

export async function getRecipeHistory(
  recipeId: number,
  regionId: string,
  connectedRealmId: number,
  range: HistoryRange,
): Promise<RecipeHistory> {
  return (await getProductionModule()).getRecipeHistory(recipeId, regionId, connectedRealmId, range);
}
