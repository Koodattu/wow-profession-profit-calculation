"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { craftPlan, planEntryKey, useCraftPlan, validCraftCount, MAX_CRAFTS, type CraftPlanEntry } from "@/lib/craft-plan";
import { formatPrice } from "@/lib/api";
import { usePlanPrices, valueCraftPlan } from "@/features/craft-plan";
import WowheadLink from "@/app/WowheadLink";
import { NORMAL_SCENARIOS } from "@/lib/recipe-scenario-projection";

const buttonClass = "min-h-11 rounded-lg border border-border px-4 text-sm text-accent hover:bg-card-hover disabled:opacity-50";

export default function CraftPlanClient() {
  const plan = useCraftPlan();
  const prices = usePlanPrices(plan.entries);
  const valuation = valueCraftPlan(plan.entries, prices.recipes ?? []);
  const [removed, setRemoved] = useState<CraftPlanEntry | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const recipesHeading = useRef<HTMLHeadingElement>(null);
  const previousRemoval = useRef<CraftPlanEntry | null>(null);
  const [actionError, setActionError] = useState("");
  const [copy, setCopy] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (removed) undoButton.current?.focus();
    else if (previousRemoval.current) recipesHeading.current?.focus();
    previousRemoval.current = removed;
  }, [removed]);
  const realmName = prices.realm.options.find((option) => option.id === prices.realm.selectedId)?.label;
  const shoppingText = [
    "Copper craft plan — shopping list",
    `Realm: ${realmName ?? "not selected"} · EU commodities`,
    ...valuation.materials.map((material) => `${material.quantity} × ${material.itemName} (item ${material.itemId})`),
    "Full material requirements; owned inventory is not deducted.",
  ].join("\n");

  async function copyList() {
    try { await navigator.clipboard.writeText(shoppingText); setCopy({ text: shoppingText, ok: true }); }
    catch { setCopy({ text: shoppingText, ok: false }); }
  }

  function remove(entry: CraftPlanEntry) {
    craftPlan.remove(planEntryKey(entry));
    setRemoved(entry);
    setActionError("");
  }

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Craft plan</h1>
        <p className="mt-2 text-base leading-7 text-muted">Keep your recipe choices together and prepare their materials. Saved in this browser.</p>
        {plan.entries.length > 0 && <nav aria-label="Craft plan sections" className="mt-3 flex flex-wrap gap-x-6 xl:hidden">
          <a href="#plan-recipes" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">Recipes ↓</a>
          <a href="#plan-shopping" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">Shopping list ↓</a>
        </nav>}
      </div>
      <Link href="/professions" className="inline-flex min-h-11 items-center text-accent hover:underline">Add recipes →</Link>
    </div>

    {plan.storage !== "saved" && <p role="alert" className="mt-4 text-negative">{plan.storage === "session"
      ? "Browser storage is unavailable. Your plan lasts only for this session."
      : "The saved plan could not be read. Adding a recipe starts a new plan."}</p>}
    {removed && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm" role="status">
      <span>Removed one recipe choice.</span>
      <button ref={undoButton} type="button" className={buttonClass} onClick={() => {
        const error = craftPlan.add(removed);
        setActionError(error ?? "");
        if (!error) setRemoved(null);
      }}>Undo remove</button>
    </div>}
    {actionError && <p role="alert" className="mt-2 text-negative">{actionError}</p>}

    {!plan.ready ? <p className="mt-8 text-muted" role="status">Loading your plan…</p>
      : plan.entries.length === 0 ? <section className="my-12 max-w-lg">
        <h2 className="text-xl font-semibold">Start with a recipe</h2>
        <p className="mt-3 leading-7 text-muted">Browse your profession, open a recipe, then add a scenario and craft count. Copper combines shared reagents into one shopping list.</p>
        <Link href="/professions" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-accent px-5 font-semibold text-background hover:bg-accent-hover">Browse professions</Link>
      </section> : <>
        <div className="my-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="text-sm text-muted">
            <p>{realmName ? `Realm prices: ${realmName}. Commodities use EU prices.` : "Select a realm above to price this plan."}</p>
            {prices.loadedAt && <p>Quotes loaded at {prices.loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Auction data may be delayed.</p>}
          </div>
          <button type="button" className={buttonClass} onClick={prices.refresh} disabled={prices.loading || prices.realm.status === "selection-required"}>
            {prices.loading ? "Loading prices…" : prices.failed ? "Retry prices" : "Refresh prices"}
          </button>
        </div>
        {prices.failed && <p role="alert" className="mb-4 text-negative">{prices.recipes
          ? "Couldn’t refresh prices. Showing the last loaded quotes; your choices are saved."
          : "Couldn’t load prices. Your choices are saved; retry when the connection returns."}</p>}

        <dl aria-label="Plan totals" className="mb-4 grid gap-3 border-b border-border pb-6 sm:grid-cols-3 sm:gap-6">
          <Total label="Material cost" value={prices.recipes ? valuation.cost : null} />
          <Total label="Output value" value={prices.recipes ? valuation.output : null} />
          <Total label="Gross profit estimate" value={prices.recipes ? valuation.profit : null} profit />
        </dl>
        <p className="mb-8 max-w-3xl text-sm leading-6 text-muted">Estimates use minimum output quantities and current lowest listings. Auction fees, concentration costs and profession-stat procs are excluded. Check crafting requirements in game.</p>
        {prices.recipes && (valuation.cost === null || valuation.output === null) && <p className="mb-6 text-sm text-negative">Some prices or recipe choices are unavailable. Affected totals stay unavailable rather than showing a partial estimate.</p>}

        <div className="grid items-start gap-10 xl:grid-cols-2 xl:gap-12">
          <section aria-labelledby="plan-recipes">
            <h2 ref={recipesHeading} id="plan-recipes" tabIndex={-1} className="scroll-mt-6 text-xl font-semibold sm:scroll-mt-32">Recipes</h2>
            <p className="mt-1 text-sm text-muted">{plan.entries.length} {plan.entries.length === 1 ? "choice" : "choices"} · {plan.entries.reduce((sum, entry) => sum + entry.crafts, 0).toLocaleString()} crafts</p>
            <p className="mt-1 text-sm text-muted">Estimates below cover each choice’s full craft count.</p>
            <ol className="mt-2 divide-y divide-border">
              {valuation.rows.map(({ entry, recipe, choice, cost, output, profit }) => {
                const key = planEntryKey(entry);
                const name = recipe?.recipeName ?? `Recipe ${entry.recipeId}`;
                const label = choice?.label ?? NORMAL_SCENARIOS.find((scenario) => scenario.scenarioKey === entry.scenarioKey)?.label ?? "Salvage input";
                return <li key={key} className="py-4">
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div className="min-w-0 flex-1">
                      <Link href={`/recipes/${entry.recipeId}?from=${encodeURIComponent("/craft-plan#plan-recipes")}`} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">{name}</Link>
                      <p className="text-sm text-muted">{label}</p>
                      {choice ? <p className="mt-2 text-sm text-muted">{entry.crafts.toLocaleString()} crafts × {choice.scenario.outputQuantity} items = at least {(entry.crafts * choice.scenario.outputQuantity).toLocaleString()} output items</p>
                        : <p className="mt-2 text-sm text-muted">{prices.recipes ? "This recipe or scenario is no longer available. Remove it or choose a new scenario." : "Waiting for recipe details and prices."}</p>}
                    </div>
                    <div className="flex max-w-full shrink-0 flex-wrap items-end gap-1">
                      <QuantityInput crafts={entry.crafts} label={`Crafts for ${name} (${label})`} onChange={(count) => craftPlan.update(key, count)} />
                      <button type="button" aria-label={`Remove ${name} (${label})`} className="min-h-11 px-3 text-sm text-muted hover:text-negative" onClick={() => remove(entry)}>Remove</button>
                    </div>
                  </div>
                  <dl aria-label={`${name} (${label}) estimates`} className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-3">
                    <Total label="Material cost" value={cost} compact />
                    <Total label="Output value" value={output} compact />
                    <Total label="Gross profit" value={profit} compact profit />
                  </dl>
                </li>;
              })}
            </ol>
          </section>

          <section aria-labelledby="plan-shopping">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 id="plan-shopping" tabIndex={-1} className="scroll-mt-6 text-xl font-semibold sm:scroll-mt-32">Shopping list</h2><p className="mt-1 text-sm text-muted">Combined across your recipes</p></div>
              <button type="button" className={buttonClass} onClick={copyList} disabled={!prices.recipes || valuation.incompleteChoices > 0 || valuation.materials.length === 0}>Copy list</button>
            </div>
            {prices.recipes && valuation.incompleteChoices > 0 && <p className="mt-4 text-sm text-negative">Incomplete list: {valuation.incompleteChoices} recipe choices have unavailable or incomplete material requirements. Remove or replace them before copying.</p>}
            <ul aria-label="Combined reagents" className="mt-2 divide-y divide-border">
              {valuation.materials.map((material) => <li key={material.itemId} className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 basis-40">
                  <WowheadLink type="item" id={material.itemId} href={`/items/${material.itemId}?from=${encodeURIComponent("/craft-plan#plan-shopping")}`} className="inline-flex min-h-11 items-center text-accent hover:underline">{material.itemName}</WowheadLink>
                  <p className="text-xs text-muted">Item {material.itemId}</p>
                </div>
                <div className="shrink-0 py-2 text-right tabular-nums">
                  <p>{material.quantity.toLocaleString()} needed</p>
                  <p className="mt-1 text-sm text-muted"><span className="sr-only">Estimated cost: </span>{material.totalPrice === null ? "Price unavailable" : formatPrice(material.totalPrice)}</p>
                </div>
              </li>)}
            </ul>
            {!prices.recipes && <p className="my-6 text-muted">Your combined materials will appear when recipe details load.</p>}
            <p className="mt-4 text-sm leading-6 text-muted">Full material requirements; owned inventory is not deducted. Item IDs distinguish reagents with the same name. Lowest listings may not cover the whole quantity at that price.</p>
            {copy?.text === shoppingText && <div className="mt-4">
              <p role="status" className="text-sm text-accent">{copy.ok ? "Shopping list copied." : "Copy wasn’t available. Select and copy the text below."}</p>
              {!copy.ok && <textarea aria-label="Shopping list text" readOnly value={shoppingText} onFocus={(event) => event.target.select()}
                className="mt-3 min-h-48 w-full rounded-lg border border-border bg-card p-3 text-sm" />}
            </div>}
          </section>
        </div>
      </>}
  </div>;
}

