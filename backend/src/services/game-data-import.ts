import { resolve } from "path";

// ─── JSON File Types ─────────────────────────────────────────────────

export interface ReagentEntry {
  itemID: number | null;
  itemName: string;
  entryTypes: string[];
  professionNames: string[];
  itemQuality: number | null;
  qualityRank: number | null;
}

export interface RecipeSlotOption {
  optionIndex: number;
  reagentItemID: number | null;
  reagentName: string;
}

export interface RecipeSlot {
  slotIndex: number;
  slotText: string;
  quantity: number;
  required: boolean;
  reagentType: number;
  options: RecipeSlotOption[];
}

export interface OutputQuality {
  rank: number;
  qualityID: number;
  itemID: number;
  itemQuality: number | null;
}

export interface SalvageTarget {
  itemID: number;
}

export interface RecipeEntry {
  recipeID: number;
  recipeName: string;
  professionSkillLineID: number;
  professionName: string;
  recipeCategoryID: number;
  categoryName: string;
  topCategoryID: number | null;
  topCategoryName: string | null;
  outputItemID: number | null;
  outputQuantityMin: number;
  outputQuantityMax: number;
  qualityIDs: number[];
  outputQualities: OutputQuality[];
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  affectedByIngenuity: boolean;
  salvageTargets: SalvageTarget[];
  reagents: RecipeSlot[];
}

export interface ProfessionCatalogData {
  reagentEntries: ReagentEntry[];
  recipeEntries: RecipeEntry[];
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function asString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) throw new Error(`${path} must be a string`);
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function asInteger(value: unknown, path: string, allowZero = false): number {
  if (!Number.isInteger(value) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) throw new Error(`${path} must be a positive integer`);
  return Number(value);
}

function asNullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : asInteger(value, path);
}

function parseReagent(value: unknown, index: number): ReagentEntry {
  const path = `reagents[${index}]`;
  const row = asRecord(value, path);
  return {
    itemID: asNullableInteger(row.itemID, `${path}.itemID`),
    itemName: asString(row.itemName, `${path}.itemName`, true),
    entryTypes: asArray(row.entryTypes, `${path}.entryTypes`).map((entry, entryIndex) => asString(entry, `${path}.entryTypes[${entryIndex}]`)),
    professionNames: asArray(row.professionNames, `${path}.professionNames`).map((name, nameIndex) => asString(name, `${path}.professionNames[${nameIndex}]`)),
    itemQuality: asNullableInteger(row.itemQuality, `${path}.itemQuality`),
    qualityRank: asNullableInteger(row.qualityRank, `${path}.qualityRank`),
  };
}

