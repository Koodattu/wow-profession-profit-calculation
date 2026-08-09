"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  fetchRecipeHistory,
  formatPrice,
  type RecipeHistoryPoint,
  type RecipeProfitResult,
  type RankScenario,
} from "@/lib/api";
import WowheadLink from "@/app/WowheadLink";
import { getTierStats, isTierConfigured, TOOL_TIERS, TOOL_TIER_LABELS, type ToolTier } from "@/lib/tool-tiers";
import { calculateAdjustedProfit, type AdjustedProfit } from "@/lib/profit-calc";
import { getItemQualityClass } from "@/lib/item-quality";
import TimeRangeTabs from "@/app/TimeRangeTabs";
import HistoryLineChart from "@/app/HistoryLineChart";
import type { HistoryRange } from "@/lib/time-ranges";
import { getSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";

interface Props {
  recipe: RecipeProfitResult;
}

export default function RecipeClient({ recipe }: Props) {
  const connectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("24h");
  const [history, setHistory] = useState<{
    connectedRealmId: number;
    range: HistoryRange;
    scenarios: Record<string, RecipeHistoryPoint[]>;
  } | null>(null);

  useEffect(() => {
    if (connectedRealmId === null) return;

    const realmId = connectedRealmId;
    let cancelled = false;

    void fetchRecipeHistory(recipe.recipeId, historyRange, realmId)
      .then((response) => {
        if (cancelled) return;
        setHistory({
          connectedRealmId: realmId,
          range: historyRange,
          scenarios: Object.fromEntries(response.scenarios.map((scenario) => [scenario.scenarioKey, scenario.points])),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setHistory({ connectedRealmId: realmId, range: historyRange, scenarios: {} });
      });

    return () => {
      cancelled = true;
    };
  }, [connectedRealmId, historyRange, recipe.recipeId]);

  const historyMatches =
    history?.connectedRealmId === connectedRealmId && history.range === historyRange;

  // Compute adjusted profits for all tiers with stats
  const activeTiers = TOOL_TIERS.filter((tier) => tier !== "none" && isTierConfigured(recipe.professionName, tier));

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          <a
            href={`https://www.wowhead.com/spell=${recipe.recipeId}`}
            data-wowhead={`spell=${recipe.recipeId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {recipe.recipeName}
          </a>
        </h1>
        <p className="text-sm text-muted">
          Quality type: {recipe.qualityTierType} &middot; {recipe.professionName}
        </p>
        <p className="text-xs text-muted mt-1">Gross estimates exclude auction fees and profession-stat procs; tool stats are not yet configured.</p>
      </div>

      <div className="border border-border rounded-lg bg-card p-4 mb-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm text-muted">Scenario Chart Range</h2>
          <TimeRangeTabs value={historyRange} onChange={setHistoryRange} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            if (adj && scenario.cost.hasPriceData) tierResults.push({ tier, adj });
          }

          return (
            <ScenarioCard
              key={scenario.scenarioKey}
              scenario={scenario}
              tierResults={tierResults}
              connectedRealmId={connectedRealmId}
              historyData={historyMatches ? (history.scenarios[scenario.scenarioKey] ?? []) : []}
              historyLoading={connectedRealmId !== null && !historyMatches}
            />
          );
        })}
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  tierResults,
  connectedRealmId,
  historyData,
  historyLoading,
}: {
  scenario: RankScenario;
  tierResults: { tier: ToolTier; adj: AdjustedProfit }[];
  connectedRealmId: number | null;
  historyData: RecipeHistoryPoint[];
  historyLoading: boolean;
}) {
  const profitColor = scenario.profit !== null ? (scenario.profit >= 0 ? "text-positive" : "text-negative") : "text-muted";
  const title = scenario.scenarioLabel ?? (scenario.reagentRank === 1 && scenario.outputRank === 2 ? "Conc R1→R2" : `Rank ${scenario.reagentRank} Reagents`);

  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <h2 className="font-semibold mb-4">{title}</h2>

      {/* Reagent breakdown */}
      <div className="mb-4">
        <h3 className="text-sm text-muted mb-2">Reagents</h3>
        <table className="w-full text-sm">
          <tbody>
            {scenario.cost.reagents.map((r) => (
              <tr key={r.slotIndex} className="border-b border-border/30">
                <td className="py-1">
                  <WowheadLink href={`/items/${r.itemId}`} type="item" id={r.itemId} className={`${getItemQualityClass(r.itemQuality)} hover:underline`}>
                    {r.itemName}
                  </WowheadLink>
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
        {(scenario.outputVariantCount ?? 0) > 1 && (
          <p className="text-xs text-muted mt-1">Output price is the lowest listing across {scenario.outputVariantCount} auction variants.</p>
        )}
      </div>

      {/* Output */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm text-muted mb-2">Output</h3>
        <div className="flex justify-between text-sm">
          <span>
            {scenario.outputItemName ? (
              <WowheadLink
                href={`/items/${scenario.outputItemId}`}
                type="item"
                id={scenario.outputItemId!}
                className={`${getItemQualityClass(scenario.outputItemQuality)} hover:underline`}
              >
                {scenario.outputItemName}
              </WowheadLink>
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
        <span className="font-medium">Gross Profit Estimate</span>
        <span className={`text-lg font-bold ${profitColor}`}>{scenario.profit !== null ? formatPrice(scenario.profit) : "—"}</span>
      </div>

      <div className="border-t border-border pt-4 mt-4">
        <ScenarioHistoryChart
          scenario={scenario}
          connectedRealmId={connectedRealmId}
          data={historyData}
          loading={historyLoading}
        />
      </div>

      {/* Tier comparison */}
      {tierResults.length > 0 && (
        <div className="border-t border-border pt-4 mt-4">
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

function ScenarioHistoryChart({
  scenario,
  connectedRealmId,
  data,
  loading,
}: {
  scenario: RankScenario;
  connectedRealmId: number | null;
  data: RecipeHistoryPoint[];
  loading: boolean;
}) {

  if (connectedRealmId === null) {
    return <p className="text-xs text-muted">Select a realm to view scenario history.</p>;
  }

  if (!scenario.outputItemId) {
    return <p className="text-xs text-muted">Not enough data points for this scenario.</p>;
  }

  if (loading) {
    return <p className="text-xs text-muted">Loading scenario history...</p>;
  }

  if (data.length <= 1) {
    return <p className="text-xs text-muted">Not enough data points for this scenario.</p>;
  }

  return (
    <HistoryLineChart
      title="Cost vs Output History"
      data={data}
      series={[
        { key: "cost", label: "Crafted Cost", color: "var(--negative)" },
        { key: "output", label: "Output Value", color: "var(--positive)" },
        {
          key: "outputQuantity",
          label: "Output Quantity",
          color: "#3da3d4",
          axis: "right",
          type: "bar",
          formatValue: (value) => Math.round(value).toLocaleString(),
        },
      ]}
      formatValue={formatPrice}
    />
  );
}
