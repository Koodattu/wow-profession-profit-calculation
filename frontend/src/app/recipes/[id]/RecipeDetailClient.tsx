"use client";

import { useState } from "react";
import { useRecipeValuation } from "@/features/recipe-valuation";
import type { HistoryRange } from "@/lib/time-ranges";
import RecipeClient from "./RecipeClient";

interface Props {
  recipeId: number;
}

export default function RecipeDetailClient({ recipeId }: Props) {
  const [historyRange, setHistoryRange] = useState<HistoryRange>("24h");
  const valuation = useRecipeValuation(recipeId, historyRange);

  if (valuation.status === "loading") {
    return <p className="text-muted">Loading recipe prices...</p>;
  }

  if (valuation.status === "selection-required") {
    return <p className="text-muted">Select a realm to value this recipe.</p>;
  }

  if (!valuation.recipe && valuation.status === "error") {
    return <div role="alert"><p className="text-muted">Couldn’t load recipe prices.</p><button type="button" onClick={valuation.retry} className="mt-3 min-h-11 rounded-lg border border-border px-4 text-accent">Retry recipe</button></div>;
  }

  if (!valuation.recipe) {
    return <p className="text-muted">No recipe data available.</p>;
  }

  return (
    <>
      {valuation.status === "refresh-error" && (
        <div className="mb-4 text-sm text-muted" role="alert">
          <p>Couldn’t refresh recipe prices. Showing the last loaded prices.</p>
          <button type="button" onClick={valuation.retry} className="min-h-11 px-2 text-accent underline">Retry recipe</button>
        </div>
      )}
      <RecipeClient
        recipe={valuation.recipe}
        historyRange={historyRange}
        onHistoryRangeChange={setHistoryRange}
        history={valuation.history}
        historyLoading={valuation.historyLoading}
        historyFailed={valuation.historyFailed}
        onRetryHistory={valuation.retryHistory}
      />
    </>
  );
}
