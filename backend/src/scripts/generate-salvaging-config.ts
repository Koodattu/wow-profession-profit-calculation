import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SalvagingInputOptionConfig, SalvagingRecipeConfig } from "../services/salvaging-config";

interface SimplifiedSalvageTarget {
  itemID: number;
}

interface SimplifiedRecipe {
  recipeID: number;
  recipeName: string;
  reagents: unknown[];
  salvageTargets: SimplifiedSalvageTarget[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const recipesPath = resolve(__dirname, "../../../game-data-parsed/midnight_recipes_simplified.json");
const outputPath = resolve(__dirname, "../../../game-data-parsed/salvaging_config_manual.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOutputArray(outputs: unknown): SalvagingInputOptionConfig["outputs"] {
  if (!Array.isArray(outputs)) return [];

  const filtered = outputs.filter((output): output is { itemId: number; quantity: number; notes?: string } => {
    if (!isObject(output)) return false;
    if (typeof output.itemId !== "number" || !Number.isFinite(output.itemId)) return false;
    if (typeof output.quantity !== "number" || !Number.isFinite(output.quantity)) return false;
    if (output.notes !== undefined && typeof output.notes !== "string") return false;
    return true;
  });

  return filtered;
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
  const raw = await readFile(recipesPath, "utf8");
  const parsed = JSON.parse(raw) as SimplifiedRecipe[];

  if (!Array.isArray(parsed)) {
    throw new Error("midnight_recipes_simplified.json is not an array");
  }

  const existingByRecipe = await loadExistingMap();

  const generated: SalvagingRecipeConfig[] = parsed
    .filter((recipe) => Array.isArray(recipe.salvageTargets) && recipe.salvageTargets.length > 0)
    .map((recipe) => {
      const existing = existingByRecipe.get(recipe.recipeID);
      const existingInputByItem = new Map<number, SalvagingInputOptionConfig>((existing?.inputOptions ?? []).map((input) => [input.itemId, input]));

      const inputOptions: SalvagingInputOptionConfig[] = recipe.salvageTargets
        .map((target) => target.itemID)
        .filter((itemId, index, arr) => arr.indexOf(itemId) === index)
        .map((itemId) => {
          const existingInput = existingInputByItem.get(itemId);
          const outputOverrides = toOutputArray(existingInput?.outputs);
          return {
            itemId,
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
