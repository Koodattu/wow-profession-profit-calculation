import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SalvagingInputOptionConfig, SalvagingRecipeConfig } from "../services/salvaging-config";

interface SimplifiedSalvageTarget {
  itemID: number;
  itemName?: string;
}

interface SimplifiedRecipe {
  recipeID: number;
  recipeName: string;
  reagents: unknown[];
  salvageTargets: SimplifiedSalvageTarget[];
}

interface ItemMetadata {
  itemName?: string;
  itemQuality: number | null;
  qualityRank: number | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const recipesPath = resolve(__dirname, "../../../game-data-parsed/midnight_recipes_simplified.json");
const reagentsUsedPath = resolve(__dirname, "../../../game-data-parsed/midnight_reagents_used.json");
const outputPath = resolve(__dirname, "../../../game-data-parsed/salvaging_config_manual.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function toOutputArray(outputs: unknown, metadataByItemId: Map<number, ItemMetadata>): SalvagingInputOptionConfig["outputs"] {
  if (!Array.isArray(outputs)) return [];

  const filtered = outputs.filter(
    (
      output,
    ): output is {
      itemId: number;
      quantity: number;
      itemName?: unknown;
      itemQuality?: unknown;
      qualityRank?: unknown;
      notes?: string;
    } => {
      if (!isObject(output)) return false;
      if (typeof output.itemId !== "number" || !Number.isFinite(output.itemId)) return false;
      if (typeof output.quantity !== "number" || !Number.isFinite(output.quantity)) return false;
      if (output.itemName !== undefined && typeof output.itemName !== "string") return false;
      if (output.itemQuality !== undefined && toNullableNumber(output.itemQuality) === undefined) return false;
      if (output.qualityRank !== undefined && toNullableNumber(output.qualityRank) === undefined) return false;
      if (output.notes !== undefined && typeof output.notes !== "string") return false;
      return true;
    },
  );

  return filtered.map((output) => {
    const metadata = metadataByItemId.get(output.itemId);
    const outputItemName = typeof output.itemName === "string" ? output.itemName : undefined;
    const outputItemQuality = toNullableNumber(output.itemQuality);
    const outputQualityRank = toNullableNumber(output.qualityRank);

    return {
      itemId: output.itemId,
      quantity: output.quantity,
      itemName: outputItemName ?? metadata?.itemName,
      itemQuality: outputItemQuality !== undefined ? outputItemQuality : metadata?.itemQuality,
      qualityRank: outputQualityRank !== undefined ? outputQualityRank : metadata?.qualityRank,
      notes: typeof output.notes === "string" ? output.notes : undefined,
    };
  });
}

async function loadMetadataMap(): Promise<Map<number, ItemMetadata>> {
  const raw = await readFile(reagentsUsedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("midnight_reagents_used.json is not an array");
  }

  const map = new Map<number, ItemMetadata>();
  for (const row of parsed) {
    if (!isObject(row)) continue;
    if (typeof row.itemID !== "number" || !Number.isFinite(row.itemID)) continue;

    const itemName = typeof row.itemName === "string" ? row.itemName : undefined;
    const itemQuality = toNullableNumber(row.itemQuality);
    const qualityRank = toNullableNumber(row.qualityRank);

    map.set(row.itemID, {
      itemName,
      itemQuality: itemQuality === undefined ? null : itemQuality,
      qualityRank: qualityRank === undefined ? null : qualityRank,
    });
  }

  return map;
}

async function loadExistingMap(): Promise<Map<number, SalvagingRecipeConfig>> {
  try {
    const raw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();

    const rows = parsed.filter((entry): entry is SalvagingRecipeConfig => {
      if (!isObject(entry)) return false;
      return typeof entry.recipeId === "number" && Number.isFinite(entry.recipeId);
    });

    return new Map(rows.map((row) => [row.recipeId, row]));
  } catch {
    return new Map();
  }
}

async function main() {
  const [recipesRaw, metadataByItemId] = await Promise.all([readFile(recipesPath, "utf8"), loadMetadataMap()]);
  const parsed = JSON.parse(recipesRaw) as SimplifiedRecipe[];

  if (!Array.isArray(parsed)) {
    throw new Error("midnight_recipes_simplified.json is not an array");
  }

  const existingByRecipe = await loadExistingMap();

  const generated: SalvagingRecipeConfig[] = parsed
    .filter((recipe) => Array.isArray(recipe.salvageTargets) && recipe.salvageTargets.length > 0)
    .map((recipe) => {
      const existing = existingByRecipe.get(recipe.recipeID);
      const existingInputByItem = new Map<number, SalvagingInputOptionConfig>((existing?.inputOptions ?? []).map((input) => [input.itemId, input]));
      const salvageTargetByItemId = new Map<number, SimplifiedSalvageTarget>();

      for (const target of recipe.salvageTargets) {
        if (typeof target?.itemID !== "number" || !Number.isFinite(target.itemID)) continue;
        if (!salvageTargetByItemId.has(target.itemID)) {
          salvageTargetByItemId.set(target.itemID, target);
        }
      }

      const inputOptions: SalvagingInputOptionConfig[] = Array.from(salvageTargetByItemId.values()).map((target) => {
        const itemId = target.itemID;
        const existingInput = existingInputByItem.get(itemId);
        const metadata = metadataByItemId.get(itemId);
        const outputOverrides = toOutputArray(existingInput?.outputs, metadataByItemId);

        return {
          itemId,
          itemName: metadata?.itemName ?? (typeof target.itemName === "string" ? target.itemName : undefined),
          itemQuality: metadata?.itemQuality ?? null,
          qualityRank: metadata?.qualityRank ?? null,
          outputs: outputOverrides,
          notes: typeof existingInput?.notes === "string" ? existingInput.notes : undefined,
        };
      });

      const useSalvageInputs = typeof existing?.useSalvageInputs === "boolean" ? existing.useSalvageInputs : recipe.reagents.length === 0;
      const inputQuantity =
        typeof existing?.inputQuantity === "number" && Number.isFinite(existing.inputQuantity) ? existing.inputQuantity : recipe.recipeName === "Recycling" ? 5 : 1;

      return {
        recipeId: recipe.recipeID,
        recipeName: recipe.recipeName,
        useSalvageInputs,
        inputQuantity,
        inputOptions,
      };
    })
    .sort((a, b) => a.recipeId - b.recipeId);

  await writeFile(outputPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
  console.log(`[GenerateSalvageConfig] Wrote ${generated.length} recipes to ${outputPath}`);
}

main().catch((error) => {
  console.error("[GenerateSalvageConfig] Failed:", error);
  process.exit(1);
});
