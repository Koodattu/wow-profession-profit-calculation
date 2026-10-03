import type { ItemFilters } from "./api";

export const SORT_OPTIONS = [
  ["name-asc", "Name: A–Z"], ["name-desc", "Name: Z–A"],
  ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"],
  ["quantity-desc", "Quantity: high to low"], ["quantity-asc", "Quantity: low to high"],
] as const;
export const RARITY_OPTIONS = [
  ["0", "Poor"], ["1", "Common"], ["2", "Uncommon"], ["3", "Rare"], ["4", "Epic"],
  ["5", "Legendary"], ["6", "Artifact"], ["7", "Heirloom"], ["8", "WoW Token"], ["unknown", "Unknown rarity"],
] as const;
export const FILTER_KEYS = ["search", "searchMode", "type", "category", "subcategory", "slot", "rarity", "rank", "usage", "profession", "availability", "minPrice", "maxPrice", "minQuantity", "maxQuantity", "sort"] as const;
const numberKeys = ["profession", "minPrice", "maxPrice", "minQuantity", "maxQuantity"] as const;

export function readMarketFilters(params: URLSearchParams): { filters: ItemFilters; invalid: boolean } {
  const values = Object.fromEntries(FILTER_KEYS.filter(key => params.has(key) && params.get(key) !== "").map(key => [key, params.get(key)!]));
  let invalid = Object.values(values).some(value => value.length > 100);
  const enums = {
    type: ["all", "commodity", "realm"], searchMode: ["contains", "exact"], usage: ["all", "reagent", "crafted"],
    availability: ["all", "listed", "unlisted"], sort: SORT_OPTIONS.map(([value]) => value),
    rarity: RARITY_OPTIONS.map(([value]) => value), rank: ["1", "2", "3", "4", "5", "none"],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (values[key] && !(allowed as readonly string[]).includes(values[key])) invalid = true;
  }
  const numbers: Record<string, number> = {};
  for (const key of numberKeys) {
    if (values[key] === undefined) continue;
    const value = Number(values[key]);
    if (!/^\d+$/.test(values[key]) || !Number.isSafeInteger(value) || (key === "profession" && (value < 1 || value > 2147483647))) invalid = true;
    numbers[key] = value;
  }
  for (const [min, max] of [["minPrice", "maxPrice"], ["minQuantity", "maxQuantity"]]) {
    if (numbers[min] !== undefined && numbers[max] !== undefined && numbers[min] > numbers[max]) invalid = true;
  }
  return { filters: { ...values, ...numbers }, invalid };
}

export function goldToCopper(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(trimmed)) throw new Error("Enter a non-negative gold amount with up to 4 decimal places.");
  const [gold, fraction = ""] = trimmed.split(".");
  const copper = BigInt(gold) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
  if (copper > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("That price is too large.");
  return copper.toString();
}

export function copperToGold(value: string | null) {
  if (!value) return "";
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return value;
  const copper = BigInt(value);
  const fraction = (copper % BigInt(10000)).toString().padStart(4, "0").replace(/0+$/, "");
  return `${copper / BigInt(10000)}${fraction ? `.${fraction}` : ""}`;
}
