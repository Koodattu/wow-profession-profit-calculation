import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  items,
  professions,
  recipeOutputQualities,
  recipeReagentSlotOptions,
  recipeReagentSlots,
  recipes,
  recipeSalvageTargets,
} from "../db/schema";
import { getCurrentItemMarkets, type MarketQuote } from "./current-market";
import { calculateGrossProfit } from "./profit-policy";
import { getSalvagingRecipeConfigMap } from "./salvaging-config";

export interface ReagentValuation {
  slotIndex: number;
  itemId: number;
  itemName: string;
  itemQuality: number | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface RecipeCostValuation {
  reagents: ReagentValuation[];
  totalCost: number;
  hasPriceData: boolean;
}

export interface RecipeScenario {
  scenarioKey: string;
  reagentRank: 1 | 2;
  outputRank: 1 | 2;
  cost: RecipeCostValuation;
  outputItemId: number | null;
  outputItemName: string | null;
  outputItemQuality: number | null;
  outputQuantity: number;
  outputUnitPrice: number | null;
  outputVariantCount?: number;
  outputTotalPrice: number | null;
  profit: number | null;
  isSalvage?: boolean;
  scenarioLabel?: string;
  inputItemId?: number;
}

export interface RecipeValuation {
  recipeId: number;
  recipeName: string;
  qualityTierType: string;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  professionId: number;
  professionName: string;
  scenarios: RecipeScenario[];
}

export interface ProfessionRecipeValuation {
  recipeId: number;
  recipeName: string;
  categoryId: number | null;
  qualityTierType: string;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  scenarios: RecipeScenario[];
}

type RecipeSelection = { recipeId: number } | { professionId: number };

function groupBy<T, K>(rows: T[], keyFor: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

async function getMarketQuotes(regionId: string, itemIds: number[], connectedRealmId?: number): Promise<Map<number, MarketQuote>> {
  const markets = await getCurrentItemMarkets(regionId, itemIds, connectedRealmId);
  const quotes = new Map<number, MarketQuote>();
  for (const [itemId, market] of markets) {
    if (market.currentQuote) quotes.set(itemId, market.currentQuote);
  }
  return quotes;
}

async function valueRecipes(selection: RecipeSelection, regionId: string, connectedRealmId?: number): Promise<(RecipeValuation & { categoryId: number | null })[]> {
  const recipeFilter = "recipeId" in selection ? eq(recipes.id, selection.recipeId) : eq(recipes.professionId, selection.professionId);
  const selectedRecipes = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      categoryId: recipes.categoryId,
      professionId: recipes.professionId,
      professionName: professions.name,
      qualityTierType: recipes.qualityTierType,
      affectedByMulticraft: recipes.affectedByMulticraft,
      affectedByResourcefulness: recipes.affectedByResourcefulness,
      outputItemId: recipes.outputItemId,
      outputQuantityMin: recipes.outputQuantityMin,
    })
    .from(recipes)
    .innerJoin(professions, eq(recipes.professionId, professions.id))
    .where(recipeFilter);

  if (selectedRecipes.length === 0) return [];

  const recipeIds = selectedRecipes.map((recipe) => recipe.id);
  const [allSlots, allOutputQualities, allSalvageTargets, salvagingConfigMap] = await Promise.all([
    db.select().from(recipeReagentSlots).where(inArray(recipeReagentSlots.recipeId, recipeIds)),
    db.select().from(recipeOutputQualities).where(inArray(recipeOutputQualities.recipeId, recipeIds)),
    db.select().from(recipeSalvageTargets).where(inArray(recipeSalvageTargets.recipeId, recipeIds)),
    getSalvagingRecipeConfigMap(),
  ]);
  const slotIds = allSlots.map((slot) => slot.id);
  const allOptions = slotIds.length === 0 ? [] : await db.select().from(recipeReagentSlotOptions).where(inArray(recipeReagentSlotOptions.slotId, slotIds));

  const slotsByRecipe = groupBy(allSlots, (slot) => slot.recipeId);
  const optionsBySlot = groupBy(allOptions, (option) => option.slotId);
  const outputQualitiesByRecipe = groupBy(allOutputQualities, (quality) => quality.recipeId);
  const salvageTargetsByRecipe = groupBy(allSalvageTargets, (target) => target.recipeId);

  function usesSalvageInputs(recipeId: number): boolean {
    const targets = salvageTargetsByRecipe.get(recipeId) ?? [];
    const config = salvagingConfigMap.get(recipeId);
    return targets.length > 0 && ((slotsByRecipe.get(recipeId) ?? []).length === 0 || config?.useSalvageInputs === true);
  }

