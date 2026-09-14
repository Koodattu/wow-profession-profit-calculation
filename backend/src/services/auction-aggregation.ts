import { createHash } from "node:crypto";

export interface PriceEntry {
  price: number;
  quantity: number;
  totalPrice?: number;
}

export interface PriceSummary {
  minPrice: number;
  avgPrice: number;
  medianPrice: number;
  maxPrice: number;
  totalQuantity: number;
  numAuctions: number;
  priceP10: number;
  priceP25: number;
  totalValue: string;
}

export interface RealmAuctionIdentity {
  context?: number;
  bonus_lists?: number[];
  modifiers?: { type: number; value: number }[];
  pet_breed_id?: number;
  pet_level?: number;
  pet_quality_id?: number;
  pet_species_id?: number;
}

export interface NormalizedRealmVariant {
  key: string;
  context: number | null;
  bonusLists: number[];
  modifiers: { type: number; value: number }[];
  petBreedId: number | null;
  petLevel: number | null;
  petQualityId: number | null;
  petSpeciesId: number | null;
}

function weightedPercentile(sorted: PriceEntry[], totalQuantity: number, percentile: number): number {
  const target = Math.ceil(totalQuantity * (percentile / 100));
  let accumulated = 0;

  for (const entry of sorted) {
    accumulated += entry.quantity;
    if (accumulated >= target) return entry.price;
  }

  return sorted.at(-1)!.price;
}

export function summarizePrices(entries: PriceEntry[]): PriceSummary | null {
  const valid = entries.filter(
    (entry) => Number.isSafeInteger(entry.price) && entry.price > 0 && Number.isSafeInteger(entry.quantity) && entry.quantity > 0
      && (entry.totalPrice === undefined || (Number.isSafeInteger(entry.totalPrice) && entry.totalPrice > 0)),
  );
  if (valid.length === 0) return null;

  valid.sort((a, b) => a.price - b.price);

  let totalQuantity = 0;
  let totalValue = 0n;
  for (const entry of valid) {
    totalQuantity += entry.quantity;
    totalValue += entry.totalPrice === undefined ? BigInt(entry.price) * BigInt(entry.quantity) : BigInt(entry.totalPrice);
  }

  if (!Number.isSafeInteger(totalQuantity)) {
    throw new Error("Auction quantity exceeds the supported integer range");
  }

  const quantity = BigInt(totalQuantity);
  const avgPrice = Number((totalValue + quantity / 2n) / quantity);

  return {
    minPrice: valid[0]!.price,
    avgPrice,
    medianPrice: weightedPercentile(valid, totalQuantity, 50),
    maxPrice: valid.at(-1)!.price,
    totalQuantity,
    numAuctions: valid.length,
    priceP10: weightedPercentile(valid, totalQuantity, 10),
    priceP25: weightedPercentile(valid, totalQuantity, 25),
    totalValue: totalValue.toString(),
  };
}

export function normalizeRealmVariant(item: RealmAuctionIdentity): NormalizedRealmVariant {
  const bonusLists = [...(item.bonus_lists ?? [])].sort((a, b) => a - b);
  const modifiers = [...(item.modifiers ?? [])].sort((a, b) => a.type - b.type || a.value - b.value);
  const identity = {
    context: item.context ?? null,
    bonusLists,
    modifiers,
    petBreedId: item.pet_breed_id ?? null,
    petLevel: item.pet_level ?? null,
    petQualityId: item.pet_quality_id ?? null,
    petSpeciesId: item.pet_species_id ?? null,
  };
  const isBase = Object.values(identity).every((value) => value === null || (Array.isArray(value) && value.length === 0));

  return {
    key: isBase ? "base" : createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32),
    ...identity,
  };
}
