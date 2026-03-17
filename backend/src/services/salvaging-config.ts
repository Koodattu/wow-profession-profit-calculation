import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SalvagingOutputOverride {
  itemId: number;
  quantity: number;
  itemName?: string;
  itemQuality?: number | null;
  qualityRank?: number | null;
  notes?: string;
}

export interface SalvagingInputOptionConfig {
  itemId: number;
  itemName?: string;
  itemQuality?: number | null;
  qualityRank?: number | null;
  outputs?: SalvagingOutputOverride[];
  notes?: string;
}

export interface SalvagingRecipeConfig {
  recipeId: number;
  recipeName: string;
  useSalvageInputs: boolean;
  inputQuantity: number;
  inputOptions: SalvagingInputOptionConfig[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, "../../../game-data-parsed/salvaging_config_manual.json");

let cachedMap: Map<number, SalvagingRecipeConfig> | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidOptionalNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isValidOutputOverride(value: unknown): value is SalvagingOutputOverride {
  if (!isObject(value)) return false;
  if (typeof value.itemId !== "number" || !Number.isFinite(value.itemId)) return false;
  if (typeof value.quantity !== "number" || !Number.isFinite(value.quantity)) return false;
  if (value.itemName !== undefined && typeof value.itemName !== "string") return false;
  if (value.itemQuality !== undefined && !isValidOptionalNullableNumber(value.itemQuality)) return false;
  if (value.qualityRank !== undefined && !isValidOptionalNullableNumber(value.qualityRank)) return false;
  if (value.notes !== undefined && typeof value.notes !== "string") return false;
  return true;
}

function isValidInputOption(value: unknown): value is SalvagingInputOptionConfig {
  if (!isObject(value)) return false;
  if (typeof value.itemId !== "number" || !Number.isFinite(value.itemId)) return false;
  if (value.itemName !== undefined && typeof value.itemName !== "string") return false;
  if (value.itemQuality !== undefined && !isValidOptionalNullableNumber(value.itemQuality)) return false;
  if (value.qualityRank !== undefined && !isValidOptionalNullableNumber(value.qualityRank)) return false;
  if (value.notes !== undefined && typeof value.notes !== "string") return false;

  if (value.outputs !== undefined) {
    if (!Array.isArray(value.outputs)) return false;
    if (!value.outputs.every((output) => isValidOutputOverride(output))) return false;
  }

  return true;
}

function isValidRecipeConfig(value: unknown): value is SalvagingRecipeConfig {
  if (!isObject(value)) return false;
  if (typeof value.recipeId !== "number" || !Number.isFinite(value.recipeId)) return false;
  if (typeof value.recipeName !== "string") return false;
  if (typeof value.useSalvageInputs !== "boolean") return false;
  if (typeof value.inputQuantity !== "number" || !Number.isFinite(value.inputQuantity)) return false;
  if (!Array.isArray(value.inputOptions)) return false;
  if (!value.inputOptions.every((option) => isValidInputOption(option))) return false;
  return true;
}

export async function getSalvagingRecipeConfigMap(): Promise<Map<number, SalvagingRecipeConfig>> {
  if (cachedMap) return cachedMap;

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      console.warn("[SalvagingConfig] Invalid config format: expected array.");
      cachedMap = new Map();
      return cachedMap;
    }

    if (!parsed.every((row) => isValidRecipeConfig(row))) {
      console.warn("[SalvagingConfig] Invalid config rows detected; ignoring salvage config.");
      cachedMap = new Map();
      return cachedMap;
    }

    cachedMap = new Map(parsed.map((row) => [row.recipeId, row]));
    return cachedMap;
  } catch (error) {
    console.warn("[SalvagingConfig] Could not load salvaging config; using defaults.", error);
    cachedMap = new Map();
    return cachedMap;
  }
}
