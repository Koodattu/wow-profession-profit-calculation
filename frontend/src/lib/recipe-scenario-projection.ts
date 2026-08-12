import type {
  ProfessionRecipeCost,
  RankScenario,
  RecipeHistoryPoint,
  RecipeProfitResult,
} from "./api";

const NORMAL_SCENARIOS = [
  { scenarioKey: "rank:1:1", label: "Pure R1" },
  { scenarioKey: "rank:2:2", label: "Pure R2" },
  { scenarioKey: "rank:1:2", label: "Conc R1→R2" },
] as const;

export interface ProjectedRecipeScenario {
  scenarioKey: string;
  label: string;
  scenario: RankScenario;
  history: RecipeHistoryPoint[];
}

export interface RecipeSummaryProjection {
  kind: "normal" | "salvage";
  scenarios: Array<{
    scenarioKey: string;
    label: string;
    scenario: RankScenario | null;
  }>;
}

function salvageLabel(scenario: RankScenario): string {
  const input = scenario.cost.reagents[0];
  return input ? `${input.itemName} ×${input.quantity}` : `Input ${scenario.inputItemId ?? "unknown"}`;
}

export function projectRecipeSummary(valuation: ProfessionRecipeCost): RecipeSummaryProjection {
  const byKey = new Map(valuation.scenarios.map((scenario) => [scenario.scenarioKey, scenario]));
  if (valuation.scenarios.some((scenario) => scenario.isSalvage)) {
    return {
      kind: "salvage",
      scenarios: valuation.scenarios.map((scenario) => ({
        scenarioKey: scenario.scenarioKey,
        label: salvageLabel(scenario),
        scenario,
      })),
    };
  }

  return {
    kind: "normal",
    scenarios: NORMAL_SCENARIOS.map(({ scenarioKey, label }) => ({
      scenarioKey,
      label,
      scenario: byKey.get(scenarioKey) ?? null,
    })),
  };
}

export function projectRecipeDetail(
  valuation: RecipeProfitResult,
  history: Readonly<Record<string, RecipeHistoryPoint[]>> = {},
): ProjectedRecipeScenario[] {
  return valuation.scenarios.map((scenario) => ({
    scenarioKey: scenario.scenarioKey,
    label: scenario.isSalvage
      ? salvageLabel(scenario)
      : NORMAL_SCENARIOS.find((candidate) => candidate.scenarioKey === scenario.scenarioKey)?.label ?? scenario.scenarioKey,
    scenario,
    history: history[scenario.scenarioKey] ?? [],
  }));
}
