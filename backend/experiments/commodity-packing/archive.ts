import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import type { Sql } from "postgres";
import { columns, rollupQuery } from "./packing";

async function flush(path: string) {
  const file = await open(path, process.platform === "win32" ? "r+" : "r");
  try { await file.sync(); } finally { await file.close(); }
}

export async function digestArchive(path: string) {
  const hash = createHash("sha256");
  let rows = 0;
  await pipeline(createReadStream(path), createGunzip(), new Writable({
    write(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      for (const byte of chunk) if (byte === 10) rows++;
      callback();
    },
  }));
  return { sha256: hash.digest("hex"), rows };
}

// Prototype of the small commodity-source change needed in price-history-archive.ts.
// The manifest and recovered row type are unchanged; never serialize numerics in JS.
export async function archiveDay(sql: Sql, directory: string, day: string, now = new Date()) {
  const cutoffDay = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  if (day >= cutoffDay) throw new Error("Day is still inside 30-day detailed retention");
  await mkdir(directory, { recursive: true });
  return sql.begin("isolation level repeatable read", async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('commodity-packing-experiment',0))`;
    await tx`SET LOCAL lock_timeout='2s'`;
    await tx`LOCK TABLE packing_candidate.commodity_raw IN SHARE ROW EXCLUSIVE MODE`;
    const daily = rollupQuery("(SELECT * FROM packing_candidate.commodity_history WHERE history_day=$1::date) observations");
    const [coverage] = await tx.unsafe(`WITH expected AS (${daily}), stored AS (
      SELECT region_id,item_id,date,min_price,avg_price,max_price,avg_quantity,total_value,
        observed_quantity,sample_count,average_is_exact FROM packing_candidate.commodity_daily WHERE date=$1::date
    ) SELECT count(*)::int AS missing FROM (SELECT * FROM expected EXCEPT ALL SELECT * FROM stored) d`, [day]);
    if (coverage!.missing) throw new Error("Daily rollup coverage is incomplete; observations retained");
    const path = join(directory, `commodity_snapshots-${day}-${randomUUID()}.ndjson.gz`);
    const partial = `${path}.partial`;
    const hash = createHash("sha256");
    let rows = 0;
    async function* records() {
      for await (const batch of tx.unsafe(`SELECT row_to_json(s)::text AS payload
        FROM (SELECT ${columns} FROM packing_candidate.commodity_history WHERE history_day=$1::date ORDER BY id) s`, [day]).cursor(2000)) {
        for (const row of batch) {
          const line = `${row.payload}\n`;
          hash.update(line);
          rows++;
          yield line;
        }
      }
    }
    await pipeline(Readable.from(records()), createGzip(), createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    await flush(partial);
    const sha256 = hash.digest("hex");
    const verified = await digestArchive(partial);
    if (verified.rows !== rows || verified.sha256 !== sha256) throw new Error("Archive verification failed");
    await rename(partial, path);
    const manifest = `${path}.json`;
    await writeFile(manifest, JSON.stringify({ version: 1, table: "commodity_snapshots", day, rows, sha256,
      hashOf: "uncompressed-ndjson", createdAt: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 });
    await flush(manifest);
    if (process.platform !== "win32") await flush(directory);
    const raw = await tx`DELETE FROM packing_candidate.commodity_raw
      WHERE snapshot_time>=${day}::date AT TIME ZONE 'UTC'
        AND snapshot_time<(${day}::date+1) AT TIME ZONE 'UTC'`;
    const blocks = await tx`DELETE FROM packing_candidate.commodity_history_blocks WHERE day=${day}::date
      RETURNING jsonb_array_length(observations) AS n`;
    if (raw.count + blocks.reduce((n, b) => n + Number(b.n), 0) !== rows) throw new Error("Archive deletion count mismatch");
    return { path, rows, sha256 };
  });
}
