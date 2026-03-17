"use client";

import { useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { formatPrice, type ProfessionRecipeCost, type ProfessionDetail, type RecipeCategory } from "@/lib/api";
import { getSelectedTier, setSelectedTier, subscribeToTier } from "@/lib/profession-stats";
import { getTierStats, TOOL_TIER_LABELS, TOOL_TIERS, type ToolTier } from "@/lib/tool-tiers";
import { calculateAdjustedProfit } from "@/lib/profit-calc";

interface Props {
  profession: ProfessionDetail;
  recipeCosts: ProfessionRecipeCost[];
}

export default function ProfessionClient({ profession, recipeCosts }: Props) {
  const getSnapshot = useCallback(() => getSelectedTier(), []);
  const getServerSnapshot = useCallback((): ToolTier => "none", []);
  const tier = useSyncExternalStore(subscribeToTier, getSnapshot, getServerSnapshot);

  const tierStats = getTierStats(profession.name, tier);
  const hasTier = tier !== "none";

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
        <h1 className="text-2xl font-bold mt-2">{profession.name}</h1>
        <p className="text-sm text-muted">{recipeCosts.length} recipes</p>
      </div>

      {/* Tool Tier Selector */}
      <div className="mb-6 p-4 border border-border rounded-lg bg-card">
        <label className="flex items-center gap-3 text-sm">
          <span className="text-muted font-medium">Tool Tier</span>
          <select value={tier} onChange={(e) => setSelectedTier(e.target.value as ToolTier)} className="px-3 py-1.5 rounded bg-background border border-border text-foreground">
            {TOOL_TIERS.map((t) => (
              <option key={t} value={t}>
                {TOOL_TIER_LABELS[t]}
              </option>
            ))}
          </select>
          {hasTier && tierStats.multicraftRating > 0 && <span className="text-muted text-xs">MC: {tierStats.multicraftRating}</span>}
          {hasTier && tierStats.resourcefulnessRating > 0 && <span className="text-muted text-xs">Res: {tierStats.resourcefulnessRating}</span>}
        </label>
      </div>

      {sortedCategories.map(([categoryId, recipes]) => {
        const category = categoryId ? categoryMap.get(categoryId) : null;
        return (
          <section key={categoryId ?? "uncategorized"} className="mb-8">
            <h2 className="text-lg font-semibold mb-3 text-muted">{category?.name ?? "Other"}</h2>
            <div className="overflow-x-auto">
              <RecipeTable recipes={recipes} professionName={profession.name} tier={tier} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RecipeTable({ recipes, professionName, tier }: { recipes: ProfessionRecipeCost[]; professionName: string; tier: ToolTier }) {
  const hasTier = tier !== "none";
  const tierStats = getTierStats(professionName, tier);

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-2 pr-4 font-medium">Recipe</th>
          <th className="py-2 pr-4 font-medium">Type</th>
          <th className="py-2 pr-4 font-medium text-right">Cost (R1)</th>
          <th className="py-2 pr-4 font-medium text-right">Output (R1)</th>
          <th className="py-2 pr-4 font-medium text-right">Profit (R1)</th>
          {hasTier && <th className="py-2 pr-4 font-medium text-right">Adj. Profit (R1)</th>}
          <th className="py-2 pr-4 font-medium text-right">Cost (R2)</th>
          <th className="py-2 pr-4 font-medium text-right">Output (R2)</th>
          <th className="py-2 pr-4 font-medium text-right">Profit (R2)</th>
          {hasTier && <th className="py-2 pr-4 font-medium text-right">Adj. Profit (R2)</th>}
        </tr>
      </thead>
      <tbody>
        {recipes.map((recipe) => {
          const s1 = recipe.scenarios[0];
          const s2 = recipe.scenarios[1];

          const adj1 =
            hasTier && s1
              ? calculateAdjustedProfit({
                  tierStats,
                  baseYield: s1.outputQuantity,
                  outputUnitPrice: s1.outputUnitPrice,
                  totalCost: s1.cost.totalCost,
                  affectedByMulticraft: recipe.affectedByMulticraft,
                  affectedByResourcefulness: recipe.affectedByResourcefulness,
                })
              : null;

          const adj2 =
            hasTier && s2
              ? calculateAdjustedProfit({
                  tierStats,
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
              {hasTier && (
                <td className="py-2 pr-4 text-right">
                  <ProfitCell value={adj1?.expectedProfit ?? null} />
                </td>
              )}
              <td className="py-2 pr-4 text-right">{s2 ? formatPrice(s2.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s2?.outputTotalPrice != null ? formatPrice(s2.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s2?.profit ?? null} />
              </td>
              {hasTier && (
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
