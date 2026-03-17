"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { fetchItem, fetchItemPrices, formatPrice, type RecipeProfitResult, type RankScenario, type PricePoint } from "@/lib/api";
import WowheadLink from "@/app/WowheadLink";
import { getTierStats, TOOL_TIERS, TOOL_TIER_LABELS, type ToolTier } from "@/lib/tool-tiers";
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

  // Compute adjusted profits for all tiers with stats
  const activeTiers = TOOL_TIERS.filter((t) => t !== "none");

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
            if (adj) tierResults.push({ tier, adj });
          }

          return (
            <ScenarioCard
              key={`${scenario.reagentRank}-${scenario.outputRank}-${scenario.inputItemId ?? "none"}`}
              scenario={scenario}
              tierResults={tierResults}
              connectedRealmId={connectedRealmId}
              historyRange={historyRange}
            />
          );
        })}
      </div>
    </div>
  );
}

async function buildRecipeHistory(
  scenario: RankScenario,
  range: HistoryRange,
  connectedRealmId: number,
): Promise<Array<{ time: string; cost: number | null; output: number | null; outputQuantity: number | null }>> {
  if (!scenario.outputItemId) return [];

  const outputItem = await fetchItem(scenario.outputItemId);
  const outputUsesRealm = outputItem.isCraftedOutput && !outputItem.isReagent;

  const reagentItems = scenario.cost.reagents.map((reagent) => ({ itemId: reagent.itemId, quantity: reagent.quantity }));
  const itemIds = [...new Set([scenario.outputItemId, ...reagentItems.map((reagent) => reagent.itemId)])];

  const historyPairs = await Promise.all(
    itemIds.map(async (itemId) => {
      const isOutput = itemId === scenario.outputItemId;
      const series = await fetchItemPrices(itemId, "eu", range, isOutput && outputUsesRealm ? { type: "realm", connectedRealmId } : { type: "auto" });
      return [itemId, [...series].reverse()] as const;
    }),
  );

  const historyMap = new Map<number, PricePoint[]>(historyPairs);
  const timelineMs = [
    ...new Set([...historyMap.values()].flatMap((series) => series.map((point) => new Date(point.time).getTime()).filter((value) => Number.isFinite(value)))),
  ].sort((a, b) => a - b);

  if (timelineMs.length === 0) return [];

  const filledPricesByItem = new Map<number, Array<number | null>>();

  for (const [itemId, series] of historyMap) {
    const values: Array<number | null> = new Array(timelineMs.length).fill(null);
    let pointer = 0;
    let lastValue: number | null = null;

    for (let i = 0; i < timelineMs.length; i += 1) {
      const bucketTime = timelineMs[i];
      while (pointer < series.length) {
        const pointTime = new Date(series[pointer].time).getTime();
        if (pointTime > bucketTime) break;
        const nextValue = series[pointer].min_price;
        if (nextValue != null) lastValue = nextValue;
        pointer += 1;
      }
      values[i] = lastValue;
    }

    filledPricesByItem.set(itemId, values);
  }

  const outputSeries = historyMap.get(scenario.outputItemId) ?? [];
  const outputQuantityByTime = new Map<number, number | null>();
  let outputPointer = 0;
  let lastQuantity: number | null = null;

  for (const bucketTime of timelineMs) {
    while (outputPointer < outputSeries.length) {
      const pointTime = new Date(outputSeries[outputPointer].time).getTime();
      if (pointTime > bucketTime) break;
      const nextQuantity = outputSeries[outputPointer].total_quantity;
      if (nextQuantity != null) lastQuantity = nextQuantity;
      outputPointer += 1;
    }
    outputQuantityByTime.set(bucketTime, lastQuantity);
  }

  const points: Array<{ time: string; cost: number | null; output: number | null; outputQuantity: number | null }> = [];

  for (let i = 0; i < timelineMs.length; i += 1) {
    let totalCost = 0;
    let hasCost = true;

    for (const reagent of reagentItems) {
      const reagentPrice = filledPricesByItem.get(reagent.itemId)?.[i] ?? null;
      if (reagentPrice == null) {
        hasCost = false;
        break;
      }
      totalCost += reagentPrice * reagent.quantity;
    }

    const outputPrice = filledPricesByItem.get(scenario.outputItemId)?.[i] ?? null;

    points.push({
      time: new Date(timelineMs[i]).toISOString(),
      cost: hasCost ? Math.round(totalCost) : null,
      output: outputPrice != null ? Math.round(outputPrice * scenario.outputQuantity) : null,
      outputQuantity: outputQuantityByTime.get(timelineMs[i]) ?? null,
    });
  }

  return points;
}

function ScenarioCard({
  scenario,
  tierResults,
  connectedRealmId,
  historyRange,
}: {
  scenario: RankScenario;
  tierResults: { tier: ToolTier; adj: AdjustedProfit }[];
  connectedRealmId: number | null;
  historyRange: HistoryRange;
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
        <span className="font-medium">Base Profit</span>
        <span className={`text-lg font-bold ${profitColor}`}>{scenario.profit !== null ? formatPrice(scenario.profit) : "—"}</span>
      </div>

      <div className="border-t border-border pt-4 mt-4">
        <ScenarioHistoryChart scenario={scenario} connectedRealmId={connectedRealmId} range={historyRange} />
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

function ScenarioHistoryChart({ scenario, connectedRealmId, range }: { scenario: RankScenario; connectedRealmId: number | null; range: HistoryRange }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Array<{ time: string; cost: number | null; output: number | null; outputQuantity: number | null }>>([]);

  useEffect(() => {
    if (!scenario.outputItemId || connectedRealmId === null) {
      setData([]);
      return;
    }

    const realmId = connectedRealmId;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const nextData = await buildRecipeHistory(scenario, range, realmId);
        if (!cancelled) {
          setData(nextData);
        }
      } catch {
        if (!cancelled) {
          setData([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [connectedRealmId, range, scenario]);

  if (connectedRealmId === null) {
    return <p className="text-xs text-muted">Select a realm to view scenario history.</p>;
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
