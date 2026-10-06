"use client";

import { useRecipeValuation } from "@/features/recipe-valuation";
import type { HistoryRange } from "@/lib/time-ranges";
import { updateHistoryQuery, useHistoryRange, useLinkedHistoryRealm } from "@/lib/history-view";
import RecipeClient from "./RecipeClient";
import NotFound from "@/app/not-found";

interface Props {
  recipeId: number;
  returnTo?: string;
}

export default function RecipeDetailClient({ recipeId, returnTo }: Props) {
  const linked = useLinkedHistoryRealm(true);
  const { range, setRange } = useHistoryRange(true);
  if (linked.pending) return <p role="status" className="text-muted">Loading the linked realm…</p>;
  if (linked.invalid) return <div className="text-muted"><p>The realm in this link is unavailable. Choose a realm in the navigation to continue.</p>
    {linked.realm.status === "ready" && <button type="button" onClick={() => updateHistoryQuery({ realm: null })} className="min-h-11 px-2 text-accent underline">Use selected realm</button>}
  </div>;
  return <RecipeDetailContent recipeId={recipeId} returnTo={returnTo} historyRange={range} setHistoryRange={setRange} />;
}

function RecipeDetailContent({ recipeId, returnTo, historyRange, setHistoryRange }: Props & {
  historyRange: HistoryRange;
  setHistoryRange(range: HistoryRange): void;
}) {
  const valuation = useRecipeValuation(recipeId, historyRange);

  if (valuation.status === "not-found") return <NotFound />;

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
        returnTo={returnTo}
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
