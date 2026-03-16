import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { professions, recipes, recipeOutputQualities, recipeReagentSlots, recipeReagentSlotOptions, commoditySnapshots, items } from "../db/schema";

// ─── Types ───────────────────────────────────────────────────────────

interface PriceData {
  minPrice: number;
  avgPrice: number;
  medianPrice: number;
}

interface ReagentCost {
  slotIndex: number;
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface RecipeCostResult {
  reagents: ReagentCost[];
  totalCost: number;
  hasPriceData: boolean;
}

interface RankScenario {
  reagentRank: 1 | 2;
  cost: RecipeCostResult;
  outputItemId: number | null;
  outputItemName: string | null;
  outputQuantity: number;
  outputUnitPrice: number | null;
  outputTotalPrice: number | null;
  profit: number | null;
}

interface RecipeProfitResult {
  recipeId: number;
  recipeName: string;
  qualityTierType: string;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  professionId: number;
  professionName: string;
  scenarios: RankScenario[];
}

interface ProfessionRecipeCost {
  recipeId: number;
  recipeName: string;
  categoryId: number | null;
  qualityTierType: string;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  scenarios: RankScenario[];
}

// ─── Get Latest Prices ──────────────────────────────────────────────

export async function getLatestPrices(regionId: string, itemIds: number[]): Promise<Map<number, PriceData>> {
  if (itemIds.length === 0) return new Map();

  // Get the most recent snapshot time for this region
  const [latest] = await db
    .select({ maxTime: sql<string>`max(${commoditySnapshots.snapshotTime})::text` })
    .from(commoditySnapshots)
    .where(eq(commoditySnapshots.regionId, regionId));

  if (!latest?.maxTime) return new Map();

  const latestTime = new Date(latest.maxTime);

  // Fetch prices at the latest snapshot time for requested items
  const BATCH = 500;
  const priceMap = new Map<number, PriceData>();

  for (let i = 0; i < itemIds.length; i += BATCH) {
    const batch = itemIds.slice(i, i + BATCH);
    const rows = await db
      .select({
        itemId: commoditySnapshots.itemId,
        minPrice: commoditySnapshots.minPrice,
        avgPrice: commoditySnapshots.avgPrice,
        medianPrice: commoditySnapshots.medianPrice,
      })
      .from(commoditySnapshots)
      .where(and(eq(commoditySnapshots.regionId, regionId), eq(commoditySnapshots.snapshotTime, latestTime), inArray(commoditySnapshots.itemId, batch)));

    for (const row of rows) {
      priceMap.set(row.itemId, {
        minPrice: Number(row.minPrice),
        avgPrice: Number(row.avgPrice ?? row.minPrice),
        medianPrice: Number(row.medianPrice ?? row.minPrice),
      });
    }
  }

  return priceMap;
}

// ─── Compute Recipe Cost ────────────────────────────────────────────

export async function computeRecipeCost(recipeId: number, regionId: string, reagentRank: 1 | 2): Promise<RecipeCostResult> {
  // Load all reagent slots for this recipe
  const slots = await db.select().from(recipeReagentSlots).where(eq(recipeReagentSlots.recipeId, recipeId)).orderBy(recipeReagentSlots.slotIndex);

  if (slots.length === 0) {
    return { reagents: [], totalCost: 0, hasPriceData: false };
  }

  // Load all options for these slots
  const slotIds = slots.map((s) => s.id);
  const options = await db.select().from(recipeReagentSlotOptions).where(inArray(recipeReagentSlotOptions.slotId, slotIds));

  // Group options by slotId
  const optionsBySlot = new Map<number, typeof options>();
  for (const opt of options) {
    let arr = optionsBySlot.get(opt.slotId);
    if (!arr) {
      arr = [];
      optionsBySlot.set(opt.slotId, arr);
    }
    arr.push(opt);
  }

  // Select the item for each required slot
  const selectedItems: { slotIndex: number; itemId: number; quantity: number }[] = [];

  for (const slot of slots) {
    // Skip optional slots
    if (slot.reagentType === 3 && !slot.required) continue;

    const slotOptions = optionsBySlot.get(slot.id) ?? [];
    if (slotOptions.length === 0) continue;

    let chosenOption = slotOptions.find((o) => o.optionIndex === 1); // default

    // For quality reagent slots, pick the requested rank
    if (slot.reagentType === 1) {
      const rankOption = slotOptions.find((o) => o.optionIndex === reagentRank);
      if (rankOption) chosenOption = rankOption;
    }

    if (!chosenOption?.itemId) continue;

    selectedItems.push({
      slotIndex: slot.slotIndex,
      itemId: chosenOption.itemId,
      quantity: slot.quantity,
    });
  }

  // Fetch prices for all selected items
  const itemIds = [...new Set(selectedItems.map((s) => s.itemId))];
  const prices = await getLatestPrices(regionId, itemIds);

  // Look up item names
  const itemRows = itemIds.length > 0 ? await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, itemIds)) : [];
  const itemNameMap = new Map(itemRows.map((r) => [r.id, r.name]));

  // Build reagent cost breakdown
  let totalCost = 0;
  let hasPriceData = true;
  const reagents: ReagentCost[] = [];

  for (const sel of selectedItems) {
    const price = prices.get(sel.itemId);
    const unitPrice = price?.minPrice ?? 0;
    const slotTotal = unitPrice * sel.quantity;

    if (!price) hasPriceData = false;

    reagents.push({
      slotIndex: sel.slotIndex,
      itemId: sel.itemId,
      itemName: itemNameMap.get(sel.itemId) ?? `Item #${sel.itemId}`,
      quantity: sel.quantity,
      unitPrice,
      totalPrice: slotTotal,
    });
    totalCost += slotTotal;
  }

  return { reagents, totalCost, hasPriceData };
}

