import { useEffect, useState } from "react";
import { fetchRecipeCosts, type RecipeProfitResult, type ReagentCost } from "@/lib/api";
import { type CraftPlanEntry } from "@/lib/craft-plan";
import { projectRecipeDetail } from "@/lib/recipe-scenario-projection";
import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";

export function usePlanPrices(entries: CraftPlanEntry[]) {
  const realm = useSelectedRealm();
  const realmId = realm.status === "ready" ? realm.selectedId : null;
  const ids = [...new Set(entries.map((entry) => entry.recipeId))].sort((a, b) => a - b).join(",");
  const key = realmId === null || !ids ? null : `${realmId}/${ids}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; recipes: RecipeProfitResult[]; loadedAt: Date } | null>(null);
  const [failure, setFailure] = useState<{ key: string; attempt: number } | null>(null);

  useEffect(() => {
    if (key === null || realmId === null) return;
    let active = true;
    void fetchRecipeCosts(ids.split(",").map(Number), realmId).then((recipes) => {
      if (active) {
        setResult({ key, attempt, recipes, loadedAt: new Date() });
        setFailure(null);
      }
    }).catch(() => { if (active) setFailure({ key, attempt }); });
    return () => { active = false; };
  }, [ids, realmId, key, attempt]);

  const failed = realm.status === "error" || (key !== null && failure?.key === key && failure.attempt === attempt);
  const current = result?.key === key ? result : null;
  return {
    realm, recipes: current?.recipes ?? null, loadedAt: current?.loadedAt,
    failed, loading: realm.status === "loading" || (key !== null && !failed && current?.attempt !== attempt),
    refresh() {
      if (realm.status === "error") void selectedRealm.retry();
      else setAttempt((value) => value + 1);
    },
  };
}

export function valueCraftPlan(entries: CraftPlanEntry[], recipes: RecipeProfitResult[]) {
  const byId = new Map(recipes.map((recipe) => [recipe.recipeId, recipe]));
  const materials = new Map<number, ReagentCost>();
  let cost: number | null = 0;
  let output: number | null = 0;
  let missingChoices = 0;
  let incompleteMaterials = 0;
  const rows = entries.map((entry) => {
    const recipe = byId.get(entry.recipeId);
    const choice = recipe && projectRecipeDetail(recipe).find((scenario) => scenario.scenarioKey === entry.scenarioKey);
    const scenario = choice?.scenario;
    if (!scenario) missingChoices++;
    else if (scenario.cost.reagentsComplete !== true) incompleteMaterials++;
    const rowCost = scenario?.cost.totalCost == null ? null : scenario.cost.totalCost * entry.crafts;
    const rowOutput = scenario?.outputTotalPrice == null ? null : scenario.outputTotalPrice * entry.crafts;
    cost = cost === null || rowCost === null ? null : cost + rowCost;
    output = output === null || rowOutput === null ? null : output + rowOutput;
    for (const reagent of scenario?.cost.reagents ?? []) {
      const previous = materials.get(reagent.itemId);
      const quantity = (previous?.quantity ?? 0) + reagent.quantity * entry.crafts;
      const unitPrice = previous?.unitPrice === null ? null : reagent.unitPrice;
      materials.set(reagent.itemId, { ...reagent, quantity, unitPrice, totalPrice: unitPrice === null ? null : unitPrice * quantity });
    }
    return { entry, recipe, choice, cost: rowCost, output: rowOutput,
      profit: rowCost === null || rowOutput === null ? null : rowOutput - rowCost };
  });
  return {
    rows, materials: [...materials.values()].sort((a, b) => a.itemName.localeCompare(b.itemName) || a.itemId - b.itemId),
    cost, output, profit: cost === null || output === null ? null : output - cost,
    incompleteChoices: missingChoices + incompleteMaterials,
  };
}
