import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { expansionContentHash, validateItemExpansions, type ItemExpansionReference } from "../services/item-expansion-data";

// Supply a reviewed shatari-data commit to update the historical mapping.
const sourceCommit = process.argv[2] ?? "a7ace459f7461001dcec00e974aa7dbb41997e7a";
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Expected a full shatari-data commit SHA");
const sources: ItemExpansionReference["metadata"]["sources"] = [];
async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Expansion reference download failed: ${response.status} (${url})`);
  const body = await response.text();
  sources.push({ url, sha256: createHash("sha256").update(body).digest("hex") });
  return JSON.parse(body);
}

const expansions: Record<string, number> = await download(`https://raw.githubusercontent.com/erorus/shatari-data/${sourceCommit}/expansion-items.json`);
if (Object.keys(expansions).length < 200_000) throw new Error("Incomplete historical expansion mapping");
for (const kind of ["unbound", "bound"]) {
  const catalog: Record<string, { expansion: number }> = await download(`https://undermine.exchange/json/mainline/items.${kind}.json`);
  // The bound catalog contains only crafting-relevant items, not every BoP item.
  if (Object.keys(catalog).length < (kind === "unbound" ? 30_000 : 300)) throw new Error(`Incomplete ${kind} item catalog`);
  for (const [id, item] of Object.entries(catalog)) {
    if (expansions[id] !== undefined && expansions[id] !== item.expansion) {
      throw new Error(`Expansion sources disagree for item ${id}`);
    }
    // Only explicitly listed IDs inherit the published catalog's era. Never
    // assume that every unknown ID belongs to the current expansion.
    expansions[id] = item.expansion;
  }
}
const data: ItemExpansionReference = {
  metadata: {
    schemaVersion: 1, retrievedAt: new Date().toISOString(), sourceCommit, sources,
    contentHash: expansionContentHash(expansions),
    attribution: "Derived from erorus/shatari-data, Copyright 2026 Gerard Dombroski, Apache-2.0. Modified by Copper: merged historical mappings with published mainline item eras; other fields removed. See item-expansions.NOTICE.md and item-expansions.LICENSE.",
  },
  expansions,
};
validateItemExpansions(data);
const target = new URL("../data/item-expansions.json.gz", import.meta.url);
const temporary = new URL("../data/item-expansions.json.gz.tmp", import.meta.url);
await writeFile(temporary, gzipSync(JSON.stringify(data)));
await rename(temporary, target);
console.log(`Bundled ${Object.keys(expansions).length} item expansions / ${data.metadata.contentHash}`);
