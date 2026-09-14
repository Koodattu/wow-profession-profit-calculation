import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { realmLatest } from "../db/schema";
import { getGearData } from "./gear-data";
import { decodeGear } from "./gear-decoder";

export async function getGearVariants(itemId: number) {
  const rows = await db.select({
    key: realmLatest.variantKey, context: realmLatest.context, bonusLists: realmLatest.bonusLists, modifiers: realmLatest.modifiers,
    connectedRealmId: realmLatest.connectedRealmId, minBuyout: realmLatest.minBuyout,
    totalQuantity: realmLatest.totalQuantity, numAuctions: realmLatest.numAuctions, observedAt: realmLatest.observedAt,
  }).from(realmLatest).where(and(eq(realmLatest.regionId, "eu"), eq(realmLatest.itemId, itemId)));
  type Variant = ReturnType<typeof decodeGear> & {
    key: string; context: number | null; bonusLists: number[]; modifiers: { type: number; value: number }[];
    realms: { connectedRealmId: number; minBuyout: number; totalQuantity: number; numAuctions: number; observedAt: Date }[];
  };
  const variants = new Map<string, Variant>();
  const data = getGearData();
  for (const row of rows) {
    let variant = variants.get(row.key);
    if (!variant) {
      variant = { key: row.key, context: row.context, bonusLists: row.bonusLists, modifiers: row.modifiers,
        ...decodeGear({ itemId, ...row }, data), realms: [] };
      variants.set(row.key, variant);
    }
    variant.realms.push({ connectedRealmId: row.connectedRealmId, minBuyout: row.minBuyout, totalQuantity: row.totalQuantity,
      numAuctions: row.numAuctions, observedAt: row.observedAt });
  }
  return { dataVersion: data.metadata, variants: [...variants.values()].sort((a, b) => (b.itemLevel ?? -1) - (a.itemLevel ?? -1) || a.key.localeCompare(b.key)) };
}

export async function getGearListings(itemId: number, connectedRealmId: number, variantKey: string, page: number) {
  const [row] = await db.select({ listings: realmLatest.listings, observedAt: realmLatest.observedAt }).from(realmLatest)
    .where(and(eq(realmLatest.regionId, "eu"), eq(realmLatest.itemId, itemId), eq(realmLatest.connectedRealmId, connectedRealmId), eq(realmLatest.variantKey, variantKey)))
    .limit(1);
  const listings = [...(row?.listings ?? [])].sort((a, b) => {
    const delta = BigInt(a.buyout) * BigInt(b.quantity) - BigInt(b.buyout) * BigInt(a.quantity);
    return delta < 0n ? -1 : delta > 0n ? 1 : a.id.localeCompare(b.id);
  });
  const limit = 50;
  return { listings: listings.slice((page - 1) * limit, page * limit), total: listings.length, page, totalPages: Math.ceil(listings.length / limit),
    observedAt: row?.observedAt ?? null, detailsAvailable: row?.listings != null };
}