function parseRecipe(value: unknown, index: number): RecipeEntry {
  const path = `recipes[${index}]`;
  const row = asRecord(value, path);
  const qualityIDs = asArray(row.qualityIDs, `${path}.qualityIDs`).map((id, idIndex) => asInteger(id, `${path}.qualityIDs[${idIndex}]`));
  if (![0, 2, 5].includes(qualityIDs.length)) throw new Error(`${path}.qualityIDs has an unsupported rank count`);

  const outputQualities = asArray(row.outputQualities, `${path}.outputQualities`).map((entry, entryIndex) => {
    const output = asRecord(entry, `${path}.outputQualities[${entryIndex}]`);
    return {
      rank: asInteger(output.rank, `${path}.outputQualities[${entryIndex}].rank`),
      qualityID: asInteger(output.qualityID, `${path}.outputQualities[${entryIndex}].qualityID`),
      itemID: asInteger(output.itemID, `${path}.outputQualities[${entryIndex}].itemID`),
      itemQuality: asNullableInteger(output.itemQuality, `${path}.outputQualities[${entryIndex}].itemQuality`),
    };
  });
  const salvageTargets = asArray(row.salvageTargets, `${path}.salvageTargets`).map((entry, entryIndex) => {
    const target = asRecord(entry, `${path}.salvageTargets[${entryIndex}]`);
    return { itemID: asInteger(target.itemID, `${path}.salvageTargets[${entryIndex}].itemID`) };
  });
  const reagents = asArray(row.reagents, `${path}.reagents`).map((entry, entryIndex) => {
    const slotPath = `${path}.reagents[${entryIndex}]`;
    const slot = asRecord(entry, slotPath);
    return {
      slotIndex: asInteger(slot.slotIndex, `${slotPath}.slotIndex`),
      slotText: asString(slot.slotText, `${slotPath}.slotText`, true),
      quantity: asInteger(slot.quantity, `${slotPath}.quantity`),
      required: asBoolean(slot.required, `${slotPath}.required`),
      reagentType: asInteger(slot.reagentType, `${slotPath}.reagentType`, true),
      options: asArray(slot.options, `${slotPath}.options`).map((entryOption, optionIndex) => {
        const optionPath = `${slotPath}.options[${optionIndex}]`;
        const option = asRecord(entryOption, optionPath);
        return {
          optionIndex: asInteger(option.optionIndex, `${optionPath}.optionIndex`, true),
          reagentItemID: asNullableInteger(option.reagentItemID, `${optionPath}.reagentItemID`),
          reagentName: asString(option.reagentName, `${optionPath}.reagentName`),
        };
      }),
    };
  });
  const outputQuantityMin = asInteger(row.outputQuantityMin, `${path}.outputQuantityMin`);
  const outputQuantityMax = asInteger(row.outputQuantityMax, `${path}.outputQuantityMax`);
  if (outputQuantityMin > outputQuantityMax) throw new Error(`${path} output quantity range is invalid`);
  if (new Set(outputQualities.map((output) => output.rank)).size !== outputQualities.length) {
    throw new Error(`${path} has duplicate output-quality ranks`);
  }
  if (new Set(reagents.map((slot) => slot.slotIndex)).size !== reagents.length) {
    throw new Error(`${path} has duplicate reagent slot indexes`);
  }
  for (const slot of reagents) {
    if (new Set(slot.options.map((option) => option.optionIndex)).size !== slot.options.length) {
      throw new Error(`${path}.reagents[${slot.slotIndex}] has duplicate option indexes`);
    }
  }

  return {
    recipeID: asInteger(row.recipeID, `${path}.recipeID`),
    recipeName: asString(row.recipeName, `${path}.recipeName`),
    professionSkillLineID: asInteger(row.professionSkillLineID, `${path}.professionSkillLineID`),
    professionName: asString(row.professionName, `${path}.professionName`),
    recipeCategoryID: asInteger(row.recipeCategoryID, `${path}.recipeCategoryID`),
    categoryName: asString(row.categoryName, `${path}.categoryName`),
    topCategoryID: asNullableInteger(row.topCategoryID, `${path}.topCategoryID`),
    topCategoryName: row.topCategoryName === null ? null : asString(row.topCategoryName, `${path}.topCategoryName`),
    outputItemID: asNullableInteger(row.outputItemID, `${path}.outputItemID`),
    outputQuantityMin,
    outputQuantityMax,
    qualityIDs,
    outputQualities,
    affectedByMulticraft: asBoolean(row.affectedByMulticraft, `${path}.affectedByMulticraft`),
    affectedByResourcefulness: asBoolean(row.affectedByResourcefulness, `${path}.affectedByResourcefulness`),
    affectedByIngenuity: asBoolean(row.affectedByIngenuity, `${path}.affectedByIngenuity`),
    salvageTargets,
    reagents,
  };
}

