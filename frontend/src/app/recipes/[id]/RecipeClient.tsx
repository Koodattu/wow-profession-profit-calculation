"use client";

import { useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { formatPrice, type RecipeProfitResult, type RankScenario } from "@/lib/api";
import { getProfessionStats, setProfessionStats, subscribeToStats, type ProfessionStats } from "@/lib/profession-stats";
import { calculateAdjustedProfit, type AdjustedProfit } from "@/lib/profit-calc";

const SERVER_STATS: ProfessionStats = { multicraftRating: 0, resourcefulnessRating: 0 };

interface Props {
  recipe: RecipeProfitResult;
}

export default function RecipeClient({ recipe }: Props) {
  const getSnapshot = useCallback(() => getProfessionStats(recipe.professionId), [recipe.professionId]);
  const getServerSnapshot = useCallback(() => SERVER_STATS, []);
  const stats = useSyncExternalStore(subscribeToStats, getSnapshot, getServerSnapshot);

  const updateStats = useCallback(
    (next: ProfessionStats) => {
      setProfessionStats(recipe.professionId, next);
    },
    [recipe.professionId],
  );

  const hasStats = stats.multicraftRating > 0 || stats.resourcefulnessRating > 0;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">{recipe.recipeName}</h1>
        <p className="text-sm text-muted">
          Quality type: {recipe.qualityTierType} &middot; {recipe.professionName}
        </p>
      </div>

      {/* Stats Editor */}
      <div className="mb-6 p-4 border border-border rounded-lg bg-card">
        <h2 className="text-sm font-semibold text-muted mb-3">Your {recipe.professionName} Stats</h2>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Multicraft Rating</span>
            <input
              type="number"
              min={0}
              max={1100}
              value={stats.multicraftRating}
              onChange={(e) => updateStats({ ...stats, multicraftRating: Math.max(0, Number(e.target.value) || 0) })}
              className="w-24 px-2 py-1 rounded bg-background border border-border text-foreground text-right"
            />
            {stats.multicraftRating > 0 && <span className="text-muted text-xs">({(Math.min(stats.multicraftRating / 1100, 1) * 100).toFixed(1)}%)</span>}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Resourcefulness Rating</span>
            <input
              type="number"
              min={0}
              max={900}
              value={stats.resourcefulnessRating}
              onChange={(e) => updateStats({ ...stats, resourcefulnessRating: Math.max(0, Number(e.target.value) || 0) })}
              className="w-24 px-2 py-1 rounded bg-background border border-border text-foreground text-right"
            />
            {stats.resourcefulnessRating > 0 && <span className="text-muted text-xs">({(Math.min(stats.resourcefulnessRating / 900, 1) * 100).toFixed(1)}%)</span>}
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {recipe.scenarios.map((scenario) => {
          const adj = hasStats
            ? calculateAdjustedProfit({
                professionName: recipe.professionName,
                stats,
                baseYield: scenario.outputQuantity,
                outputUnitPrice: scenario.outputUnitPrice,
                totalCost: scenario.cost.totalCost,
                affectedByMulticraft: recipe.affectedByMulticraft,
                affectedByResourcefulness: recipe.affectedByResourcefulness,
              })
            : null;

          return <ScenarioCard key={scenario.reagentRank} scenario={scenario} adjusted={adj} />;
        })}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, adjusted }: { scenario: RankScenario; adjusted: AdjustedProfit | null }) {
  const profitColor = scenario.profit !== null ? (scenario.profit >= 0 ? "text-positive" : "text-negative") : "text-muted";

  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <h2 className="font-semibold mb-4">Rank {scenario.reagentRank} Reagents</h2>

      {/* Reagent breakdown */}
      <div className="mb-4">
        <h3 className="text-sm text-muted mb-2">Reagents</h3>
        <table className="w-full text-sm">
          <tbody>
            {scenario.cost.reagents.map((r) => (
              <tr key={r.slotIndex} className="border-b border-border/30">
                <td className="py-1">
                  <Link href={`/items/${r.itemId}`} className="text-accent hover:underline">
                    {r.itemName}
                  </Link>
                </td>
                <td className="py-1 text-right text-muted">×{r.quantity}</td>
                <td className="py-1 text-right">{formatPrice(r.unitPrice)}</td>
                <td className="py-1 text-right font-medium">{formatPrice(r.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={3} className="py-2 font-medium">
                Total Cost
              </td>
              <td className="py-2 text-right font-bold">{formatPrice(scenario.cost.totalCost)}</td>
            </tr>
          </tfoot>
        </table>
        {!scenario.cost.hasPriceData && <p className="text-xs text-negative mt-1">Some reagent prices unavailable</p>}
      </div>

      {/* Output */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm text-muted mb-2">Output</h3>
        <div className="flex justify-between text-sm">
          <span>
            {scenario.outputItemName ? (
              <Link href={`/items/${scenario.outputItemId}`} className="text-accent hover:underline">
                {scenario.outputItemName}
              </Link>
            ) : (
              <span className="text-muted">Unknown</span>
            )}
            {scenario.outputQuantity > 1 && <span className="text-muted"> ×{scenario.outputQuantity}</span>}
          </span>
          <span>{scenario.outputTotalPrice != null ? formatPrice(scenario.outputTotalPrice) : "No price data"}</span>
        </div>
      </div>

      {/* Base Profit */}
      <div className="border-t border-border pt-4 mt-4 flex justify-between items-center">
        <span className="font-medium">Profit</span>
        <span className={`text-lg font-bold ${profitColor}`}>{scenario.profit !== null ? formatPrice(scenario.profit) : "—"}</span>
      </div>

      {/* Adjusted Profit */}
      {adjusted && (
        <div className="border-t border-border pt-4 mt-4">
          <h3 className="text-sm text-muted mb-2">With Multicraft & Resourcefulness</h3>
          <div className="space-y-1 text-sm">
            {adjusted.multicraftChance > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Multicraft ({(adjusted.multicraftChance * 100).toFixed(1)}%)</span>
                <span className="text-positive">+{adjusted.multicraftExtraPerCraft.toFixed(2)} items/craft</span>
              </div>
            )}
            {adjusted.resourcefulnessChance > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Resourcefulness ({(adjusted.resourcefulnessChance * 100).toFixed(1)}%)</span>
                <span className="text-positive">−{formatPrice(Math.round(adjusted.resourcefulnessSavingPerCraft))} cost</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-border/30">
              <span className="font-medium">Expected Profit</span>
              <span className={`text-lg font-bold ${adjusted.expectedProfit >= 0 ? "text-positive" : "text-negative"}`}>{formatPrice(Math.round(adjusted.expectedProfit))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
