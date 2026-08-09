import type { HistoryRange } from "@/lib/time-ranges";

const API_BASE =
  typeof window === "undefined"
    ? process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4111"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:4111";

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
  scenarioKey: string;
  reagentRank: 1 | 2;
  outputRank: 1 | 2;
  cost: RecipeCostResult;
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

export interface RecipeHistoryPoint {
  [key: string]: string | number | null;
  time: string;
  cost: number | null;
  output: number | null;
  outputQuantity: number | null;
}

export interface RecipeHistoryResponse {
  recipeId: number;
  range: HistoryRange;
  scenarios: Array<{ scenarioKey: string; points: RecipeHistoryPoint[] }>;
}

export interface Item {
  id: number;
  name: string;
  itemQuality: number | null;
  qualityRank: number | null;
  isReagent: boolean;
  isCraftedOutput: boolean;
  marketType: "commodity" | "realm" | null;
  itemClass: string | null;
  itemSubclass: string | null;
  inventoryType: string | null;
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
  marketType: "commodity" | "realm" | null;
  priceSource: "commodity" | "realm" | null;
  latestPrice: MarketPrice | null;
  regionLatestPrice: MarketPrice | null;
  realmLatestPrice: MarketPrice | null;
}

export interface MarketPrice {
  minPrice: number;
  avgPrice: number;
  medianPrice: number;
  totalQuantity?: number;
  numAuctions?: number;
  observedAt?: string;
  variantCount?: number;
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
  categoryId: number | null;
  categoryName: string | null;
  professionName: string | null;
  regionAvgPrice: number;
  cheapestRealm: { realmId: number; realmName: string; minBuyout: number };
  mostExpensiveRealm: { realmId: number; realmName: string; minBuyout: number };
  spread: number;
  spreadPercent: number;
  realmCount: number;
}

export interface FlippingCategory {
  categoryId: number | null;
  categoryName: string | null;
}

export type FlippingSortBy = "spread" | "regionAvgPrice";

export interface RealmPrice {
  realm_id: number;
  realm_name: string | null;
  min_buyout: number;
  avg_buyout: number;
  total_quantity: number;
  variant_count: number;
  observed_at: string;
}

export interface Realm {
  id: number;
  connectedRealmId: number;
  name: string;
  slug: string;
}

export interface ConnectedRealmGroup {
  connected_realm_id: number;
  realms: Realm[];
}

export interface MarketSummary {
  region: "eu";
  itemCount: number;
  commodityCount: number;
  realmItemCount: number;
  pendingMetadataCount: number;
  commodityObservedAt: string | null;
  realmOldestObservedAt: string | null;
  realmNewestObservedAt: string | null;
  connectedRealmCount: number;
  selectedRealm: { id: number; name: string } | null;
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

export function fetchProfessionCostsForRealm(id: number, region = "eu", connectedRealmId?: number): Promise<ProfessionRecipeCost[]> {
  return apiFetch(`/api/crafting/professions/${id}${qs({ region, connectedRealmId: connectedRealmId?.toString() })}`);
}

export function fetchRecipeCost(id: number, region = "eu", connectedRealmId?: number): Promise<RecipeProfitResult> {
  return apiFetch(`/api/crafting/recipes/${id}${qs({ region, connectedRealmId: connectedRealmId?.toString() })}`);
}

export function fetchRecipeHistory(
  id: number,
  range: HistoryRange,
  connectedRealmId: number,
  region = "eu",
): Promise<RecipeHistoryResponse> {
  return apiFetch(
    `/api/crafting/recipes/${id}/history${qs({
      region,
      range,
      connectedRealmId: connectedRealmId.toString(),
    })}`,
  );
}

export function fetchItem(id: number): Promise<Item> {
  return apiFetch(`/api/items/${id}`);
}

export function fetchItemPrices(
  id: number,
  region = "eu",
  range: HistoryRange = "24h",
  options?: { type?: "auto" | "commodity" | "realm"; connectedRealmId?: number },
): Promise<PricePoint[]> {
  return apiFetch(
    `/api/items/${id}/prices${qs({
      region,
      range,
      type: options?.type,
      connectedRealmId: options?.connectedRealmId?.toString(),
    })}`,
  );
}

export function fetchItems(params: { region?: string; type?: string; search?: string; page?: number; limit?: number; connectedRealmId?: number } = {}): Promise<ItemListResponse> {
  return apiFetch(
    `/api/items${qs({
      region: params.region,
      type: params.type,
      search: params.search,
      page: params.page?.toString(),
      limit: params.limit?.toString(),
      connectedRealmId: params.connectedRealmId?.toString(),
    })}`,
  );
}

export function fetchSearch(q: string, region = "eu"): Promise<SearchResult> {
  return apiFetch(`/api/search${qs({ q, region })}`);
}

export function fetchFlippingOpportunities(
  region = "eu",
  minSpread?: number,
  limit?: number,
  categoryName?: string,
  sortBy: FlippingSortBy = "spread",
  uncategorized?: boolean,
): Promise<FlippingOpportunity[]> {
  return apiFetch(
    `/api/flipping/opportunities${qs({
      region,
      minSpread: minSpread?.toString(),
      limit: limit?.toString(),
      categoryName,
      sortBy,
      uncategorized: uncategorized ? "true" : undefined,
    })}`,
  );
}

export function fetchFlippingCategories(region = "eu"): Promise<FlippingCategory[]> {
  return apiFetch(`/api/flipping/categories${qs({ region })}`);
}

export function fetchItemRealmPrices(itemId: number, region = "eu", range = "24h"): Promise<RealmPrice[]> {
  return apiFetch(`/api/items/${itemId}/realm-prices${qs({ region, range })}`);
}

export function fetchRealms(region = "eu"): Promise<ConnectedRealmGroup[]> {
  return apiFetch(`/api/realms${qs({ region })}`);
}

export function fetchMarketSummary(region = "eu", connectedRealmId?: number): Promise<MarketSummary> {
  return apiFetch(`/api/market/summary${qs({ region, connectedRealmId: connectedRealmId?.toString() })}`);
}

// --- Utilities ---

export function formatPrice(copper: number): string {
  if (copper === 0) return "N/A";
  const negative = copper < 0;
  const abs = Math.abs(copper);
  const gold = Math.floor(abs / 10000);
  const silver = Math.floor((abs % 10000) / 100);
  const groupedGold = gold.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const str = `${groupedGold}g ${silver}s`;
  return negative ? `−${str}` : str;
}