function Total({ label, value, profit = false, compact = false }: { label: string; value: number | null; profit?: boolean; compact?: boolean }) {
  const color = profit && value !== null ? value >= 0 ? "text-positive" : "text-negative" : "text-foreground";
  return <div className="min-w-0 flex flex-wrap items-baseline justify-between gap-x-4 sm:block"><dt className="text-sm text-muted">{label}</dt><dd className={`${compact ? "text-base sm:mt-1" : "mt-2 text-2xl"} font-semibold tabular-nums ${color}`}>{value === null ? "Unavailable" : formatPrice(value)}</dd></div>;
}

function QuantityInput({ crafts, label, onChange }: { crafts: number; label: string; onChange(value: number): void }) {
  const errorId = useId();
  const [draft, setDraft] = useState({ count: crafts, value: String(crafts) });
  const value = draft.count === crafts ? draft.value : String(crafts);
  const valid = validCraftCount(Number(value));
  return <label className="w-24 shrink-0 text-sm text-muted">Crafts
    <input type="number" min={1} max={MAX_CRAFTS} step={1} value={value} aria-label={label} aria-invalid={!valid} aria-describedby={!valid ? errorId : undefined}
      onChange={(event) => {
        const next = event.target.value;
        const count = Number(next);
        const accepted = validCraftCount(count);
        setDraft({ count: accepted ? count : crafts, value: next });
        if (accepted) onChange(count);
      }} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground" />
    {!valid && <span id={errorId} className="mt-1 block text-xs text-negative">Use 1–10,000 whole crafts. Totals keep the last valid quantity.</span>}
  </label>;
}
