"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatPrice, type ProfessionRecipeCost, type ProfessionDetail } from "@/lib/api";
import WowheadLink from "@/app/WowheadLink";
import { NORMAL_SCENARIOS, projectRecipeSummary } from "@/lib/recipe-scenario-projection";
import { useProfessionValuation } from "@/features/profession-valuation";

interface Props {
  profession: ProfessionDetail;
}

export default function ProfessionClient({ profession }: Props) {
  const valuation = useProfessionValuation(profession.id);
  const recipeCosts = valuation.data ?? [];
  const params = useSearchParams();
  const query = (params.get("q") ?? "").slice(0, 160);
  const scenarioKey = NORMAL_SCENARIOS.find((entry) => entry.scenarioKey === params.get("scenario"))?.scenarioKey ?? "rank:1:1";
  const sort = ["profit", "cost", "name"].includes(params.get("sort") ?? "") ? params.get("sort")! : "category";
  const positiveOnly = params.get("positive") === "1";
  const returnTo = `/professions/${profession.id}${params.size ? `?${params.toString()}` : ""}`;
  const recipeHref = (id: number) => `/recipes/${id}?from=${encodeURIComponent(returnTo)}`;
  function changeFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    window.history.replaceState(null, "", `/professions/${profession.id}${next.size ? `?${next}` : ""}`);
  }

  const categoryMap = new Map(profession.categories.map((category) => [category.id, category]));
  const rows = recipeCosts.map((recipe) => {
    const projection = projectRecipeSummary(recipe);
    const choice = projection.kind === "salvage"
      ? [...projection.scenarios].sort((a, b) => (a.scenario?.cost.totalCost ?? Infinity) - (b.scenario?.cost.totalCost ?? Infinity))[0]
      : projection.scenarios.find((entry) => entry.scenarioKey === scenarioKey);
    return { recipe, choice, category: categoryMap.get(recipe.categoryId ?? 0)?.name ?? "Other" };
  }).filter(({ recipe, category, choice }) => `${recipe.recipeName} ${category}`.toLowerCase().includes(query.trim().toLowerCase())
    && (!positiveOnly || (choice?.scenario?.profit ?? 0) > 0));
  rows.sort((a, b) => {
    const left = sort === "profit" ? a.choice?.scenario?.profit : a.choice?.scenario?.cost.totalCost;
    const right = sort === "profit" ? b.choice?.scenario?.profit : b.choice?.scenario?.cost.totalCost;
    if (sort === "profit" || sort === "cost") {
      if (left == null && right != null) return 1;
      if (left != null && right == null) return -1;
      if (left != null && right != null && left !== right) return sort === "profit" ? right - left : left - right;
    }
    return (sort === "category" ? a.category.localeCompare(b.category) : 0) || a.recipe.recipeName.localeCompare(b.recipe.recipeName) || a.recipe.recipeId - b.recipe.recipeId;
  });

  const recipesByCategory = new Map<number | null, ProfessionRecipeCost[]>();
  for (const { recipe } of rows) {
    const key = sort === "category" ? recipe.categoryId : null;
    let arr = recipesByCategory.get(key);
    if (!arr) {
      arr = [];
      recipesByCategory.set(key, arr);
    }
    arr.push(recipe);
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/professions" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Professions
        </Link>
        <div className="mt-2">
          <div>
            <h1 className="text-2xl font-bold">{profession.name}</h1>
            {valuation.data && <p className="text-sm text-muted">{recipeCosts.length} recipes</p>}
            <p className="mt-2 text-sm leading-6 text-muted">Compare every scenario side by side. Values are per craft; gross profit excludes auction fees and profession-stat procs.</p>
          </div>
        </div>
      </div>

      <div className="mb-6 border-y border-border py-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm text-muted">Search recipes
            <input value={query} maxLength={160} onChange={(event) => changeFilter("q", event.target.value)} placeholder="Recipe or category"
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground" />
          </label>
          <label className="text-sm text-muted">Sort recipes
            <select value={sort} onChange={(event) => changeFilter("sort", event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground">
              <option value="category">Category</option><option value="profit">Highest gross profit</option><option value="cost">Lowest material cost</option><option value="name">Recipe name</option>
            </select>
          </label>
          <fieldset className="min-w-0 text-sm sm:col-span-2 lg:col-span-1">
            <legend className="text-muted">Sort and filter by</legend>
            <div className="mt-1 flex flex-wrap gap-x-4">
              {NORMAL_SCENARIOS.map((entry) => (
                <label key={entry.scenarioKey} className="flex min-h-11 items-center gap-2">
                  <input type="radio" name="sort-scenario" value={entry.scenarioKey} checked={scenarioKey === entry.scenarioKey}
                    onChange={() => changeFilter("scenario", entry.scenarioKey)} className="size-4 accent-accent" />
                  {entry.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={positiveOnly} onChange={(event) => changeFilter("positive", event.target.checked ? "1" : "")} className="size-4 accent-accent" />Positive gross profit only</label>
          <button type="button" className="min-h-11 text-accent hover:underline" onClick={() => window.history.replaceState(null, "", `/professions/${profession.id}`)}>Reset filters</button>
          <Link href="/craft-plan" className="inline-flex min-h-11 items-center text-accent hover:underline sm:ml-auto">View craft plan →</Link>
        </div>
        <p className="mt-2 text-sm text-muted">The selected scenario controls cost/profit sorting and the profit filter. All scenarios stay visible. Salvage recipes use their lowest-cost input.</p>
      </div>

      <div className="mb-4 text-sm text-muted">
        {valuation.status === "selection-required" ? "Select a realm to value recipes." : null}
        {valuation.status === "loading" ? "Loading recipe prices..." : null}
        {valuation.status === "error" || valuation.status === "refresh-error" ? (
          <div role="alert">
            <p>{valuation.status === "refresh-error" ? "Couldn’t refresh recipe prices. Showing the last loaded prices." : "Couldn’t load recipe prices."}</p>
            <button type="button" className="mt-2 min-h-11 rounded-lg border border-border px-4 text-accent" onClick={valuation.retry}>Retry prices</button>
          </div>
        ) : null}
      </div>

      {valuation.data && <p role="status" className="mb-4 text-sm text-muted">Showing {rows.length} of {recipeCosts.length} recipes</p>}
      {valuation.data && rows.length === 0 && <p className="my-8 text-muted">No recipes match these filters.</p>}

      {[...recipesByCategory.entries()].map(([categoryId, recipes]) => {
        const category = categoryId ? categoryMap.get(categoryId) : null;
        const title = sort === "category" ? category?.name ?? "Other" : "Scenario comparison";
        return (
          <section key={categoryId ?? "uncategorized"} className="mb-8">
            <h2 className="text-lg font-semibold text-muted">{title}</h2>
            <p className="my-2 text-xs text-muted lg:hidden">Scroll to compare all scenarios, or open a recipe for details.</p>
            <div className="overflow-x-auto" role="region" aria-label={`${title} recipe prices`} tabIndex={0}>
              <RecipeTable recipes={recipes} recipeHref={recipeHref} title={title} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RecipeTable({ recipes, recipeHref, title }: { recipes: ProfessionRecipeCost[]; recipeHref(id: number): string; title: string }) {
  const scenarioColSpan = 3;
  const metricColumnCount = 9;
  const recipeColumnWidth = "22%";
  const metricColumnWidth = `${(100 - 22) / metricColumnCount}%`;

  return (
    <table className="w-full min-w-[980px] text-sm border-collapse tabular-nums">
      <caption className="sr-only">{title} — scenario prices per craft</caption>
      <colgroup>
        <col style={{ width: recipeColumnWidth }} />
      </colgroup>
      {NORMAL_SCENARIOS.map(({ scenarioKey }) => (
        <colgroup key={scenarioKey}>
          {Array.from({ length: scenarioColSpan }).map((_, index) => (
            <col key={index} style={{ width: metricColumnWidth }} />
          ))}
        </colgroup>
      ))}
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th scope="col" rowSpan={2} className="py-2 pr-4 font-medium align-bottom">
            Recipe
          </th>
          <th scope="colgroup" colSpan={scenarioColSpan} className="py-2 pr-4 pl-4 font-medium border-l border-border/60 text-center">
            Pure R1
          </th>
          <th scope="colgroup" colSpan={scenarioColSpan} className="py-2 pr-4 pl-4 font-medium border-l border-border/60 text-center">
            Pure R2
          </th>
          <th scope="colgroup" colSpan={scenarioColSpan} className="py-2 pr-4 pl-4 font-medium border-l border-border/60 text-center">
            Conc R1→R2
          </th>
        </tr>
        <tr className="border-b border-border text-left text-muted">
          <th scope="col" className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th scope="col" className="py-2 pr-4 font-medium text-right">Output</th>
          <th scope="col" className="py-2 pr-4 font-medium text-right">Gross Profit</th>
          <th scope="col" className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th scope="col" className="py-2 pr-4 font-medium text-right">Output</th>
          <th scope="col" className="py-2 pr-4 font-medium text-right">Gross Profit</th>
          <th scope="col" className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th scope="col" className="py-2 pr-4 font-medium text-right">Output</th>
          <th scope="col" className="py-2 pr-4 font-medium text-right">Gross Profit</th>
        </tr>
      </thead>
      <tbody>
        {recipes.map((recipe) => {
          const projection = projectRecipeSummary(recipe);
          if (projection.kind === "salvage") {
            return (
              <tr key={recipe.recipeId} className="border-b border-border/50 align-top">
                <th scope="row" className="pr-4 text-left font-normal">
                  <WowheadLink href={recipeHref(recipe.recipeId)} type="spell" id={recipe.recipeId} className="inline-flex min-h-11 items-center text-accent hover:underline">
                    {recipe.recipeName}
                  </WowheadLink>
                </th>
                <td colSpan={9} className="py-3 pl-4 border-l border-border/60">
                  <p className="mb-2 text-xs text-muted">Gross profit by salvage input</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {projection.scenarios.map(({ scenarioKey, label, scenario }) => (
                      <div key={scenarioKey} className="flex justify-between gap-4">
                        <span className="text-muted">{label}</span>
                        <span className="whitespace-nowrap"><ProfitCell value={scenario?.profit ?? null} /></span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            );
          }
          const [s1, s2, s3] = projection.scenarios.map((entry) => entry.scenario);

          return (
            <tr key={recipe.recipeId} className="border-b border-border/50 hover:bg-card-hover transition-colors [&_td]:whitespace-nowrap">
              <th scope="row" className="pr-4 text-left font-normal">
                <WowheadLink href={recipeHref(recipe.recipeId)} type="spell" id={recipe.recipeId} className="inline-flex min-h-11 items-center text-accent hover:underline">
                  {recipe.recipeName}
                </WowheadLink>
                {s1 && s1.outputQuantity > 1 && <span className="text-muted ml-1">×{s1.outputQuantity}</span>}
              </th>
              <td className="py-2 pr-4 pl-4 text-right border-l border-border/60">{s1 ? formatMaybePrice(s1.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s1?.outputTotalPrice != null ? formatPrice(s1.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s1?.profit ?? null} />
              </td>
              <td className="py-2 pr-4 pl-4 text-right border-l border-border/60">{s2 ? formatMaybePrice(s2.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s2?.outputTotalPrice != null ? formatPrice(s2.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s2?.profit ?? null} />
              </td>
              <td className="py-2 pr-4 pl-4 text-right border-l border-border/60">{s3 ? formatMaybePrice(s3.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s3?.outputTotalPrice != null ? formatPrice(s3.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s3?.profit ?? null} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function formatMaybePrice(value: number | null): string {
  return value === null ? "—" : formatPrice(value);
}

function ProfitCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  const color = value >= 0 ? "text-positive" : "text-negative";
  return <span className={color}>{formatPrice(value)}</span>;
}
