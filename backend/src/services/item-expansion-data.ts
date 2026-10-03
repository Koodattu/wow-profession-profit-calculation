import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

// Undermine's one-based era IDs, not Blizzard's expansion indexes.
export const MAX_ITEM_EXPANSION = 12;

export interface ItemExpansionReference {
  metadata: {
    schemaVersion: 1;
    retrievedAt: string;
    sourceCommit: string;
    sources: Array<{ url: string; sha256: string }>;
    contentHash: string;
    attribution: string;
  };
  expansions: Record<string, number>;
}

export function expansionContentHash(expansions: Record<string, number>): string {
  return createHash("sha256").update(JSON.stringify(expansions)).digest("hex");
}

export function validateItemExpansions(data: ItemExpansionReference): void {
  if (data.metadata?.schemaVersion !== 1 || !data.expansions || !Object.keys(data.expansions).length) {
    throw new Error("Incomplete item expansion reference");
  }
  for (const [id, expansion] of Object.entries(data.expansions)) {
    if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647
      || !Number.isInteger(expansion) || expansion < 1 || expansion > MAX_ITEM_EXPANSION) {
      throw new Error(`Invalid item expansion reference entry: ${id}`);
    }
  }
  if (data.metadata.contentHash !== expansionContentHash(data.expansions)) {
    throw new Error("Item expansion reference checksum mismatch");
  }
}

export async function readBundledItemExpansions(): Promise<ItemExpansionReference> {
  const bytes = await readFile(new URL("../data/item-expansions.json.gz", import.meta.url));
  const data: ItemExpansionReference = JSON.parse(gunzipSync(bytes).toString());
  validateItemExpansions(data);
  return data;
}
