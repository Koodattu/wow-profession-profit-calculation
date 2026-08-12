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
    return <p className="text-muted">Failed to load recipe data.</p>;
  }

  if (!valuation.recipe) {
    return <p className="text-muted">No recipe data available.</p>;
  }

  return (
    <RecipeClient
      recipe={valuation.recipe}
      historyRange={historyRange}
      onHistoryRangeChange={setHistoryRange}
      history={valuation.history}
      historyLoading={valuation.historyLoading}
    />
  );
}