// ─── Compute Recipe Profit ──────────────────────────────────────────

export async function computeRecipeProfit(recipeId: number, regionId: string): Promise<RecipeProfitResult> {
  // Load the recipe
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
  if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

  // Load profession name
  const [profession] = await db.select({ name: professions.name }).from(professions).where(eq(professions.id, recipe.professionId));
  const professionName = profession?.name ?? "Unknown";

  // Compute cost for both ranks
  const [costRank1, costRank2] = await Promise.all([computeRecipeCost(recipeId, regionId, 1), computeRecipeCost(recipeId, regionId, 2)]);

  // Determine output items for each rank
  const outputQuantity = recipe.outputQuantityMin;

  let outputRank1ItemId: number | null = null;
  let outputRank2ItemId: number | null = null;

  if (recipe.qualityTierType === "none") {
    outputRank1ItemId = recipe.outputItemId;
    outputRank2ItemId = recipe.outputItemId;
  } else {
    // Load output qualities
    const outputQualities = await db.select().from(recipeOutputQualities).where(eq(recipeOutputQualities.recipeId, recipeId)).orderBy(recipeOutputQualities.rank);

    const qualityByRank = new Map(outputQualities.map((q) => [q.rank, q.itemId]));

    if (recipe.qualityTierType === "2rank") {
      outputRank1ItemId = qualityByRank.get(1) ?? recipe.outputItemId;
      outputRank2ItemId = qualityByRank.get(2) ?? recipe.outputItemId;
    } else if (recipe.qualityTierType === "5rank") {
      outputRank1ItemId = qualityByRank.get(4) ?? recipe.outputItemId;
      outputRank2ItemId = qualityByRank.get(5) ?? recipe.outputItemId;
    }
  }

  // Collect output item IDs and fetch prices
  const outputItemIds = [outputRank1ItemId, outputRank2ItemId].filter((id): id is number => id !== null);
  const outputPrices = await getLatestPrices(regionId, outputItemIds);

  // Look up output item names
  const outputItemRows = outputItemIds.length > 0 ? await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, outputItemIds)) : [];
  const outputNameMap = new Map(outputItemRows.map((r) => [r.id, r.name]));

  // Build scenarios
  function buildScenario(rank: 1 | 2, cost: RecipeCostResult, outputItemId: number | null): RankScenario {
    const price = outputItemId ? outputPrices.get(outputItemId) : null;
    const outputUnitPrice = price?.minPrice ?? null;
    const outputTotalPrice = outputUnitPrice !== null ? outputUnitPrice * outputQuantity : null;
    const profit = outputTotalPrice !== null ? outputTotalPrice - cost.totalCost : null;

    return {
      reagentRank: rank,
      cost,
      outputItemId,
      outputItemName: outputItemId ? (outputNameMap.get(outputItemId) ?? null) : null,
      outputQuantity,
      outputUnitPrice,
      outputTotalPrice,
      profit,
    };
  }

  return {
    recipeId,
    recipeName: recipe.name,
    qualityTierType: recipe.qualityTierType,
    affectedByMulticraft: recipe.affectedByMulticraft,
    affectedByResourcefulness: recipe.affectedByResourcefulness,
    professionId: recipe.professionId,
    professionName,
    scenarios: [buildScenario(1, costRank1, outputRank1ItemId), buildScenario(2, costRank2, outputRank2ItemId)],
  };
}

