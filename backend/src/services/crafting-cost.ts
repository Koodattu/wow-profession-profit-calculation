import { eq, and, desc, inArray, sql, gte } from "drizzle-orm";
import { db } from "../db";
import { professions, recipes, recipeOutputQualities, recipeReagentSlots, recipeReagentSlotOptions, recipeSalvageTargets, commoditySnapshots, realmSnapshots, items } from "../db/schema";
import { getSalvagingRecipeConfigMap } from "./salvaging-config";

// ─── Types ───────────────────────────────────────────────────────────

export interface PriceData {
  minPrice: number;
  avgPrice: number;
  medianPrice: number;
}

interface ReagentCost {
  slotIndex: number;
  itemId: number;
  itemName: string;
  itemQuality: number | null;
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
  outputRank: 1 | 2;
  cost: RecipeCostResult;
  outputItemId: number | null;
  outputItemName: string | null;
  outputItemQuality: number | null;
  outputQuantity: number;
  outputUnitPrice: number | null;
  outputTotalPrice: number | null;
  profit: number | null;
  isSalvage?: boolean;
  scenarioLabel?: string;
  inputItemId?: number;
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

// ─── Get Latest Commodity Prices ────────────────────────────────────

export async function getLatestCommodityPrices(regionId: string, itemIds: number[]): Promise<Map<number, PriceData>> {
  if (itemIds.length === 0) return new Map();

  // Get the most recent commodity snapshot time for this region
  const [latest] = await db
    .select({ maxTime: sql<string>`max(${commoditySnapshots.snapshotTime})::text` })
    .from(commoditySnapshots)
    .where(eq(commoditySnapshots.regionId, regionId));

  if (!latest?.maxTime) return new Map();

  const latestTime = new Date(latest.maxTime);

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

// ─── Get Latest Realm Prices (Region Average) ───────────────────────

export async function getLatestRealmPrices(regionId: string, itemIds: number[]): Promise<Map<number, PriceData>> {
  return getLatestRealmPricesForConnectedRealm(regionId, itemIds);
}

export async function getLatestRealmPricesForConnectedRealm(regionId: string, itemIds: number[], connectedRealmId?: number): Promise<Map<number, PriceData>> {
  if (itemIds.length === 0) return new Map();

  // Get the most recent realm snapshot time for this region
  const [latestRealm] = await db
    .select({ maxTime: sql<string>`max(${realmSnapshots.snapshotTime})::text` })
    .from(realmSnapshots)
    .where(eq(realmSnapshots.regionId, regionId));

  if (!latestRealm?.maxTime) return new Map();

  // Use a 4-hour window to capture all realms from the same sync cycle
  const latestTime = new Date(latestRealm.maxTime);
  const windowStart = new Date(latestTime.getTime() - 4 * 60 * 60 * 1000);

  const BATCH = 500;
  const priceMap = new Map<number, PriceData>();

  for (let i = 0; i < itemIds.length; i += BATCH) {
    const batch = itemIds.slice(i, i + BATCH);

    const whereConditions = [eq(realmSnapshots.regionId, regionId), inArray(realmSnapshots.itemId, batch), gte(realmSnapshots.snapshotTime, windowStart)];
    if (connectedRealmId !== undefined) {
      whereConditions.push(eq(realmSnapshots.connectedRealmId, connectedRealmId));
    }

    if (connectedRealmId !== undefined) {
      const rows = await db
        .select({
          itemId: realmSnapshots.itemId,
          minPrice: sql<number>`(array_agg(${realmSnapshots.minBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
          avgPrice: sql<number>`(array_agg(coalesce(${realmSnapshots.avgBuyout}, ${realmSnapshots.minBuyout}) ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
          medianPrice: sql<number>`(array_agg(coalesce(${realmSnapshots.medianBuyout}, ${realmSnapshots.minBuyout}) ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`,
        })
        .from(realmSnapshots)
        .where(and(...whereConditions))
        .groupBy(realmSnapshots.itemId);

      for (const row of rows) {
        priceMap.set(Number(row.itemId), {
          minPrice: Number(row.minPrice),
          avgPrice: Number(row.avgPrice),
          medianPrice: Number(row.medianPrice),
        });
      }
      continue;
    }

    const latestPerRealm = db
      .select({
        itemId: realmSnapshots.itemId,
        connectedRealmId: realmSnapshots.connectedRealmId,
        minBuyout: sql<number>`(array_agg(${realmSnapshots.minBuyout} ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`.as("min_buyout_latest"),
        avgBuyout: sql<number>`(array_agg(coalesce(${realmSnapshots.avgBuyout}, ${realmSnapshots.minBuyout}) ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`.as(
          "avg_buyout_latest",
        ),
        medianBuyout: sql<number>`(array_agg(coalesce(${realmSnapshots.medianBuyout}, ${realmSnapshots.minBuyout}) ORDER BY ${realmSnapshots.snapshotTime} DESC))[1]`.as(
          "median_buyout_latest",
        ),
      })
      .from(realmSnapshots)
      .where(and(...whereConditions))
      .groupBy(realmSnapshots.itemId, realmSnapshots.connectedRealmId)
      .as("latest_per_realm");

    const rows = await db
      .select({
        itemId: latestPerRealm.itemId,
        minPrice: sql<number>`avg(${latestPerRealm.minBuyout})::bigint`,
        avgPrice: sql<number>`avg(${latestPerRealm.avgBuyout})::bigint`,
        medianPrice: sql<number>`avg(${latestPerRealm.medianBuyout})::bigint`,
      })
      .from(latestPerRealm)
      .groupBy(latestPerRealm.itemId);

    for (const row of rows) {
      priceMap.set(Number(row.itemId), {
        minPrice: Number(row.minPrice),
        avgPrice: Number(row.avgPrice),
        medianPrice: Number(row.medianPrice),
      });
    }
  }

  const realmScope = connectedRealmId !== undefined ? `connected realm ${connectedRealmId}` : "region average";
  console.log(`[CraftingCost] Fetched realm prices for ${priceMap.size}/${itemIds.length} items in region ${regionId} (${realmScope})`);
  return priceMap;
}

// ─── Get Latest Prices (Commodity + Realm Fallback) ─────────────────

export async function getLatestPrices(regionId: string, itemIds: number[], connectedRealmId?: number): Promise<Map<number, PriceData>> {
  if (itemIds.length === 0) return new Map();

  // First: try commodity snapshots
  const priceMap = await getLatestCommodityPrices(regionId, itemIds);

  // Second: for items not found in commodity data, try realm snapshots
  const missingItemIds = itemIds.filter((id) => !priceMap.has(id));
  if (missingItemIds.length > 0) {
    const realmPrices = await getLatestRealmPricesForConnectedRealm(regionId, missingItemIds, connectedRealmId);
    for (const [itemId, price] of realmPrices) {
      priceMap.set(itemId, price);
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
  const itemRows = itemIds.length > 0 ? await db.select({ id: items.id, name: items.name, itemQuality: items.itemQuality }).from(items).where(inArray(items.id, itemIds)) : [];
  const itemMetaMap = new Map(itemRows.map((r) => [r.id, { name: r.name, itemQuality: r.itemQuality }]));

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
      itemName: itemMetaMap.get(sel.itemId)?.name ?? `Item #${sel.itemId}`,
      itemQuality: itemMetaMap.get(sel.itemId)?.itemQuality ?? null,
      quantity: sel.quantity,
      unitPrice,
      totalPrice: slotTotal,
    });
    totalCost += slotTotal;
  }

  return { reagents, totalCost, hasPriceData };
}

interface SalvageInputOption {
  itemId: number;
  itemName: string;
  itemQuality: number | null;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  hasPriceData: boolean;
}

async function computeSalvageInputOptions(
  recipeId: number,
  regionId: string,
  inputQuantity: number,
  connectedRealmId?: number,
): Promise<SalvageInputOption[]> {
  const salvageRows = await db
    .select({ itemId: recipeSalvageTargets.itemId })
    .from(recipeSalvageTargets)
    .where(eq(recipeSalvageTargets.recipeId, recipeId));

  const itemIds = [...new Set(salvageRows.map((row) => row.itemId))];
  if (itemIds.length === 0) return [];

  const [prices, itemRows] = await Promise.all([
    getLatestPrices(regionId, itemIds, connectedRealmId),
    db.select({ id: items.id, name: items.name, itemQuality: items.itemQuality }).from(items).where(inArray(items.id, itemIds)),
  ]);

  const itemMetaMap = new Map(itemRows.map((row) => [row.id, row]));

  const options = itemIds.map((itemId) => {
    const price = prices.get(itemId);
    const unitPrice = price?.minPrice ?? null;
    const totalPrice = unitPrice !== null ? unitPrice * inputQuantity : 0;

    return {
      itemId,
      itemName: itemMetaMap.get(itemId)?.name ?? `Item #${itemId}`,
      itemQuality: itemMetaMap.get(itemId)?.itemQuality ?? null,
      quantity: inputQuantity,
      unitPrice,
      totalPrice,
      hasPriceData: unitPrice !== null,
    };
  });

  options.sort((a, b) => {
    if (a.hasPriceData !== b.hasPriceData) return a.hasPriceData ? -1 : 1;
    return a.totalPrice - b.totalPrice;
  });

  return options;
}

// ─── Compute Recipe Profit ──────────────────────────────────────────

export async function computeRecipeProfit(recipeId: number, regionId: string, connectedRealmId?: number): Promise<RecipeProfitResult> {
  // Load the recipe
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
  if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

  // Load profession name
  const [profession] = await db.select({ name: professions.name }).from(professions).where(eq(professions.id, recipe.professionId));
  const professionName = profession?.name ?? "Unknown";

  const [reagentSlots, salvageTargets, salvagingConfigMap] = await Promise.all([
    db.select({ id: recipeReagentSlots.id }).from(recipeReagentSlots).where(eq(recipeReagentSlots.recipeId, recipeId)),
    db.select({ itemId: recipeSalvageTargets.itemId }).from(recipeSalvageTargets).where(eq(recipeSalvageTargets.recipeId, recipeId)),
    getSalvagingRecipeConfigMap(),
  ]);

  const salvageConfig = salvagingConfigMap.get(recipeId);
  const hasSalvageTargets = salvageTargets.length > 0;
  const isSalvageMode = hasSalvageTargets && (reagentSlots.length === 0 || salvageConfig?.useSalvageInputs === true);

  // Compute cost for both ranks
  const [costRank1, costRank2] = isSalvageMode ? [null, null] : await Promise.all([computeRecipeCost(recipeId, regionId, 1), computeRecipeCost(recipeId, regionId, 2)]);

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
  const [outputPricesDefault, outputPricesSelectedRealm] = await Promise.all([
    getLatestPrices(regionId, outputItemIds),
    connectedRealmId !== undefined ? getLatestPrices(regionId, outputItemIds, connectedRealmId) : Promise.resolve(null),
  ]);

  // Look up output item names
  const outputItemRows =
    outputItemIds.length > 0
      ? await db
          .select({ id: items.id, name: items.name, itemQuality: items.itemQuality, isReagent: items.isReagent, isCraftedOutput: items.isCraftedOutput })
          .from(items)
          .where(inArray(items.id, outputItemIds))
      : [];
  const outputMetaMap = new Map(outputItemRows.map((row) => [row.id, row]));

  if (isSalvageMode) {
    const inputQuantity = salvageConfig?.inputQuantity ?? (recipe.name === "Recycling" ? 5 : 1);
    const salvageInputOptions = await computeSalvageInputOptions(recipeId, regionId, inputQuantity, connectedRealmId);
    const outputItemId = outputRank1ItemId;
    const outputMeta = outputItemId ? outputMetaMap.get(outputItemId) : null;
    const useSelectedRealmPrice = Boolean(connectedRealmId !== undefined && outputMeta && outputMeta.isCraftedOutput && !outputMeta.isReagent && outputPricesSelectedRealm);
    const sourceMap = useSelectedRealmPrice ? outputPricesSelectedRealm! : outputPricesDefault;
    const outputPrice = outputItemId ? sourceMap.get(outputItemId) : null;
    const outputUnitPrice = outputPrice?.minPrice ?? null;
    const outputTotalPrice = outputUnitPrice !== null ? outputUnitPrice * outputQuantity : null;

    const scenarios: RankScenario[] = salvageInputOptions.map((inputOption) => {
      const reagentRow: ReagentCost = {
        slotIndex: 1,
        itemId: inputOption.itemId,
        itemName: inputOption.itemName,
        itemQuality: inputOption.itemQuality,
        quantity: inputOption.quantity,
        unitPrice: inputOption.unitPrice ?? 0,
        totalPrice: inputOption.totalPrice,
      };

      const cost: RecipeCostResult = {
        reagents: [reagentRow],
        totalCost: reagentRow.totalPrice,
        hasPriceData: inputOption.hasPriceData,
      };

      return {
        reagentRank: 1,
        outputRank: 1,
        cost,
        outputItemId,
        outputItemName: outputMeta?.name ?? null,
        outputItemQuality: outputMeta?.itemQuality ?? null,
        outputQuantity,
        outputUnitPrice,
        outputTotalPrice,
        profit: outputTotalPrice !== null ? outputTotalPrice - cost.totalCost : null,
        isSalvage: true,
        scenarioLabel: `${inputOption.itemName} ×${inputQuantity}`,
        inputItemId: inputOption.itemId,
      };
    });

    return {
      recipeId,
      recipeName: recipe.name,
      qualityTierType: recipe.qualityTierType,
      affectedByMulticraft: recipe.affectedByMulticraft,
      affectedByResourcefulness: recipe.affectedByResourcefulness,
      professionId: recipe.professionId,
      professionName,
      scenarios,
    };
  }

  // Build scenarios
  function buildScenario(rank: 1 | 2, outputRank: 1 | 2, cost: RecipeCostResult, outputItemId: number | null): RankScenario {
    const outputMeta = outputItemId ? outputMetaMap.get(outputItemId) : null;
    const useSelectedRealmPrice = Boolean(connectedRealmId !== undefined && outputMeta && outputMeta.isCraftedOutput && !outputMeta.isReagent && outputPricesSelectedRealm);
    const sourceMap = useSelectedRealmPrice ? outputPricesSelectedRealm! : outputPricesDefault;
    const price = outputItemId ? sourceMap.get(outputItemId) : null;
    const outputUnitPrice = price?.minPrice ?? null;
    const outputTotalPrice = outputUnitPrice !== null ? outputUnitPrice * outputQuantity : null;
    const profit = outputTotalPrice !== null ? outputTotalPrice - cost.totalCost : null;

    return {
      reagentRank: rank,
      outputRank,
      cost,
      outputItemId,
      outputItemName: outputMeta?.name ?? null,
      outputItemQuality: outputMeta?.itemQuality ?? null,
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
    scenarios: [
      buildScenario(1, 1, costRank1!, outputRank1ItemId),
      buildScenario(2, 2, costRank2!, outputRank2ItemId),
      buildScenario(1, 2, costRank1!, outputRank2ItemId),
    ],
  };
}

// ─── Batch: All Recipes for a Profession ────────────────────────────

export async function computeProfessionRecipeCosts(professionId: number, regionId: string, connectedRealmId?: number): Promise<ProfessionRecipeCost[]> {
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
  const allSalvageTargets = await db.select().from(recipeSalvageTargets).where(inArray(recipeSalvageTargets.recipeId, recipeIds));
  const salvagingConfigMap = await getSalvagingRecipeConfigMap();

  const outputQualitiesByRecipe = new Map<number, typeof allOutputQualities>();
  for (const oq of allOutputQualities) {
    let arr = outputQualitiesByRecipe.get(oq.recipeId);
    if (!arr) {
      arr = [];
      outputQualitiesByRecipe.set(oq.recipeId, arr);
    }
    arr.push(oq);
  }

  const salvageTargetsByRecipe = new Map<number, typeof allSalvageTargets>();
  for (const target of allSalvageTargets) {
    let arr = salvageTargetsByRecipe.get(target.recipeId);
    if (!arr) {
      arr = [];
      salvageTargetsByRecipe.set(target.recipeId, arr);
    }
    arr.push(target);
  }

  // ── Determine all item IDs we need prices for ─────────────────────

  const allItemIds = new Set<number>();

  // Collect reagent item IDs for both ranks
  for (const recipe of profRecipes) {
    const salvageTargets = salvageTargetsByRecipe.get(recipe.id) ?? [];
    const salvageConfig = salvagingConfigMap.get(recipe.id);
    const shouldUseSalvageInputs = salvageTargets.length > 0 && ((slotsByRecipe.get(recipe.id) ?? []).length === 0 || salvageConfig?.useSalvageInputs === true);

    if (shouldUseSalvageInputs) {
      for (const target of salvageTargets) {
        allItemIds.add(target.itemId);
      }
    }

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
  const itemRows =
    allItemIdArray.length > 0
      ? await db
          .select({
            id: items.id,
            name: items.name,
            itemQuality: items.itemQuality,
            isReagent: items.isReagent,
            isCraftedOutput: items.isCraftedOutput,
          })
          .from(items)
          .where(inArray(items.id, allItemIdArray))
      : [];
  const itemMetaMap = new Map(itemRows.map((row) => [row.id, row]));

  const outputItemIds = new Set<number>();
  for (const recipe of profRecipes) {
    if (recipe.outputItemId) outputItemIds.add(recipe.outputItemId);
    const qualities = outputQualitiesByRecipe.get(recipe.id) ?? [];
    for (const quality of qualities) {
      outputItemIds.add(quality.itemId);
    }
  }

  const outputItemIdArray = [...outputItemIds];
  const selectedRealmOutputPrices = connectedRealmId !== undefined && outputItemIdArray.length > 0 ? await getLatestPrices(regionId, outputItemIdArray, connectedRealmId) : null;

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
        itemName: itemMetaMap.get(chosenOption.itemId)?.name ?? `Item #${chosenOption.itemId}`,
        itemQuality: itemMetaMap.get(chosenOption.itemId)?.itemQuality ?? null,
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
    const salvageTargets = salvageTargetsByRecipe.get(recipe.id) ?? [];
    const salvageConfig = salvagingConfigMap.get(recipe.id);
    const shouldUseSalvageInputs = salvageTargets.length > 0 && ((slotsByRecipe.get(recipe.id) ?? []).length === 0 || salvageConfig?.useSalvageInputs === true);

    let costRank1 = computeCostFromData(recipe.id, 1);
    let costRank2 = computeCostFromData(recipe.id, 2);

    if (shouldUseSalvageInputs) {
      const inputQuantity = salvageConfig?.inputQuantity ?? (recipe.name === "Recycling" ? 5 : 1);
      const cheapestInput = salvageTargets
        .map((target) => {
          const price = prices.get(target.itemId);
          const unitPrice = price?.minPrice ?? 0;
          return {
            itemId: target.itemId,
            itemName: itemMetaMap.get(target.itemId)?.name ?? `Item #${target.itemId}`,
            itemQuality: itemMetaMap.get(target.itemId)?.itemQuality ?? null,
            unitPrice,
            totalPrice: unitPrice * inputQuantity,
            hasPriceData: Boolean(price),
          };
        })
        .sort((a, b) => {
          if (a.hasPriceData !== b.hasPriceData) return a.hasPriceData ? -1 : 1;
          return a.totalPrice - b.totalPrice;
        })[0];

      if (cheapestInput) {
        const salvageCost: RecipeCostResult = {
          reagents: [
            {
              slotIndex: 1,
              itemId: cheapestInput.itemId,
              itemName: cheapestInput.itemName,
              itemQuality: cheapestInput.itemQuality,
              quantity: inputQuantity,
              unitPrice: cheapestInput.unitPrice,
              totalPrice: cheapestInput.totalPrice,
            },
          ],
          totalCost: cheapestInput.totalPrice,
          hasPriceData: cheapestInput.hasPriceData,
        };

        costRank1 = salvageCost;
        costRank2 = salvageCost;
      }
    }

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

    function buildScenario(rank: 1 | 2, outputRank: 1 | 2, cost: RecipeCostResult, outputItemId: number | null): RankScenario {
      const outputMeta = outputItemId ? itemMetaMap.get(outputItemId) : null;
      const useSelectedRealmPrice = Boolean(connectedRealmId !== undefined && outputMeta && outputMeta.isCraftedOutput && !outputMeta.isReagent && selectedRealmOutputPrices);
      const sourceMap = useSelectedRealmPrice ? selectedRealmOutputPrices! : prices;
      const price = outputItemId ? sourceMap.get(outputItemId) : null;
      const outputUnitPrice = price?.minPrice ?? null;
      const outputTotalPrice = outputUnitPrice !== null ? outputUnitPrice * outputQuantity : null;
      const profit = outputTotalPrice !== null ? outputTotalPrice - cost.totalCost : null;

      return {
        reagentRank: rank,
        outputRank,
        cost,
        outputItemId,
        outputItemName: outputMeta?.name ?? null,
        outputItemQuality: outputMeta?.itemQuality ?? null,
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
      scenarios: [buildScenario(1, 1, costRank1, outputRank1ItemId), buildScenario(2, 2, costRank2, outputRank2ItemId), buildScenario(1, 2, costRank1, outputRank2ItemId)],
    });
  }

  return results;
}
