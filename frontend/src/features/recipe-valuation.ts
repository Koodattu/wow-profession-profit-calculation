import { useEffect, useState } from "react";
import {
  fetchRecipeCost,
  fetchRecipeHistory,
  type RecipeHistoryPoint,
  type RecipeProfitResult,
} from "@/lib/api";
import { useSelectedRealm } from "@/lib/selected-realm";
import type { HistoryRange } from "@/lib/time-ranges";

export interface RecipeValuationAdapter {
  loadValuation(recipeId: number, connectedRealmId: number): Promise<RecipeProfitResult>;
  loadHistory(recipeId: number, range: HistoryRange, connectedRealmId: number): Promise<Record<string, RecipeHistoryPoint[]>>;
}

const httpAdapter: RecipeValuationAdapter = {
  loadValuation: (recipeId, connectedRealmId) => fetchRecipeCost(recipeId, "eu", connectedRealmId),
  async loadHistory(recipeId, range, connectedRealmId) {
    const response = await fetchRecipeHistory(recipeId, range, connectedRealmId);
    return Object.fromEntries(response.scenarios.map((scenario) => [scenario.scenarioKey, scenario.points]));
  },
};

export function useRecipeValuation(
  recipeId: number,
  range: HistoryRange,
  adapter: RecipeValuationAdapter = httpAdapter,
) {
  const realm = useSelectedRealm();
  const connectedRealmId = realm.status === "ready" ? realm.selectedId : null;
  const valuationKey = connectedRealmId === null ? null : `${recipeId}:${connectedRealmId}`;
  const historyKey = valuationKey === null ? null : `${valuationKey}:${range}`;
  const [valuation, setValuation] = useState<{ key: string; data: RecipeProfitResult } | null>(null);
  const [history, setHistory] = useState<{ key: string; data: Record<string, RecipeHistoryPoint[]> } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (valuationKey === null || connectedRealmId === null) return;
    let active = true;
    void adapter
      .loadValuation(recipeId, connectedRealmId)
      .then((data) => {
        if (!active) return;
        setValuation({ key: valuationKey, data });
        setFailedKey(null);
      })
      .catch(() => active && setFailedKey(valuationKey));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, recipeId, valuationKey]);

  useEffect(() => {
    if (historyKey === null || connectedRealmId === null) return;
    let active = true;
    void adapter
      .loadHistory(recipeId, range, connectedRealmId)
      .then((data) => active && setHistory({ key: historyKey, data }))
      .catch(() => active && setHistory({ key: historyKey, data: {} }));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, historyKey, range, recipeId]);

  if (realm.status !== "ready") return { status: realm.status, recipe: null, history: {}, historyLoading: false } as const;
  if (failedKey === valuationKey && valuation?.key !== valuationKey) {
    return { status: "error", recipe: null, history: {}, historyLoading: false } as const;
  }
  if (valuation?.key !== valuationKey) return { status: "loading", recipe: null, history: {}, historyLoading: true } as const;
  return {
    status: failedKey === valuationKey ? "refresh-error" : "ready",
    recipe: valuation.data,
    history: history?.key === historyKey ? history.data : {},
    historyLoading: history?.key !== historyKey,
  } as const;
}