  const allItemIds = new Set<number>();
  for (const recipe of selectedRecipes) {
    if (usesSalvageInputs(recipe.id)) {
      for (const target of salvageTargetsByRecipe.get(recipe.id) ?? []) allItemIds.add(target.itemId);
    } else {
      for (const slot of slotsByRecipe.get(recipe.id) ?? []) {
        if (slot.reagentType === 3 && !slot.required) continue;
        for (const option of optionsBySlot.get(slot.id) ?? []) {
          if (option.itemId) allItemIds.add(option.itemId);
        }
      }
    }

    if (recipe.outputItemId) allItemIds.add(recipe.outputItemId);
    for (const quality of outputQualitiesByRecipe.get(recipe.id) ?? []) allItemIds.add(quality.itemId);
  }

  const itemIdList = [...allItemIds];
  const [quotes, itemRows] = await Promise.all([
    getMarketQuotes(regionId, itemIdList, connectedRealmId),
    itemIdList.length === 0
      ? Promise.resolve([])
      : db.select({ id: items.id, name: items.name, itemQuality: items.itemQuality }).from(items).where(inArray(items.id, itemIdList)),
  ]);
  const itemMetadata = new Map(itemRows.map((item) => [item.id, item]));

  function valueReagents(recipeId: number, reagentRank: 1 | 2): RecipeCostValuation {
    const requiredSlots = (slotsByRecipe.get(recipeId) ?? []).filter((slot) => slot.reagentType !== 3 || slot.required);
    const reagents: ReagentValuation[] = [];
    let totalCost = 0;
    let hasPriceData = requiredSlots.length > 0;

    for (const slot of requiredSlots) {
      const options = optionsBySlot.get(slot.id) ?? [];
      let selected = options.find((option) => option.optionIndex === 1);
      if (slot.reagentType === 1) {
        selected = options.find((option) => option.optionIndex === reagentRank) ?? selected;
      }

      if (!selected?.itemId) {
        hasPriceData = false;
        continue;
      }

      const quote = quotes.get(selected.itemId);
      const unitPrice = quote?.minPrice ?? 0;
      const totalPrice = unitPrice * slot.quantity;
      if (!quote) hasPriceData = false;

      reagents.push({
        slotIndex: slot.slotIndex,
        itemId: selected.itemId,
        itemName: itemMetadata.get(selected.itemId)?.name ?? `Item #${selected.itemId}`,
        itemQuality: itemMetadata.get(selected.itemId)?.itemQuality ?? null,
        quantity: slot.quantity,
        unitPrice,
        totalPrice,
      });
      totalCost += totalPrice;
    }

    return { reagents, totalCost, hasPriceData };
  }

  function outputItems(recipe: (typeof selectedRecipes)[number]): { rank1: number | null; rank2: number | null } {
    if (recipe.qualityTierType === "none") return { rank1: recipe.outputItemId, rank2: recipe.outputItemId };

    const qualityByRank = new Map((outputQualitiesByRecipe.get(recipe.id) ?? []).map((quality) => [quality.rank, quality.itemId]));
    if (recipe.qualityTierType === "2rank") {
      return { rank1: qualityByRank.get(1) ?? recipe.outputItemId, rank2: qualityByRank.get(2) ?? recipe.outputItemId };
    }
    if (recipe.qualityTierType === "5rank") {
      return { rank1: qualityByRank.get(4) ?? recipe.outputItemId, rank2: qualityByRank.get(5) ?? recipe.outputItemId };
    }
    return { rank1: recipe.outputItemId, rank2: recipe.outputItemId };
  }

  function buildScenario(
    recipe: (typeof selectedRecipes)[number],
    reagentRank: 1 | 2,
    outputRank: 1 | 2,
    cost: RecipeCostValuation,
    outputItemId: number | null,
  ): RecipeScenario {
    const outputQuote = outputItemId ? quotes.get(outputItemId) : undefined;
    const outputUnitPrice = outputQuote?.minPrice ?? null;
    const outputTotalPrice = outputUnitPrice === null ? null : outputUnitPrice * recipe.outputQuantityMin;

    return {
      scenarioKey: `rank:${reagentRank}:${outputRank}`,
      reagentRank,
      outputRank,
      cost,
      outputItemId,
      outputItemName: outputItemId ? (itemMetadata.get(outputItemId)?.name ?? null) : null,
      outputItemQuality: outputItemId ? (itemMetadata.get(outputItemId)?.itemQuality ?? null) : null,
      outputQuantity: recipe.outputQuantityMin,
      outputUnitPrice,
      outputVariantCount: outputQuote?.variantCount,
      outputTotalPrice,
      profit: calculateGrossProfit(outputTotalPrice, cost.totalCost, cost.hasPriceData),
    };
  }

