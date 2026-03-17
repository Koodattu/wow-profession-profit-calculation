const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4111";

// --- Types ---

export interface Profession {
  id: number;
  name: string;
  expansion: string;
}

export interface RecipeCategory {
  id: number;
  name: string;
  professionId: number;
  topCategoryId: number | null;
  topCategoryName: string | null;
}

export interface ProfessionDetail extends Profession {
  categories: RecipeCategory[];
}

export interface ReagentCost {
  slotIndex: number;
  itemId: number;
  itemName: string;
  itemQuality: number | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface RecipeCostResult {
  reagents: ReagentCost[];
  totalCost: number;
  hasPriceData: boolean;
}

export interface RankScenario {
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
}

export interface ProfessionRecipeCost {
  recipeId: number;
  recipeName: string;
  categoryId: number | null;
  qualityTierType: string;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  scenarios: RankScenario[];
}

export interface RecipeProfitResult {
  recipeId: number;
  recipeName: string;
  qualityTierType: string;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
  professionId: number;
  professionName: string;
  scenarios: RankScenario[];
}

export interface Item {
  id: number;
  name: string;
  itemQuality: number | null;
  qualityRank: number | null;
  isReagent: boolean;
  isCraftedOutput: boolean;
}

export interface PricePoint {
  time: string;
  min_price: number | null;
  avg_price: number | null;
  median_price: number | null;
  max_price: number | null;
  total_quantity: number | null;
}

export interface ItemWithPrice {
  id: number;
  name: string;
  itemQuality: number | null;
  qualityRank: number | null;
  isReagent: boolean;
  isCraftedOutput: boolean;
  priceSource: "commodity" | "realm" | null;
  latestPrice: { minPrice: number; avgPrice: number; medianPrice: number } | null;
}

export interface ItemListResponse {
  items: ItemWithPrice[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SearchResult {
  items: Item[];
  recipes: {
    id: number;
    name: string;
    professionId: number;
    professionName: string;
  }[];
}

export interface FlippingOpportunity {
  itemId: number;
  itemName: string;
  itemQuality: number | null;
  qualityRank: number | null;
  regionAvgPrice: number;
  cheapestRealm: { realmId: number; realmName: string; minBuyout: number };
  mostExpensiveRealm: { realmId: number; realmName: string; minBuyout: number };
  spread: number;
  spreadPercent: number;
  realmCount: number;
}

export interface RealmPrice {
  realm_id: number;
  realm_name: string | null;
  min_buyout: number;
  avg_buyout: number;
  total_quantity: number;
}

// --- Fetch helpers ---

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText} — ${path}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

// --- API functions ---

export function fetchProfessions(): Promise<Profession[]> {
  return apiFetch("/api/professions");
}

export function fetchProfession(id: number): Promise<ProfessionDetail> {
  return apiFetch(`/api/professions/${id}`);
}

export function fetchProfessionCosts(id: number, region = "eu"): Promise<ProfessionRecipeCost[]> {
  return apiFetch(`/api/crafting/professions/${id}${qs({ region })}`);
}

export function fetchRecipeCost(id: number, region = "eu"): Promise<RecipeProfitResult> {
  return apiFetch(`/api/crafting/recipes/${id}${qs({ region })}`);
}

export function fetchItem(id: number): Promise<Item> {
  return apiFetch(`/api/items/${id}`);
}

export function fetchItemPrices(id: number, region = "eu", range = "24h"): Promise<PricePoint[]> {
  return apiFetch(`/api/items/${id}/prices${qs({ region, range })}`);
}

export function fetchItems(params: { region?: string; type?: string; search?: string; page?: number; limit?: number } = {}): Promise<ItemListResponse> {
  return apiFetch(`/api/items${qs({ region: params.region, type: params.type, search: params.search, page: params.page?.toString(), limit: params.limit?.toString() })}`);
}

export function fetchSearch(q: string, region = "eu"): Promise<SearchResult> {
  return apiFetch(`/api/search${qs({ q, region })}`);
}

export function fetchFlippingOpportunities(region = "eu", minSpread?: number, limit?: number): Promise<FlippingOpportunity[]> {
  return apiFetch(`/api/flipping/opportunities${qs({ region, minSpread: minSpread?.toString(), limit: limit?.toString() })}`);
}

export function fetchItemRealmPrices(itemId: number, region = "eu", range = "24h"): Promise<RealmPrice[]> {
  return apiFetch(`/api/items/${itemId}/realm-prices${qs({ region, range })}`);
}

// --- Utilities ---

export function formatPrice(copper: number): string {
  if (copper === 0) return "N/A";
  const negative = copper < 0;
  const abs = Math.abs(copper);
  const gold = Math.floor(abs / 10000);
  const silver = Math.floor((abs % 10000) / 100);
  const str = `${gold}g ${silver}s`;
  return negative ? `−${str}` : str;
}
