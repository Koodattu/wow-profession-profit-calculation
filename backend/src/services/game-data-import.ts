import { resolve } from "path";
import { db } from "../db";
import {
  professions,
  recipeCategories,
  items,
  itemProfessions,
  recipes,
  recipeOutputQualities,
  recipeReagentSlots,
  recipeReagentSlotOptions,
  recipeSalvageTargets,
} from "../db/schema";

// ─── JSON File Types ─────────────────────────────────────────────────

interface ReagentEntry {
  itemID: number;
  itemName: string;
  entryTypes: string[];
  professionNames: string[];
  itemQuality: number | null;
  qualityRank: number | null;
}

interface RecipeSlotOption {
  optionIndex: number;
  reagentItemID: number | null;
  reagentName: string;
}

interface RecipeSlot {
  slotIndex: number;
  slotText: string;
  quantity: number;
  required: boolean;
  reagentType: number;
  options: RecipeSlotOption[];
}

interface OutputQuality {
  rank: number;
  qualityID: number;
  itemID: number;
  itemQuality: number;
}

interface SalvageTarget {
  itemID: number;
}

interface RecipeEntry {
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

// ─── Import Logic ────────────────────────────────────────────────────

export async function importGameData(): Promise<void> {
  const dataDir = resolve(import.meta.dir, "../../../game-data-parsed");

  console.log("[GameDataImport] Reading JSON files...");
  const reagentsRaw = await Bun.file(resolve(dataDir, "midnight_reagents_used.json")).json();
  const recipesRaw = await Bun.file(resolve(dataDir, "midnight_recipes_simplified.json")).json();

  const reagentEntries = reagentsRaw as ReagentEntry[];
  const recipeEntries = recipesRaw as RecipeEntry[];

  // Truncate all static tables in reverse FK order
  console.log("[GameDataImport] Clearing existing static data...");
  await db.delete(recipeSalvageTargets);
  await db.delete(recipeReagentSlotOptions);
  await db.delete(recipeReagentSlots);
  await db.delete(recipeOutputQualities);
  await db.delete(recipes);
  await db.delete(itemProfessions);
  await db.delete(recipeCategories);
  await db.delete(items);
  await db.delete(professions);

  // a. Professions — extract unique from recipes
  console.log("[GameDataImport] Importing professions...");
  const professionMap = new Map<number, string>();
  for (const r of recipeEntries) {
    professionMap.set(r.professionSkillLineID, r.professionName);
  }
  if (professionMap.size > 0) {
    await db.insert(professions).values(Array.from(professionMap, ([id, name]) => ({ id, name })));
  }
  console.log(`[GameDataImport]   ${professionMap.size} professions`);

  // b. Recipe categories — extract unique from recipes
  console.log("[GameDataImport] Importing recipe categories...");
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
    await db.insert(recipeCategories).values(
      Array.from(categoryMap, ([id, cat]) => ({
        id,
        name: cat.name,
        professionId: cat.professionId,
        topCategoryId: cat.topCategoryId,
        topCategoryName: cat.topCategoryName,
      })),
    );
  }
  console.log(`[GameDataImport]   ${categoryMap.size} recipe categories`);

  // c. Items — from reagents file
  console.log("[GameDataImport] Importing items...");
  const itemRows = reagentEntries
    .filter((r) => r.itemID != null && r.itemID !== 0)
    .map((r) => ({
      id: r.itemID,
      name: r.itemName,
      itemQuality: r.itemQuality,
      qualityRank: r.qualityRank,
      isReagent: r.entryTypes.includes("reagent"),
      isCraftedOutput: r.entryTypes.includes("craftedOutput"),
    }));
  if (itemRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < itemRows.length; i += BATCH) {
      await db.insert(items).values(itemRows.slice(i, i + BATCH));
    }
  }
  console.log(`[GameDataImport]   ${itemRows.length} items`);

  // Also ensure every outputItemID from recipes exists in items
  const existingItemIds = new Set(reagentEntries.filter((r) => r.itemID != null && r.itemID !== 0).map((r) => r.itemID));
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
      await db.insert(items).values(
        extraItems.slice(i, i + BATCH).map((it) => ({
          id: it.id,
          name: it.name,
          isCraftedOutput: true,
        })),
      );
    }
    console.log(`[GameDataImport]   ${extraItems.length} extra items from recipe outputs/reagents`);
  }

  // d. Item-profession links
  console.log("[GameDataImport] Importing item-profession links...");
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
      await db.insert(itemProfessions).values(ipRows.slice(i, i + BATCH));
    }
  }
  console.log(`[GameDataImport]   ${ipRows.length} item-profession links`);

  // e. Recipes
  console.log("[GameDataImport] Importing recipes...");
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
      await db.insert(recipes).values(recipeRows.slice(i, i + BATCH));
    }
  }
  console.log(`[GameDataImport]   ${recipeRows.length} recipes`);

  // f. Recipe output qualities
  console.log("[GameDataImport] Importing recipe output qualities...");
  const oqRows: { recipeId: number; rank: number; qualityId: number; itemId: number; itemQuality: number }[] = [];
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
      await db.insert(recipeOutputQualities).values(oqRows.slice(i, i + BATCH));
    }
  }
  console.log(`[GameDataImport]   ${oqRows.length} output qualities`);

  // g. Recipe reagent slots
  console.log("[GameDataImport] Importing recipe reagent slots...");
  // We need the returned IDs to link options, so insert per-recipe
  for (const r of recipeEntries) {
    if (r.reagents.length === 0) continue;

    const insertedSlots = await db
      .insert(recipeReagentSlots)
      .values(
        r.reagents.map((s) => ({
          recipeId: r.recipeID,
          slotIndex: s.slotIndex,
          quantity: s.quantity,
          required: s.required,
          reagentType: s.reagentType,
          slotText: s.slotText,
        })),
      )
      .returning({ id: recipeReagentSlots.id, slotIndex: recipeReagentSlots.slotIndex });

    // h. Recipe reagent slot options
    const slotIdByIndex = new Map<number, number>();
    for (const s of insertedSlots) {
      slotIdByIndex.set(s.slotIndex, s.id);
    }

    const optRows: { slotId: number; optionIndex: number; itemId: number | null; reagentName: string }[] = [];
    for (const s of r.reagents) {
      const slotId = slotIdByIndex.get(s.slotIndex);
      if (slotId == null) continue;
      for (const opt of s.options) {
        optRows.push({
          slotId,
          optionIndex: opt.optionIndex,
          itemId: opt.reagentItemID,
          reagentName: opt.reagentName,
        });
      }
    }
    if (optRows.length > 0) {
      await db.insert(recipeReagentSlotOptions).values(optRows);
    }
  }
  console.log("[GameDataImport]   Reagent slots and options imported");

  // i. Recipe salvage targets
  console.log("[GameDataImport] Importing recipe salvage targets...");
  const stRows: { recipeId: number; itemId: number }[] = [];
  for (const r of recipeEntries) {
    for (const st of r.salvageTargets) {
      stRows.push({ recipeId: r.recipeID, itemId: st.itemID });
    }
  }
  if (stRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < stRows.length; i += BATCH) {
      await db.insert(recipeSalvageTargets).values(stRows.slice(i, i + BATCH));
    }
  }
  console.log(`[GameDataImport]   ${stRows.length} salvage targets`);

  console.log("[GameDataImport] Import complete!");
}
