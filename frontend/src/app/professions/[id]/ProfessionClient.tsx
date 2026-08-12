"use client";

import Link from "next/link";
import { formatPrice, type ProfessionRecipeCost, type ProfessionDetail, type RecipeCategory } from "@/lib/api";
import WowheadLink from "@/app/WowheadLink";
import { projectRecipeSummary } from "@/lib/recipe-scenario-projection";
import { useProfessionValuation } from "@/features/profession-valuation";

interface Props {
  profession: ProfessionDetail;
}

export default function ProfessionClient({ profession }: Props) {
  const valuation = useProfessionValuation(profession.id);
  const recipeCosts = valuation.data ?? [];

  // Group recipes by category
  const categoryMap = new Map<number, RecipeCategory>();
  for (const cat of profession.categories) {
    categoryMap.set(cat.id, cat);
  }

  const recipesByCategory = new Map<number | null, ProfessionRecipeCost[]>();
  for (const recipe of recipeCosts) {
    const key = recipe.categoryId;
    let arr = recipesByCategory.get(key);
    if (!arr) {
      arr = [];
      recipesByCategory.set(key, arr);
    }
    arr.push(recipe);
  }

  const sortedCategories = [...recipesByCategory.entries()].sort(([a], [b]) => (a ?? 0) - (b ?? 0));

  return (
    <div>
      <div className="mb-6">
        <Link href="/professions" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Professions
        </Link>
        <div className="mt-2">
          <div>
            <h1 className="text-2xl font-bold">{profession.name}</h1>
            <p className="text-sm text-muted">{recipeCosts.length} recipes</p>
            <p className="text-xs text-muted mt-1">Gross estimates exclude auction fees and profession-stat procs.</p>
          </div>
        </div>
      </div>

      <div className="h-5 mb-4 text-sm text-muted">
        {valuation.status === "selection-required" ? "Select a realm to value recipes." : null}
        {valuation.status === "loading" ? "Loading recipe prices..." : null}
        {valuation.status === "error" ? "Failed to load recipe prices." : null}
      </div>

      {sortedCategories.map(([categoryId, recipes]) => {
        const category = categoryId ? categoryMap.get(categoryId) : null;
        return (
          <section key={categoryId ?? "uncategorized"} className="mb-8">
            <h2 className="text-lg font-semibold text-muted">{category?.name ?? "Other"}</h2>
            <div className="overflow-x-auto">
              <RecipeTable recipes={recipes} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RecipeTable({ recipes }: { recipes: ProfessionRecipeCost[] }) {
  const scenarioColSpan = 3;
  const metricColumnCount = 9;
  const recipeColumnWidth = "22%";
  const metricColumnWidth = `${(100 - 22) / metricColumnCount}%`;

  return (
    <table className="w-full text-sm border-collapse table-fixed">
      <colgroup>
        <col style={{ width: recipeColumnWidth }} />
        {Array.from({ length: metricColumnCount }).map((_, index) => (
          <col key={index} style={{ width: metricColumnWidth }} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th rowSpan={2} className="py-2 pr-4 font-medium align-bottom">
            Recipe
          </th>
          <th colSpan={scenarioColSpan} className="py-2 pr-4 pl-4 font-medium border-l border-border/60 text-center">
            Pure R1
          </th>
          <th colSpan={scenarioColSpan} className="py-2 pr-4 pl-4 font-medium border-l border-border/60 text-center">
            Pure R2
          </th>
          <th colSpan={scenarioColSpan} className="py-2 pr-4 pl-4 font-medium border-l border-border/60 text-center">
            Conc R1→R2
          </th>
        </tr>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th className="py-2 pr-4 font-medium text-right">Output</th>
          <th className="py-2 pr-4 font-medium text-right">Gross Profit</th>
          <th className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th className="py-2 pr-4 font-medium text-right">Output</th>
          <th className="py-2 pr-4 font-medium text-right">Gross Profit</th>
          <th className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th className="py-2 pr-4 font-medium text-right">Output</th>
          <th className="py-2 pr-4 font-medium text-right">Gross Profit</th>
        </tr>
      </thead>
      <tbody>
        {recipes.map((recipe) => {
          const projection = projectRecipeSummary(recipe);
          if (projection.kind === "salvage") {
            return (
              <tr key={recipe.recipeId} className="border-b border-border/50 align-top">
                <td className="py-3 pr-4">
                  <WowheadLink href={`/recipes/${recipe.recipeId}`} type="spell" id={recipe.recipeId} className="text-accent hover:underline">
                    {recipe.recipeName}
                  </WowheadLink>
                </td>
                <td colSpan={9} className="py-3 pl-4 border-l border-border/60">
                  <div className="grid gap-2 md:grid-cols-2">
                    {projection.scenarios.map(({ scenarioKey, label, scenario }) => (
                      <div key={scenarioKey} className="flex justify-between gap-4">
                        <span className="text-muted">{label}</span>
                        <span>{scenario ? formatMaybePrice(scenario.profit) : "—"}</span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            );
          }
          const [s1, s2, s3] = projection.scenarios.map((entry) => entry.scenario);

          return (
            <tr key={recipe.recipeId} className="border-b border-border/50 hover:bg-card-hover transition-colors">
              <td className="py-2 pr-4">
                <WowheadLink href={`/recipes/${recipe.recipeId}`} type="spell" id={recipe.recipeId} className="text-accent hover:underline">
                  {recipe.recipeName}
                </WowheadLink>
                {s1 && s1.outputQuantity > 1 && <span className="text-muted ml-1">×{s1.outputQuantity}</span>}
              </td>
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
