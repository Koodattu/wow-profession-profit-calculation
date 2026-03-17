"use client";

import { useSyncExternalStore, useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { fetchProfessionCostsForRealm, formatPrice, type ProfessionRecipeCost, type ProfessionDetail, type RecipeCategory } from "@/lib/api";
import WowheadLink from "@/app/WowheadLink";
import { getSelectedTier, subscribeToTier } from "@/lib/profession-stats";
import { getTierStats, type ToolTier } from "@/lib/tool-tiers";
import { calculateAdjustedProfit } from "@/lib/profit-calc";
import { getSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";

interface Props {
  profession: ProfessionDetail;
}

export default function ProfessionClient({ profession }: Props) {
  const getSnapshot = useCallback(() => getSelectedTier(), []);
  const getServerSnapshot = useCallback((): ToolTier => "none", []);
  const tier = useSyncExternalStore(subscribeToTier, getSnapshot, getServerSnapshot);
  const connectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [recipeCosts, setRecipeCosts] = useState<ProfessionRecipeCost[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [isPending, startTransition] = useTransition();

  const tierStats = getTierStats(profession.name, tier);
  const hasTier = tier !== "none";

  useEffect(() => {
    if (connectedRealmId === null) return;

    let cancelled = false;

    startTransition(async () => {
      try {
        const nextRecipeCosts = await fetchProfessionCostsForRealm(profession.id, "eu", connectedRealmId);
        if (!cancelled) setRecipeCosts(nextRecipeCosts);
      } catch {
        if (!cancelled) setRecipeCosts([]);
      } finally {
        if (!cancelled) setInitialLoad(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [connectedRealmId, profession.id]);

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
          </div>
          {hasTier && (
            <div className="mt-1 flex items-center gap-3 text-sm">
              {tierStats.multicraftRating > 0 && <span className="text-muted text-xs">MC: {tierStats.multicraftRating}</span>}
              {tierStats.resourcefulnessRating > 0 && <span className="text-muted text-xs">Res: {tierStats.resourcefulnessRating}</span>}
            </div>
          )}
        </div>
      </div>

      {(initialLoad || isPending) && <p className="text-sm text-muted mb-4">Loading recipe prices...</p>}

      {sortedCategories.map(([categoryId, recipes]) => {
        const category = categoryId ? categoryMap.get(categoryId) : null;
        return (
          <section key={categoryId ?? "uncategorized"} className="mb-8">
            <h2 className="text-lg font-semibold text-muted">{category?.name ?? "Other"}</h2>
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
  const scenarioColSpan = hasTier ? 4 : 3;
  const metricColumnCount = hasTier ? 12 : 9;
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
          <th className="py-2 pr-4 font-medium text-right">Profit</th>
          {hasTier && <th className="py-2 pr-4 font-medium text-right">Adj. Profit</th>}
          <th className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th className="py-2 pr-4 font-medium text-right">Output</th>
          <th className="py-2 pr-4 font-medium text-right">Profit</th>
          {hasTier && <th className="py-2 pr-4 font-medium text-right">Adj. Profit</th>}
          <th className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/60">Cost</th>
          <th className="py-2 pr-4 font-medium text-right">Output</th>
          <th className="py-2 pr-4 font-medium text-right">Profit</th>
          {hasTier && <th className="py-2 pr-4 font-medium text-right">Adj. Profit</th>}
        </tr>
      </thead>
      <tbody>
        {recipes.map((recipe) => {
          const s1 = recipe.scenarios.find((scenario) => scenario.reagentRank === 1 && scenario.outputRank === 1) ?? recipe.scenarios[0];
          const s2 = recipe.scenarios.find((scenario) => scenario.reagentRank === 2 && scenario.outputRank === 2) ?? recipe.scenarios[1];
          const s3 = recipe.scenarios.find((scenario) => scenario.reagentRank === 1 && scenario.outputRank === 2) ?? recipe.scenarios[2];

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

          const adj3 =
            hasTier && s3
              ? calculateAdjustedProfit({
                  tierStats,
                  baseYield: s3.outputQuantity,
                  outputUnitPrice: s3.outputUnitPrice,
                  totalCost: s3.cost.totalCost,
                  affectedByMulticraft: recipe.affectedByMulticraft,
                  affectedByResourcefulness: recipe.affectedByResourcefulness,
                })
              : null;

          return (
            <tr key={recipe.recipeId} className="border-b border-border/50 hover:bg-card-hover transition-colors">
              <td className="py-2 pr-4">
                <WowheadLink href={`/recipes/${recipe.recipeId}`} type="spell" id={recipe.recipeId} className="text-accent hover:underline">
                  {recipe.recipeName}
                </WowheadLink>
                {s1 && s1.outputQuantity > 1 && <span className="text-muted ml-1">×{s1.outputQuantity}</span>}
              </td>
              <td className="py-2 pr-4 pl-4 text-right border-l border-border/60">{s1 ? formatPrice(s1.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s1?.outputTotalPrice != null ? formatPrice(s1.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s1?.profit ?? null} />
              </td>
              {hasTier && (
                <td className="py-2 pr-4 text-right">
                  <ProfitCell value={adj1?.expectedProfit ?? null} />
                </td>
              )}
              <td className="py-2 pr-4 pl-4 text-right border-l border-border/60">{s2 ? formatPrice(s2.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s2?.outputTotalPrice != null ? formatPrice(s2.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s2?.profit ?? null} />
              </td>
              {hasTier && (
                <td className="py-2 pr-4 text-right">
                  <ProfitCell value={adj2?.expectedProfit ?? null} />
                </td>
              )}
              <td className="py-2 pr-4 pl-4 text-right border-l border-border/60">{s3 ? formatPrice(s3.cost.totalCost) : "—"}</td>
              <td className="py-2 pr-4 text-right">{s3?.outputTotalPrice != null ? formatPrice(s3.outputTotalPrice) : "—"}</td>
              <td className="py-2 pr-4 text-right">
                <ProfitCell value={s3?.profit ?? null} />
              </td>
              {hasTier && (
                <td className="py-2 pr-4 text-right">
                  <ProfitCell value={adj3?.expectedProfit ?? null} />
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