export function parseProfessionCatalog(reagentsRaw: unknown, recipesRaw: unknown): ProfessionCatalogData {
  const reagentEntries = asArray(reagentsRaw, "reagents").map(parseReagent);
  const recipeEntries = asArray(recipesRaw, "recipes").map(parseRecipe);
  if (reagentEntries.length === 0 || recipeEntries.length === 0) throw new Error("Profession Catalog sources must not be empty");

  const itemIds = new Set<number>();
  for (const item of reagentEntries) {
    if (item.itemID === null) continue;
    if (itemIds.has(item.itemID)) throw new Error(`Duplicate Profession Catalog item ${item.itemID}`);
    itemIds.add(item.itemID);
  }
  const recipeIds = new Set<number>();
  const professionNames = new Map<number, string>();
  const categoryDefinitions = new Map<number, string>();
  for (const recipe of recipeEntries) {
    if (recipeIds.has(recipe.recipeID)) throw new Error(`Duplicate Profession Catalog recipe ${recipe.recipeID}`);
    recipeIds.add(recipe.recipeID);
    const knownName = professionNames.get(recipe.professionSkillLineID);
    if (knownName && knownName !== recipe.professionName) throw new Error(`Profession ${recipe.professionSkillLineID} has conflicting names`);
    professionNames.set(recipe.professionSkillLineID, recipe.professionName);
    const categoryDefinition = JSON.stringify([
      recipe.professionSkillLineID,
      recipe.categoryName,
      recipe.topCategoryID,
      recipe.topCategoryName,
    ]);
    const knownDefinition = categoryDefinitions.get(recipe.recipeCategoryID);
    if (knownDefinition && knownDefinition !== categoryDefinition) {
      throw new Error(`Recipe category ${recipe.recipeCategoryID} has conflicting definitions`);
    }
    categoryDefinitions.set(recipe.recipeCategoryID, categoryDefinition);
  }
  return { reagentEntries, recipeEntries };
}

export async function readBundledProfessionCatalog(): Promise<ProfessionCatalogData> {
  const dataDir = resolve(import.meta.dir, "../../../game-data-parsed");
  const [reagentsRaw, recipesRaw] = await Promise.all([
    Bun.file(resolve(dataDir, "midnight_reagents_used.json")).json(),
    Bun.file(resolve(dataDir, "midnight_recipes_simplified.json")).json(),
  ]);
  return parseProfessionCatalog(reagentsRaw, recipesRaw);
}

// ─── Import Logic ────────────────────────────────────────────────────