// ─── Batch: All Recipes for a Profession ────────────────────────────

export async function computeProfessionRecipeCosts(professionId: number, regionId: string): Promise<ProfessionRecipeCost[]> {
  // Load all recipes for this profession that have an output
  const profRecipes = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      categoryId: recipes.categoryId,
      qualityTierType: recipes.qualityTierType,
      affectedByMulticraft: recipes.affectedByMulticraft,
      affectedByResourcefulness: recipes.affectedByResourcefulness,
      outputItemId: recipes.outputItemId,
      outputQuantityMin: recipes.outputQuantityMin,
    })
    .from(recipes)
    .where(eq(recipes.professionId, professionId));

  if (profRecipes.length === 0) return [];

  const recipeIds = profRecipes.map((r) => r.id);

  // ── Batch-load all reagent slots and options ──────────────────────

  const allSlots = await db.select().from(recipeReagentSlots).where(inArray(recipeReagentSlots.recipeId, recipeIds));

  const slotIds = allSlots.map((s) => s.id);
  const allOptions = slotIds.length > 0 ? await db.select().from(recipeReagentSlotOptions).where(inArray(recipeReagentSlotOptions.slotId, slotIds)) : [];

  // Group slots by recipe, options by slot
  const slotsByRecipe = new Map<number, typeof allSlots>();
  for (const slot of allSlots) {
    let arr = slotsByRecipe.get(slot.recipeId);
    if (!arr) {
      arr = [];
      slotsByRecipe.set(slot.recipeId, arr);
    }
    arr.push(slot);
  }

  const optionsBySlot = new Map<number, typeof allOptions>();
  for (const opt of allOptions) {
    let arr = optionsBySlot.get(opt.slotId);
    if (!arr) {
      arr = [];
      optionsBySlot.set(opt.slotId, arr);
    }
    arr.push(opt);
  }

  // ── Batch-load all output qualities ───────────────────────────────

  const allOutputQualities = await db.select().from(recipeOutputQualities).where(inArray(recipeOutputQualities.recipeId, recipeIds));

  const outputQualitiesByRecipe = new Map<number, typeof allOutputQualities>();
  for (const oq of allOutputQualities) {
    let arr = outputQualitiesByRecipe.get(oq.recipeId);
    if (!arr) {
      arr = [];
      outputQualitiesByRecipe.set(oq.recipeId, arr);
    }
    arr.push(oq);
  }

  // ── Determine all item IDs we need prices for ─────────────────────

  const allItemIds = new Set<number>();

  // Collect reagent item IDs for both ranks
  for (const recipe of profRecipes) {
    const slots = slotsByRecipe.get(recipe.id) ?? [];
    for (const slot of slots) {
      if (slot.reagentType === 3 && !slot.required) continue;
      const slotOptions = optionsBySlot.get(slot.id) ?? [];
      for (const opt of slotOptions) {
        if (opt.itemId) allItemIds.add(opt.itemId);
      }
    }

    // Collect output item IDs
    if (recipe.outputItemId) allItemIds.add(recipe.outputItemId);
    const qualities = outputQualitiesByRecipe.get(recipe.id) ?? [];
    for (const q of qualities) {
      allItemIds.add(q.itemId);
    }
  }

  // ── Single price fetch for everything ─────────────────────────────

  const prices = await getLatestPrices(regionId, [...allItemIds]);

  // ── Look up all item names ────────────────────────────────────────

  const allItemIdArray = [...allItemIds];
  const itemRows = allItemIdArray.length > 0 ? await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, allItemIdArray)) : [];
  const itemNameMap = new Map(itemRows.map((r) => [r.id, r.name]));

  // ── Compute per-recipe ────────────────────────────────────────────

  function computeCostFromData(recipeId: number, reagentRank: 1 | 2): RecipeCostResult {
    const slots = slotsByRecipe.get(recipeId) ?? [];
    let totalCost = 0;
    let hasPriceData = true;
    const reagents: ReagentCost[] = [];

    for (const slot of slots) {
      if (slot.reagentType === 3 && !slot.required) continue;

      const slotOptions = optionsBySlot.get(slot.id) ?? [];
      if (slotOptions.length === 0) continue;

      let chosenOption = slotOptions.find((o) => o.optionIndex === 1);
      if (slot.reagentType === 1) {
        const rankOption = slotOptions.find((o) => o.optionIndex === reagentRank);
        if (rankOption) chosenOption = rankOption;
      }

      if (!chosenOption?.itemId) continue;

      const price = prices.get(chosenOption.itemId);
      const unitPrice = price?.minPrice ?? 0;
      const slotTotal = unitPrice * slot.quantity;
      if (!price) hasPriceData = false;

      reagents.push({
        slotIndex: slot.slotIndex,
        itemId: chosenOption.itemId,
        itemName: itemNameMap.get(chosenOption.itemId) ?? `Item #${chosenOption.itemId}`,
        quantity: slot.quantity,
        unitPrice,
        totalPrice: slotTotal,
      });
      totalCost += slotTotal;
    }

    return { reagents, totalCost, hasPriceData };
  }

  const results: ProfessionRecipeCost[] = [];

  for (const recipe of profRecipes) {
    const costRank1 = computeCostFromData(recipe.id, 1);
    const costRank2 = computeCostFromData(recipe.id, 2);

    const outputQuantity = recipe.outputQuantityMin;

    // Determine output items per rank
    let outputRank1ItemId: number | null = null;
    let outputRank2ItemId: number | null = null;

    if (recipe.qualityTierType === "none") {
      outputRank1ItemId = recipe.outputItemId;
      outputRank2ItemId = recipe.outputItemId;
    } else {
      const qualities = outputQualitiesByRecipe.get(recipe.id) ?? [];
      const qualityByRank = new Map(qualities.map((q) => [q.rank, q.itemId]));

      if (recipe.qualityTierType === "2rank") {
        outputRank1ItemId = qualityByRank.get(1) ?? recipe.outputItemId;
        outputRank2ItemId = qualityByRank.get(2) ?? recipe.outputItemId;
      } else if (recipe.qualityTierType === "5rank") {
        outputRank1ItemId = qualityByRank.get(4) ?? recipe.outputItemId;
        outputRank2ItemId = qualityByRank.get(5) ?? recipe.outputItemId;
      }
    }

    function buildScenario(rank: 1 | 2, cost: RecipeCostResult, outputItemId: number | null): RankScenario {
      const price = outputItemId ? prices.get(outputItemId) : null;
      const outputUnitPrice = price?.minPrice ?? null;
      const outputTotalPrice = outputUnitPrice !== null ? outputUnitPrice * outputQuantity : null;
      const profit = outputTotalPrice !== null ? outputTotalPrice - cost.totalCost : null;

      return {
        reagentRank: rank,
        cost,
        outputItemId,
        outputItemName: outputItemId ? (itemNameMap.get(outputItemId) ?? null) : null,
        outputQuantity,
        outputUnitPrice,
        outputTotalPrice,
        profit,
      };
    }

    results.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      categoryId: recipe.categoryId,
      qualityTierType: recipe.qualityTierType,
      affectedByMulticraft: recipe.affectedByMulticraft,
      affectedByResourcefulness: recipe.affectedByResourcefulness,
      scenarios: [buildScenario(1, costRank1, outputRank1ItemId), buildScenario(2, costRank2, outputRank2ItemId)],
    });
  }

  return results;
}
