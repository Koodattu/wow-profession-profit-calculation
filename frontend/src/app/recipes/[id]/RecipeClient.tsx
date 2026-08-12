"use client";

import Link from "next/link";
import {
  formatPrice,
  type RecipeHistoryPoint,
  type RecipeProfitResult,
  type RankScenario,
} from "@/lib/api";
import WowheadLink from "@/app/WowheadLink";
import { getItemQualityClass } from "@/lib/item-quality";
import TimeRangeTabs from "@/app/TimeRangeTabs";
import HistoryLineChart from "@/app/HistoryLineChart";
import type { HistoryRange } from "@/lib/time-ranges";
import { projectRecipeDetail } from "@/lib/recipe-scenario-projection";

interface Props {
  recipe: RecipeProfitResult;
  historyRange: HistoryRange;
  onHistoryRangeChange(range: HistoryRange): void;
  history: Record<string, RecipeHistoryPoint[]>;
  historyLoading: boolean;
}

export default function RecipeClient({ recipe, historyRange, onHistoryRangeChange, history, historyLoading }: Props) {
  const projectedScenarios = projectRecipeDetail(recipe, history);

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
          <TimeRangeTabs value={historyRange} onChange={onHistoryRangeChange} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {projectedScenarios.map(({ scenario, scenarioKey, label, history: scenarioHistory }) => {
          return (
            <ScenarioCard
              key={scenarioKey}
              scenario={scenario}
              title={label}
              historyData={scenarioHistory}
              historyLoading={historyLoading}
            />
          );
        })}
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  title,
  historyData,
  historyLoading,
}: {
  scenario: RankScenario;
  title: string;
  historyData: RecipeHistoryPoint[];
  historyLoading: boolean;
}) {
  const profitColor = scenario.profit !== null ? (scenario.profit >= 0 ? "text-positive" : "text-negative") : "text-muted";
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
                <td className="py-1 text-right">{formatMaybePrice(r.unitPrice)}</td>
                <td className="py-1 text-right font-medium">{formatMaybePrice(r.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={3} className="py-2 font-medium">
                Total Cost
              </td>
              <td className="py-2 text-right font-bold">{formatMaybePrice(scenario.cost.totalCost)}</td>
            </tr>
          </tfoot>
        </table>
        {scenario.cost.totalCost === null && <p className="text-xs text-negative mt-1">Some reagent prices unavailable</p>}
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
          data={historyData}
          loading={historyLoading}
        />
      </div>

    </div>
  );
}

function formatMaybePrice(value: number | null): string {
  return value === null ? "—" : formatPrice(value);
}

function ScenarioHistoryChart({
  scenario,
  data,
  loading,
}: {
  scenario: RankScenario;
  data: RecipeHistoryPoint[];
  loading: boolean;
}) {

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