export async function publishProfessionCatalog(
  { reagentEntries, recipeEntries }: ProfessionCatalogData,
  options: { beforeCommit?: () => void | Promise<void> } = {},
): Promise<void> {
  const [{ sql }, { db }, schema] = await Promise.all([
    import("drizzle-orm"),
    import("../db"),
    import("../db/schema"),
  ]);
  const {
    professions,
    recipeCategories,
    items,
    itemProfessions,
    recipes,
    recipeOutputQualities,
    recipeReagentSlots,
    recipeReagentSlotOptions,
    recipeSalvageTargets,
  } = schema;
  await db.transaction(async (tx) => {

  // Replace profession-owned relationships in reverse FK order. The item
  // catalog is shared with auction ingestion, so market-only items remain.
  await tx.delete(recipeSalvageTargets);
  await tx.delete(recipeReagentSlotOptions);
  await tx.delete(recipeReagentSlots);
  await tx.delete(recipeOutputQualities);
  await tx.delete(recipes);
  await tx.delete(itemProfessions);
  await tx.delete(recipeCategories);
  await tx.delete(professions);
  await tx.update(items).set({ isReagent: false, isCraftedOutput: false, qualityRank: null });

  // a. Professions — extract unique from recipes
  const professionMap = new Map<number, string>();
  for (const r of recipeEntries) {
    professionMap.set(r.professionSkillLineID, r.professionName);
  }
  if (professionMap.size > 0) {
    await tx.insert(professions).values(Array.from(professionMap, ([id, name]) => ({ id, name })));
  }
  // b. Recipe categories — extract unique from recipes
  const categoryMap = new Map<number, { name: string; professionId: number; topCategoryId: number | null; topCategoryName: string | null }>();
  for (const r of recipeEntries) {
    if (!categoryMap.has(r.recipeCategoryID)) {
      categoryMap.set(r.recipeCategoryID, {
        name: r.categoryName,
        professionId: r.professionSkillLineID,
        topCategoryId: r.topCategoryID,
        topCategoryName: r.topCategoryName,
      });
    }
  }
  if (categoryMap.size > 0) {
    await tx.insert(recipeCategories).values(
      Array.from(categoryMap, ([id, cat]) => ({
        id,
        name: cat.name,
        professionId: cat.professionId,
        topCategoryId: cat.topCategoryId,
        topCategoryName: cat.topCategoryName,
      })),
    );
  }
  // c. Items — from reagents file
  const itemRows = reagentEntries
    .filter((r): r is ReagentEntry & { itemID: number } => r.itemID != null && r.itemID !== 0)
    .map((r) => {
      const itemName = r.itemName.trim();
      return {
        id: r.itemID,
        name: itemName || `Item #${r.itemID}`,
        itemQuality: r.itemQuality,
        qualityRank: r.qualityRank,
        isReagent: r.entryTypes.includes("reagent"),
        isCraftedOutput: r.entryTypes.includes("craftedOutput"),
        metadataStatus: itemName ? "complete" : "pending",
      };
    });
  if (itemRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < itemRows.length; i += BATCH) {
      const batch = itemRows.slice(i, i + BATCH);
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoUpdate({
          target: items.id,
          set: {
            name: sql`CASE WHEN ${items.metadataStatus} = 'complete' THEN ${items.name} ELSE excluded.name END`,
            itemQuality: sql`CASE WHEN ${items.metadataStatus} = 'complete' THEN ${items.itemQuality} ELSE excluded.item_quality END`,
            qualityRank: sql`excluded.quality_rank`,
            isReagent: sql`excluded.is_reagent`,
            isCraftedOutput: sql`excluded.is_crafted_output`,
            metadataStatus: sql`CASE WHEN ${items.metadataStatus} = 'complete' THEN ${items.metadataStatus} ELSE excluded.metadata_status END`,
          },
        });
    }
  }
  // Also ensure every outputItemID from recipes exists in items
  const existingItemIds = new Set(
    reagentEntries
      .filter((r): r is ReagentEntry & { itemID: number } => r.itemID != null && r.itemID !== 0)
      .map((r) => r.itemID),
  );
  const extraItems: { id: number; name: string }[] = [];
  for (const r of recipeEntries) {
    if (r.outputItemID != null && r.outputItemID !== 0 && !existingItemIds.has(r.outputItemID)) {
      existingItemIds.add(r.outputItemID);
      extraItems.push({ id: r.outputItemID, name: r.recipeName });
    }
    // Also add items from outputQualities
    for (const oq of r.outputQualities) {
      if (oq.itemID != null && oq.itemID !== 0 && !existingItemIds.has(oq.itemID)) {
        existingItemIds.add(oq.itemID);
        extraItems.push({ id: oq.itemID, name: r.recipeName });
      }
    }
    // Also add items from salvageTargets
    for (const st of r.salvageTargets) {
      if (st.itemID != null && st.itemID !== 0 && !existingItemIds.has(st.itemID)) {
        existingItemIds.add(st.itemID);
        extraItems.push({ id: st.itemID, name: "" });
      }
    }
    // Also add items from reagent slot options
    for (const slot of r.reagents) {
      for (const opt of slot.options) {
        if (opt.reagentItemID != null && opt.reagentItemID !== 0 && !existingItemIds.has(opt.reagentItemID)) {
          existingItemIds.add(opt.reagentItemID);
          extraItems.push({ id: opt.reagentItemID, name: opt.reagentName });
        }
      }
    }
  }
  if (extraItems.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < extraItems.length; i += BATCH) {
      const batch = extraItems.slice(i, i + BATCH).map((item) => ({
        id: item.id,
        name: item.name || `Item #${item.id}`,
        isCraftedOutput: true,
        metadataStatus: item.name ? "complete" : "pending",
      }));
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoUpdate({
          target: items.id,
          set: {
            name: sql`CASE WHEN ${items.metadataStatus} = 'complete' THEN ${items.name} ELSE excluded.name END`,
            isCraftedOutput: true,
            metadataStatus: sql`CASE WHEN ${items.metadataStatus} = 'complete' THEN ${items.metadataStatus} ELSE excluded.metadata_status END`,
          },
        });
    }
  }

  // d. Item-profession links
  // Build a map from profession name -> profession ID
  const profNameToId = new Map<string, number>();
  for (const [id, name] of professionMap) {
    profNameToId.set(name, id);
  }
  const ipRows: { itemId: number; professionId: number }[] = [];
  for (const r of reagentEntries) {
    if (r.itemID == null || r.itemID === 0) continue;
    for (const profName of r.professionNames) {
      const profId = profNameToId.get(profName);
      if (profId != null) {
        ipRows.push({ itemId: r.itemID, professionId: profId });
      }
    }
  }
  if (ipRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < ipRows.length; i += BATCH) {
      await tx.insert(itemProfessions).values(ipRows.slice(i, i + BATCH));
    }
  }
  // e. Recipes
  const recipeRows = recipeEntries.map((r) => {
    const qLen = r.qualityIDs.length;
    const qualityTierType = qLen >= 5 ? "5rank" : qLen === 2 ? "2rank" : "none";
    return {
      id: r.recipeID,
      name: r.recipeName,
      professionId: r.professionSkillLineID,
      categoryId: r.recipeCategoryID,
      outputItemId: r.outputItemID ?? null,
      outputQuantityMin: r.outputQuantityMin,
      outputQuantityMax: r.outputQuantityMax,
      qualityTierType,
      affectedByMulticraft: r.affectedByMulticraft,
      affectedByResourcefulness: r.affectedByResourcefulness,
      affectedByIngenuity: r.affectedByIngenuity,
    };
  });
  if (recipeRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < recipeRows.length; i += BATCH) {
      await tx.insert(recipes).values(recipeRows.slice(i, i + BATCH));
    }
  }
  // f. Recipe output qualities
  const oqRows: { recipeId: number; rank: number; qualityId: number; itemId: number; itemQuality: number | null }[] = [];
  for (const r of recipeEntries) {
    for (const oq of r.outputQualities) {
      oqRows.push({
        recipeId: r.recipeID,
        rank: oq.rank,
        qualityId: oq.qualityID,
        itemId: oq.itemID,
        itemQuality: oq.itemQuality,
      });
    }
  }
  if (oqRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < oqRows.length; i += BATCH) {
      await tx.insert(recipeOutputQualities).values(oqRows.slice(i, i + BATCH));
    }
  }
  // g. Recipe reagent slots
  const slotRows = recipeEntries.flatMap((recipe) =>
    recipe.reagents.map((slot) => ({
      recipeId: recipe.recipeID,
      slotIndex: slot.slotIndex,
      quantity: slot.quantity,
      required: slot.required,
      reagentType: slot.reagentType,
      slotText: slot.slotText,
    })),
  );
  const slotIdByRecipeAndIndex = new Map<string, number>();
  const BATCH = 500;
  for (let i = 0; i < slotRows.length; i += BATCH) {
    const insertedSlots = await tx
      .insert(recipeReagentSlots)
      .values(slotRows.slice(i, i + BATCH))
      .returning({
        id: recipeReagentSlots.id,
        recipeId: recipeReagentSlots.recipeId,
        slotIndex: recipeReagentSlots.slotIndex,
      });
    for (const slot of insertedSlots) {
      slotIdByRecipeAndIndex.set(`${slot.recipeId}:${slot.slotIndex}`, slot.id);
    }
  }

  // h. Recipe reagent slot options
  const optRows = recipeEntries.flatMap((recipe) =>
    recipe.reagents.flatMap((slot) => {
      const slotId = slotIdByRecipeAndIndex.get(`${recipe.recipeID}:${slot.slotIndex}`);
      if (slotId === undefined) throw new Error(`Missing published slot ${recipe.recipeID}:${slot.slotIndex}`);
      return slot.options.map((option) => ({
        slotId,
        optionIndex: option.optionIndex,
        itemId: option.reagentItemID,
        reagentName: option.reagentName,
      }));
    }),
  );
  for (let i = 0; i < optRows.length; i += BATCH) {
    await tx.insert(recipeReagentSlotOptions).values(optRows.slice(i, i + BATCH));
  }
  // i. Recipe salvage targets
  const stRows: { recipeId: number; itemId: number }[] = [];
  for (const r of recipeEntries) {
    for (const st of r.salvageTargets) {
      stRows.push({ recipeId: r.recipeID, itemId: st.itemID });
    }
  }
  if (stRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < stRows.length; i += BATCH) {
      await tx.insert(recipeSalvageTargets).values(stRows.slice(i, i + BATCH));
    }
  }
  await options.beforeCommit?.();
  });
}