  function buildSalvageScenarios(recipe: (typeof selectedRecipes)[number], outputItemId: number | null): RecipeScenario[] {
    const inputQuantity = salvagingConfigMap.get(recipe.id)?.inputQuantity ?? (recipe.name === "Recycling" ? 5 : 1);
    const outputQuote = outputItemId ? quotes.get(outputItemId) : undefined;
    const outputUnitPrice = outputQuote?.minPrice ?? null;
    const outputTotalPrice = outputUnitPrice === null ? null : outputUnitPrice * recipe.outputQuantityMin;

    return (salvageTargetsByRecipe.get(recipe.id) ?? [])
      .map((target) => {
        const inputQuote = quotes.get(target.itemId);
        const unitPrice = inputQuote?.minPrice ?? 0;
        const reagent: ReagentValuation = {
          slotIndex: 1,
          itemId: target.itemId,
          itemName: itemMetadata.get(target.itemId)?.name ?? `Item #${target.itemId}`,
          itemQuality: itemMetadata.get(target.itemId)?.itemQuality ?? null,
          quantity: inputQuantity,
          unitPrice,
          totalPrice: unitPrice * inputQuantity,
        };
        const cost: RecipeCostValuation = {
          reagents: [reagent],
          totalCost: reagent.totalPrice,
          hasPriceData: Boolean(inputQuote),
        };

        return {
          scenarioKey: `salvage:${target.itemId}`,
          reagentRank: 1 as const,
          outputRank: 1 as const,
          cost,
          outputItemId,
          outputItemName: outputItemId ? (itemMetadata.get(outputItemId)?.name ?? null) : null,
          outputItemQuality: outputItemId ? (itemMetadata.get(outputItemId)?.itemQuality ?? null) : null,
          outputQuantity: recipe.outputQuantityMin,
          outputUnitPrice,
          outputVariantCount: outputQuote?.variantCount,
          outputTotalPrice,
          profit: calculateGrossProfit(outputTotalPrice, cost.totalCost, cost.hasPriceData),
          isSalvage: true,
          scenarioLabel: `${reagent.itemName} ×${inputQuantity}`,
          inputItemId: target.itemId,
        };
      })
      .sort((a, b) => {
        if (a.cost.hasPriceData !== b.cost.hasPriceData) return a.cost.hasPriceData ? -1 : 1;
        return a.cost.totalCost - b.cost.totalCost;
      });
  }

  return selectedRecipes.map((recipe) => {
    const outputs = outputItems(recipe);
    const scenarios = usesSalvageInputs(recipe.id)
      ? buildSalvageScenarios(recipe, outputs.rank1)
      : [
          buildScenario(recipe, 1, 1, valueReagents(recipe.id, 1), outputs.rank1),
          buildScenario(recipe, 2, 2, valueReagents(recipe.id, 2), outputs.rank2),
          buildScenario(recipe, 1, 2, valueReagents(recipe.id, 1), outputs.rank2),
        ];

    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      categoryId: recipe.categoryId,
      qualityTierType: recipe.qualityTierType,
      affectedByMulticraft: recipe.affectedByMulticraft,
      affectedByResourcefulness: recipe.affectedByResourcefulness,
      professionId: recipe.professionId,
      professionName: recipe.professionName,
      scenarios,
    };
  });
}

export async function getRecipeValuation(recipeId: number, regionId: string, connectedRealmId?: number): Promise<RecipeValuation> {
  const [valuation] = await valueRecipes({ recipeId }, regionId, connectedRealmId);
  if (!valuation) throw new Error(`Recipe ${recipeId} not found`);

  return {
    recipeId: valuation.recipeId,
    recipeName: valuation.recipeName,
    qualityTierType: valuation.qualityTierType,
    affectedByMulticraft: valuation.affectedByMulticraft,
    affectedByResourcefulness: valuation.affectedByResourcefulness,
    professionId: valuation.professionId,
    professionName: valuation.professionName,
    scenarios: valuation.scenarios,
  };
}

export async function getProfessionRecipeValuations(
  professionId: number,
  regionId: string,
  connectedRealmId?: number,
): Promise<ProfessionRecipeValuation[]> {
  const valuations = await valueRecipes({ professionId }, regionId, connectedRealmId);
  return valuations.map((valuation) => ({
    recipeId: valuation.recipeId,
    recipeName: valuation.recipeName,
    categoryId: valuation.categoryId,
    qualityTierType: valuation.qualityTierType,
    affectedByMulticraft: valuation.affectedByMulticraft,
    affectedByResourcefulness: valuation.affectedByResourcefulness,
    scenarios: valuation.scenarios[0]?.isSalvage ? valuation.scenarios.slice(0, 1) : valuation.scenarios,
  }));
}
