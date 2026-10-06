import { useEffect, useState } from "react";
import {
  ApiError,
  fetchRecipeCost,
  fetchRecipeHistory,
  type RecipeHistoryPoint,
  type RecipeProfitResult,
} from "@/lib/api";
import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";
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
  const [failure, setFailure] = useState<{ key: string; notFound: boolean } | null>(null);
  const [failedHistoryKey, setFailedHistoryKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  function retry() {
    if (realm.status === "error") { void selectedRealm.retry(); return; }
    setFailure(null);
    setAttempt((value) => value + 1);
  }
  function retryHistory() {
    setFailedHistoryKey(null);
    setHistoryAttempt((value) => value + 1);
  }
  const controls = { retry, retryHistory, historyFailed: historyKey !== null && failedHistoryKey === historyKey };

  useEffect(() => {
    if (valuationKey === null || connectedRealmId === null) return;
    let active = true;
    void adapter
      .loadValuation(recipeId, connectedRealmId)
      .then((data) => {
        if (!active) return;
        setValuation({ key: valuationKey, data });
        setFailure(null);
      })
      .catch((error: unknown) => active && setFailure({ key: valuationKey, notFound: error instanceof ApiError && error.status === 404 }));
    return () => {
      active = false;
    };
  }, [adapter, attempt, connectedRealmId, recipeId, valuationKey]);

  useEffect(() => {
    if (historyKey === null || connectedRealmId === null) return;
    let active = true;
    void adapter
      .loadHistory(recipeId, range, connectedRealmId)
      .then((data) => {
        if (!active) return;
        setHistory({ key: historyKey, data });
        setFailedHistoryKey(null);
      })
      .catch(() => active && setFailedHistoryKey(historyKey));
    return () => {
      active = false;
    };
  }, [adapter, connectedRealmId, historyAttempt, historyKey, range, recipeId]);

  if (realm.status !== "ready") return { ...controls, status: realm.status, recipe: null, history: {}, historyLoading: false } as const;
  if (failure?.key === valuationKey && failure.notFound) {
    return { ...controls, status: "not-found", recipe: null, history: {}, historyLoading: false } as const;
  }
  if (failure?.key === valuationKey && valuation?.key !== valuationKey) {
    return { ...controls, status: "error", recipe: null, history: {}, historyLoading: false } as const;
  }
  if (valuation?.key !== valuationKey) return { ...controls, status: "loading", recipe: null, history: {}, historyLoading: true } as const;
  return {
    ...controls,
    status: failure?.key === valuationKey ? "refresh-error" : "ready",
    recipe: valuation.data,
    history: history?.key === historyKey ? history.data : {},
    historyLoading: history?.key !== historyKey && !controls.historyFailed,
  } as const;
}
