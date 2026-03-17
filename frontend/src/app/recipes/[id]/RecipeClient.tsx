"use client";

import Link from "next/link";
import { formatPrice, type RecipeProfitResult, type RankScenario } from "@/lib/api";
import { getTierStats, TOOL_TIERS, TOOL_TIER_LABELS, type ToolTier } from "@/lib/tool-tiers";
import { calculateAdjustedProfit, type AdjustedProfit } from "@/lib/profit-calc";

interface Props {
  recipe: RecipeProfitResult;
}

export default function RecipeClient({ recipe }: Props) {
  // Compute adjusted profits for all tiers with stats
  const activeTiers = TOOL_TIERS.filter((t) => t !== "none");

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">{recipe.recipeName}</h1>
        <p className="text-sm text-muted">
          Quality type: {recipe.qualityTierType} &middot; {recipe.professionName}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {recipe.scenarios.map((scenario) => {
          const tierResults: { tier: ToolTier; adj: AdjustedProfit }[] = [];
          for (const tier of activeTiers) {
            const tierStats = getTierStats(recipe.professionName, tier);
            const adj = calculateAdjustedProfit({
              tierStats,
              baseYield: scenario.outputQuantity,
              outputUnitPrice: scenario.outputUnitPrice,
              totalCost: scenario.cost.totalCost,
              affectedByMulticraft: recipe.affectedByMulticraft,
              affectedByResourcefulness: recipe.affectedByResourcefulness,
            });
            if (adj) tierResults.push({ tier, adj });
          }

          return <ScenarioCard key={scenario.reagentRank} scenario={scenario} tierResults={tierResults} />;
        })}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, tierResults }: { scenario: RankScenario; tierResults: { tier: ToolTier; adj: AdjustedProfit }[] }) {
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
        <span className="font-medium">Base Profit</span>
        <span className={`text-lg font-bold ${profitColor}`}>{scenario.profit !== null ? formatPrice(scenario.profit) : "—"}</span>
      </div>

      {/* Tier comparison */}
      {tierResults.length > 0 && (
        <div className="border-t border-border pt-4 mt-4">
          <h3 className="text-sm text-muted mb-3">Expected Profit by Tool Tier</h3>
          <div className="space-y-3">
            {tierResults.map(({ tier, adj }) => {
              const hasEffect = adj.multicraftChance > 0 || adj.resourcefulnessChance > 0;
              if (!hasEffect) return null;

              return (
                <div key={tier} className="text-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium">{TOOL_TIER_LABELS[tier]}</span>
                    <span className={`font-bold ${adj.expectedProfit >= 0 ? "text-positive" : "text-negative"}`}>{formatPrice(Math.round(adj.expectedProfit))}</span>
                  </div>
                  <div className="flex gap-4 text-xs text-muted">
                    {adj.multicraftChance > 0 && (
                      <span>
                        MC {(adj.multicraftChance * 100).toFixed(1)}% (+{adj.multicraftExtraPerCraft.toFixed(2)}/craft)
                      </span>
                    )}
                    {adj.resourcefulnessChance > 0 && (
                      <span>
                        Res {(adj.resourcefulnessChance * 100).toFixed(1)}% (−{formatPrice(Math.round(adj.resourcefulnessSavingPerCraft))})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
