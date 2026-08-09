import { and, asc, desc, eq, lt, or } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { items } from "../db/schema";
import { BlizzardApi } from "./blizzard-api";

interface BlizzardItemDetail {
  id: number;
  name: string;
  quality?: { type?: string };
  item_class?: { name?: string };
  item_subclass?: { name?: string };
  inventory_type?: { type?: string; name?: string };
}

const QUALITY_BY_TYPE: Record<string, number> = {
  POOR: 0,
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
  ARTIFACT: 6,
  HEIRLOOM: 7,
  WOW_TOKEN: 8,
};

export interface ItemMetadataSyncSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function syncPendingItemMetadata(regionId: string): Promise<ItemMetadataSyncSummary> {
  const retryBefore = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const pending = await db
    .select({ id: items.id })
    .from(items)
    .where(or(eq(items.metadataStatus, "pending"), and(eq(items.metadataStatus, "failed"), lt(items.metadataUpdatedAt, retryBefore))))
    .orderBy(desc(items.isReagent), desc(items.isCraftedOutput), asc(items.id))
    .limit(env.ITEM_METADATA_BATCH_SIZE);
  if (pending.length === 0) return { attempted: 0, succeeded: 0, failed: 0 };

  const api = BlizzardApi.getInstance();
  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < pending.length) {
      const row = pending[nextIndex++]!;
      try {
        const item = await api.get<BlizzardItemDetail>(regionId, `/data/wow/item/${row.id}`, "static");
        await db
          .update(items)
          .set({
            name: item.name || `Item #${row.id}`,
            itemQuality: item.quality?.type ? (QUALITY_BY_TYPE[item.quality.type] ?? null) : null,
            itemClass: item.item_class?.name ?? null,
            itemSubclass: item.item_subclass?.name ?? null,
            inventoryType: item.inventory_type?.name ?? item.inventory_type?.type ?? null,
            metadataStatus: "complete",
            metadataUpdatedAt: new Date(),
          })
          .where(eq(items.id, row.id));
        succeeded++;
      } catch (error) {
        failed++;
        await db.update(items).set({ metadataStatus: "failed", metadataUpdatedAt: new Date() }).where(eq(items.id, row.id));
        console.warn(`[ItemMetadata] Failed to hydrate item ${row.id}:`, error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
  console.log(`[ItemMetadata] Hydrated ${succeeded}/${pending.length} items for ${regionId}; ${failed} failed`);
  return { attempted: pending.length, succeeded, failed };
}
