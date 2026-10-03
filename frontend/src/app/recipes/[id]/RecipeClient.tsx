"use client";

import Link from "next/link";
import { useState } from "react";
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
import HistoryRecords from "@/app/HistoryRecords";
import HistoryLink from "@/app/HistoryLink";
import { formatHistoryTime, isDailyHistoryRange, type HistoryRange } from "@/lib/time-ranges";
import { useSelectedRealm } from "@/lib/selected-realm";
import { projectRecipeDetail } from "@/lib/recipe-scenario-projection";
import { craftPlan, useCraftPlan, validCraftCount, MAX_CRAFTS } from "@/lib/craft-plan";

interface Props {
  recipe: RecipeProfitResult;
  returnTo?: string;
  historyRange: HistoryRange;
  onHistoryRangeChange(range: HistoryRange): void;
  history: Record<string, RecipeHistoryPoint[]>;
  historyLoading: boolean;
  historyFailed: boolean;
  onRetryHistory(): void;
}

export default function RecipeClient({ recipe, returnTo, historyRange, onHistoryRangeChange, history, historyLoading, historyFailed, onRetryHistory }: Props) {
  const projectedScenarios = projectRecipeDetail(recipe, history);
  const realm = useSelectedRealm();
  const realmId = realm.status === "ready" ? realm.selectedId : null;
  const plan = useCraftPlan();
  const [crafts, setCrafts] = useState("1");
  const [message, setMessage] = useState("");
  const [planError, setPlanError] = useState("");
  const count = Number(crafts);
  const valid = validCraftCount(count);
  const professionPath = `/professions/${recipe.professionId}`;
  const backHref = returnTo?.split("?")[0] === professionPath ? returnTo : professionPath;

  function addScenario(scenarioKey: string, label: string) {
    const error = craftPlan.add({ recipeId: recipe.recipeId, scenarioKey, crafts: count });
    setPlanError(error ?? "");
    setMessage(error ? "" : `Added ${count.toLocaleString()} crafts of ${recipe.recipeName} (${label}).`);
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={backHref} className="text-sm text-muted hover:text-accent transition-colors">
          &larr; {recipe.professionName}
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
          {recipe.professionName} &middot; Prices and quantities below are per craft.
        </p>
        <p className="text-sm text-muted mt-2">Gross estimates exclude auction fees and profession-stat procs. Check the required skill and concentration in game.</p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4 border-y border-border py-4">
        <label className="text-sm text-muted">Crafts to add
          <input type="number" min={1} max={MAX_CRAFTS} step={1} value={crafts}
            onChange={(event) => { setCrafts(event.target.value); setMessage(""); }}
            aria-invalid={!valid} aria-describedby={!valid ? "craft-count-error" : undefined}
            className="mt-1 block min-h-11 w-32 rounded-lg border border-border bg-card px-3 text-base text-foreground" />
        </label>
        <p className="max-w-sm pb-2 text-sm text-muted">Choose a scenario below to save its materials in your plan.</p>
        <Link href="/craft-plan" className="inline-flex min-h-11 items-center text-accent hover:underline sm:ml-auto">View craft plan{plan.entries.length ? ` (${plan.entries.length})` : ""} →</Link>
        {!valid && <p id="craft-count-error" className="w-full text-sm text-negative">Enter a whole number from 1 to 10,000.</p>}
        {message && <p role="status" className="w-full text-sm text-positive">{message}</p>}
        {planError && <p role="alert" className="w-full text-sm text-negative">{planError}</p>}
        {plan.storage !== "saved" && <p className="w-full text-sm text-negative">{plan.storage === "session" ? "Browser storage is unavailable. Your plan lasts only for this session." : "The saved plan could not be read. Adding a recipe starts a new plan."}</p>}
      </div>

      <div className="border border-border rounded-lg bg-card p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Scenario history · {realm.options.find((option) => option.id === realmId)?.label ?? "Selected realm"}</h2>
          <TimeRangeTabs value={historyRange} onChange={onHistoryRangeChange} />
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <details className="max-w-2xl text-xs leading-relaxed text-muted">
            <summary className="min-h-11 cursor-pointer py-3">How historical estimates are calculated</summary>
            <p>Cost and output value are per craft, using each item’s last known lowest quote. Quotes are carried forward between item observations until an explicit unavailable value. Daily estimates combine each item’s daily low; those lows may occur at different times. Supply is output items listed for sale, not the number produced by a craft. Auction fees and profession-stat procs are excluded.</p>
          </details>
          <HistoryLink connectedRealmId={realmId} />
        </div>
        {historyFailed && <div className="mt-3 text-sm" role="alert"><p className="text-muted">Couldn’t load price history. Current recipe prices are still available.</p><button type="button" onClick={onRetryHistory} className="mt-2 min-h-11 rounded-lg border border-border px-4 text-accent">Retry history</button></div>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {projectedScenarios.map(({ scenario, scenarioKey, label, history: scenarioHistory }) => {
          return (
            <ScenarioCard
              key={scenarioKey}
              scenario={scenario}
              title={label}
              historyData={scenarioHistory}
              historyRange={historyRange}
              historyLoading={historyLoading}
              historyFailed={historyFailed}
              crafts={valid ? count : null}
              canAdd={plan.ready && valid}
              onAdd={() => addScenario(scenarioKey, label)}
              recipeId={recipe.recipeId}
              scenarioKey={scenarioKey}
              realmId={realmId}
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
  historyRange,
  historyLoading,
  historyFailed,
  crafts,
  canAdd,
  onAdd,
  recipeId,
  scenarioKey,
  realmId,
}: {
  scenario: RankScenario;
  title: string;
  historyData: RecipeHistoryPoint[];
  historyRange: HistoryRange;
  historyLoading: boolean;
  historyFailed: boolean;
  crafts: number | null;
  canAdd: boolean;
  onAdd(): void;
  recipeId: number;
  scenarioKey: string;
  realmId: number | null;
}) {
  const profitColor = scenario.profit !== null ? (scenario.profit >= 0 ? "text-positive" : "text-negative") : "text-muted";
  return (
    <div className="min-w-0 border border-border rounded-lg bg-card p-4">
      <h2 className="font-semibold mb-4">{title}</h2>
      <div className="mb-4 border-b border-border pb-4">
        <button type="button" onClick={onAdd} disabled={!canAdd} aria-label={`Add ${title} to plan`}
          className="min-h-11 w-full rounded-lg bg-accent px-4 font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
          Add {crafts?.toLocaleString() ?? ""} {crafts === 1 ? "craft" : "crafts"} to plan
        </button>
        {crafts !== null && <p className="mt-2 text-sm text-muted">At least {(crafts * scenario.outputQuantity).toLocaleString()} output items · {formatMaybePrice(scenario.cost.totalCost === null ? null : scenario.cost.totalCost * crafts)} material cost</p>}
      </div>

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

      {!historyFailed && <div className="border-t border-border pt-4 mt-4">
        <ScenarioHistoryChart
          scenario={scenario}
          data={historyData}
          range={historyRange}
          loading={historyLoading}
        />
        {!historyLoading && <HistoryRecords key={historyRange} range={historyRange}
          rows={historyData.map((point) => ({ ...point }))}
          filename={`copper-recipe-${recipeId}-${scenarioKey.replaceAll(":", "-")}-${realmId}-${historyRange}`}
          label={`${title} observations`} context={{ recipe_id: recipeId, scenario: scenarioKey, region: "eu", connected_realm_id: realmId ?? "", range: historyRange, valuation_method: "last_known_item_lows" }}
          columns={[
            { key: "cost", label: "Cost / craft", csvLabel: "cost_per_craft_copper", format: (value) => formatPrice(Number(value)) },
            { key: "output", label: "Output / craft", csvLabel: "output_per_craft_copper", format: (value) => formatPrice(Number(value)) },
            { key: "outputQuantity", label: isDailyHistoryRange(historyRange) ? "Average units listed" : "Output units listed", csvLabel: isDailyHistoryRange(historyRange) ? "average_output_units_listed" : "output_units_listed" },
          ]} />}
      </div>}

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
  range,
}: {
  scenario: RankScenario;
  data: RecipeHistoryPoint[];
  loading: boolean;
  range: HistoryRange;
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
    <>
    <p className="mb-4 text-xs leading-relaxed text-muted">{data.length.toLocaleString()} {isDailyHistoryRange(range) ? "daily" : "hourly"} estimates · {formatHistoryTime(data[0].time, range)} to {formatHistoryTime(data[data.length - 1].time, range)}.
      {isDailyHistoryRange(range) ? " Daily dates are UTC." : ` Times: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}</p>
    <HistoryLineChart
      range={range}
      title="Cost and output value · per craft"
      data={data}
      series={[
        { key: "cost", label: "Material cost", color: "var(--negative)", dash: "5 4" },
        { key: "output", label: "Output value", color: "var(--positive)" },
      ]}
      formatValue={formatPrice}
    />
    <div className="mt-4">
      <HistoryLineChart range={range} title={isDailyHistoryRange(range) ? "Output supply · average units listed" : "Output supply · units listed"}
        data={data} series={[{ key: "outputQuantity", label: "Listed supply", color: "var(--chart-secondary)", type: "bar" }]}
        formatValue={(value) => Math.round(value).toLocaleString()} compact />
    </div>
    </>
  );
}
