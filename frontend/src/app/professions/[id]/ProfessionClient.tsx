"use client";

import { useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { formatPrice, type ProfessionRecipeCost, type ProfessionDetail, type RecipeCategory } from "@/lib/api";
import { getProfessionStats, setProfessionStats, subscribeToStats, type ProfessionStats } from "@/lib/profession-stats";
import { calculateAdjustedProfit } from "@/lib/profit-calc";

const SERVER_STATS: ProfessionStats = { multicraftRating: 0, resourcefulnessRating: 0 };

interface Props {
  profession: ProfessionDetail;
  recipeCosts: ProfessionRecipeCost[];
}

export default function ProfessionClient({ profession, recipeCosts }: Props) {
  const getSnapshot = useCallback(() => getProfessionStats(profession.id), [profession.id]);
  const getServerSnapshot = useCallback(() => SERVER_STATS, []);
  const stats = useSyncExternalStore(subscribeToStats, getSnapshot, getServerSnapshot);

  const updateStats = useCallback(
    (next: ProfessionStats) => {
      setProfessionStats(profession.id, next);
    },
    [profession.id],
  );

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

  const hasStats = stats.multicraftRating > 0 || stats.resourcefulnessRating > 0;

  return (
    <div>
      <div className="mb-6">
        <Link href="/professions" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Professions
        </Link>
        <h1 className="text-2xl font-bold mt-2">{profession.name}</h1>
        <p className="text-sm text-muted">{recipeCosts.length} recipes</p>
      </div>

      {/* Stats Editor */}
      <div className="mb-6 p-4 border border-border rounded-lg bg-card">
        <h2 className="text-sm font-semibold text-muted mb-3">Your Crafting Stats</h2>
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

      {sortedCategories.map(([categoryId, recipes]) => {
        const category = categoryId ? categoryMap.get(categoryId) : null;
        return (
          <section key={categoryId ?? "uncategorized"} className="mb-8">
            <h2 className="text-lg font-semibold mb-3 text-muted">{category?.name ?? "Other"}</h2>
            <div className="overflow-x-auto">
              <RecipeTable recipes={recipes} professionName={profession.name} stats={stats} hasStats={hasStats} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RecipeTable({ recipes, professionName, stats, hasStats }: { recipes: ProfessionRecipeCost[]; professionName: string; stats: ProfessionStats; hasStats: boolean }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-2 pr-4 font-medium">Recipe</th>
          <th className="py-2 pr-4 font-medium">Type</th>
          <th className="py-2 pr-4 font-medium text-right">Cost (R1)</th>
          <th className="py-2 pr-4 font-medium text-right">Output (R1)</th>
          <th className="py-2 pr-4 font-medium text-right">Profit (R1)</th>
          {hasStats && <th className="py-2 pr-4 font-medium text-right">Adj. Profit (R1)</th>}
          <th className="py-2 pr-4 font-medium text-right">Cost (R2)</th>
          <th className="py-2 pr-4 font-medium text-right">Output (R2)</th>
          <th className="py-2 pr-4 font-medium text-right">Profit (R2)</th>
          {hasStats && <th className="py-2 pr-4 font-medium text-right">Adj. Profit (R2)</th>}
        </tr>
      </thead>
      <tbody>
        {recipes.map((recipe) => {
          const s1 = recipe.scenarios[0];
          const s2 = recipe.scenarios[1];

          const adj1 =
            hasStats && s1
              ? calculateAdjustedProfit({
                  professionName,
                  stats,
                  baseYield: s1.outputQuantity,
                  outputUnitPrice: s1.outputUnitPrice,
                  totalCost: s1.cost.totalCost,
                  affectedByMulticraft: recipe.affectedByMulticraft,
                  affectedByResourcefulness: recipe.affectedByResourcefulness,
                })
              : null;

          const adj2 =
            hasStats && s2
              ? calculateAdjustedProfit({
                  professionName,
                  stats,
                  baseYield: s2.outputQuantity,
                  outputUnitPrice: s2.outputUnitPrice,
                  totalCost: s2.cost.totalCost,
                  affectedByMulticraft: recipe.affectedByMulticraft,
                  affectedByResourcefulness: recipe.affectedByResourcefulness,
                })
              : null;

          return (
            <tr key={recipe.recipeId} className="border-b border-border/50 hover:bg-card-hover transition-colors">
              <td className="py-2 pr-4">
                <Link href={`/recipes/${recipe.recipeId}`} className="text-accent hover:underline">
                  {recipe.recipeName}
                </Link>
                {s1 && s1.outputQuantity > 1 && <span className="text-muted ml-1">×{s1.outputQuantity}</span>}
              </td>
              <td className="py-2 pr-4 text-muted">{recipe.qualityTierType}</td>
              <td className="py-2 pr-4 text-right">{s1 ? formatPrice(s1.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s1?.outputTotalPrice != null ? formatPrice(s1.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s1?.profit ?? null} />
              </td>
              {hasStats && (
                <td className="py-2 pr-4 text-right">
                  <ProfitCell value={adj1?.expectedProfit ?? null} />
                </td>
              )}
              <td className="py-2 pr-4 text-right">{s2 ? formatPrice(s2.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s2?.outputTotalPrice != null ? formatPrice(s2.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s2?.profit ?? null} />
              </td>
              {hasStats && (
                <td className="py-2 pr-4 text-right">
                  <ProfitCell value={adj2?.expectedProfit ?? null} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ProfitCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  const color = value >= 0 ? "text-positive" : "text-negative";
  return <span className={color}>{formatPrice(value)}</span>;
}
