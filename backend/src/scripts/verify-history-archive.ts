import { readFile } from "node:fs/promises";
import { sql } from "../db";
import { verifyHistoryArchive } from "../services/price-history-archive";

try {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: bun run verify-history-archive <archive.ndjson.gz>");
  const manifest = JSON.parse(await readFile(`${path}.json`, "utf8"));
  const actual = await verifyHistoryArchive(path);
  if (manifest.version !== 1 || manifest.hashOf !== "uncompressed-ndjson"
    || actual.sha256 !== manifest.sha256 || actual.rows !== manifest.rows) {
    throw new Error("History archive does not match its manifest");
  }
  console.log(`Verified ${actual.rows} ${manifest.table} observations for ${manifest.day}`);
} finally {
  await sql.end();
}
