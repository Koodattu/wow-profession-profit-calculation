import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { itemExpansions, itemExpansionReference } from "../db/schema";
import { readBundledItemExpansions, validateItemExpansions, type ItemExpansionReference } from "./item-expansion-data";

export async function ensureItemExpansions(data?: ItemExpansionReference): Promise<"published" | "already-present"> {
  const reference = data ?? await readBundledItemExpansions();
  validateItemExpansions(reference);
  return db.transaction(async tx => {
    // Publication and its version marker commit together, including when two
    // app instances start at once. Existing readers see a complete version.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('copper:item-expansions', 0))`);
    const [current] = await tx.select().from(itemExpansionReference).where(eq(itemExpansionReference.id, "mainline"));
    if (current?.contentHash === reference.metadata.contentHash) return "already-present";
    const rows = Object.entries(reference.expansions).map(([id, expansion]) => ({ itemId: Number(id), expansion }));
    await tx.delete(itemExpansions);
    for (let offset = 0; offset < rows.length; offset += 10_000) {
      await tx.insert(itemExpansions).values(rows.slice(offset, offset + 10_000));
    }
    await tx.insert(itemExpansionReference).values({ id: "mainline", contentHash: reference.metadata.contentHash })
      .onConflictDoUpdate({ target: itemExpansionReference.id, set: { contentHash: reference.metadata.contentHash } });
    return "published";
  });
}
