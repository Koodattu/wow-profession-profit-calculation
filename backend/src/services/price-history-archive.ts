import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { env } from "../config/env";
import { sql } from "../db";

async function syncFile(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function verifyHistoryArchive(path: string): Promise<{ sha256: string; rows: number }> {
  const hash = createHash("sha256");
  let rows = 0;
  await pipeline(
    createReadStream(path),
    createGunzip(),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        for (const byte of chunk) if (byte === 10) rows++;
        callback();
      },
    }),
  );
  return { sha256: hash.digest("hex"), rows };
}

export async function archiveExpiredPriceHistory(options: { directory?: string; cutoff?: Date } = {}): Promise<void> {
  const directory = options.directory ?? env.HISTORY_ARCHIVE_DIR;
  const cutoff = options.cutoff ?? new Date(Date.now() - env.RAW_SNAPSHOT_RETENTION_DAYS * 86_400_000);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  await mkdir(directory, { recursive: true });

  for (const table of ["commodity_snapshots", "realm_snapshots"] as const) {
    const realm = table === "realm_snapshots";
    const daily = realm ? "realm_daily" : "commodity_daily";
    const average = realm ? "avg_buyout" : "avg_price";
    const minimum = realm ? "min_buyout" : "min_price";
    const maximum = realm ? "max_buyout" : "max_price";
    const dates = await sql<{ day: string }[]>`
      SELECT DISTINCT (snapshot_time AT TIME ZONE 'UTC')::date::text AS day
      FROM ${sql(table)} WHERE snapshot_time < ${cutoffDay}::date AT TIME ZONE 'UTC' ORDER BY day
    `;

    for (const { day } of dates) {
      await sql.begin("isolation level repeatable read", async (tx) => {
        const scope = realm ? tx`region_id, connected_realm_id, item_id` : tx`region_id, item_id`;
        const [coverage] = await tx<{ missing: number }[]>`
          WITH raw AS (
            SELECT ${scope}, count(*)::int AS samples, sum(total_quantity) AS quantity,
              sum(coalesce(total_value, coalesce(${tx(average)}, ${tx(minimum)})::numeric * total_quantity)) AS value,
              min(${tx(minimum)}) AS minimum, max(${tx(maximum)}) AS maximum
            FROM ${tx(table)}
            WHERE snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
              AND snapshot_time < (${day}::date + 1) AT TIME ZONE 'UTC'
            GROUP BY ${scope}
          )
          SELECT count(*)::int AS missing FROM raw r
          LEFT JOIN ${tx(daily)} d ON d.region_id = r.region_id AND d.item_id = r.item_id
            AND d.date = ${day}::date ${realm ? tx`AND d.connected_realm_id = r.connected_realm_id` : tx``}
          WHERE d.sample_count IS DISTINCT FROM r.samples
             OR d.observed_quantity IS DISTINCT FROM r.quantity
             OR d.total_value IS DISTINCT FROM r.value
             OR d.${tx(average)} IS DISTINCT FROM round(r.value / nullif(r.quantity, 0))::bigint
             OR d.avg_quantity IS DISTINCT FROM round(r.quantity / nullif(r.samples, 0))::bigint
             OR d.${tx(minimum)} IS DISTINCT FROM r.minimum
             OR d.${tx(maximum)} IS DISTINCT FROM r.maximum
        `;
        if (coverage?.missing !== 0) throw new Error(`Daily rollup coverage is incomplete for ${table} on ${day}; raw history retained`);

        const path = resolve(directory, `${table}-${day}-${randomUUID()}.ndjson.gz`);
        const pendingPath = `${path}.partial`;
        const hash = createHash("sha256");
        let rowCount = 0;
        async function* records() {
          for await (const batch of tx<{ payload: string }[]>`
            SELECT row_to_json(s)::text AS payload FROM ${tx(table)} s
            WHERE snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
              AND snapshot_time < (${day}::date + 1) AT TIME ZONE 'UTC'
            ORDER BY id
          `.cursor(2_000)) {
            for (const row of batch) {
              const line = `${row.payload}\n`;
              hash.update(line);
              rowCount++;
              yield line;
            }
          }
        }
        await pipeline(Readable.from(records()), createGzip(), createWriteStream(pendingPath, { flags: "wx", mode: 0o600 }));
        await syncFile(pendingPath);
        const expectedHash = hash.digest("hex");
        const verified = await verifyHistoryArchive(pendingPath);
        if (verified.sha256 !== expectedHash || verified.rows !== rowCount) {
          throw new Error(`Archive verification failed for ${table} on ${day}; raw history retained`);
        }
        await rename(pendingPath, path);
        const manifestPath = `${path}.json`;
        await writeFile(manifestPath, JSON.stringify({
          version: 1, table, day, rows: rowCount, sha256: expectedHash,
          hashOf: "uncompressed-ndjson", createdAt: new Date().toISOString(),
        }) + "\n", { flag: "wx", mode: 0o600 });
        await syncFile(manifestPath);
        if (process.platform !== "win32") await syncFile(directory);

        const deleted = await tx`
          DELETE FROM ${tx(table)}
          WHERE snapshot_time >= ${day}::date AT TIME ZONE 'UTC'
            AND snapshot_time < (${day}::date + 1) AT TIME ZONE 'UTC'
        `;
        if (deleted.count !== rowCount) throw new Error(`Archive row count changed for ${table} on ${day}; deletion rolled back`);
        console.log(`[Maintenance] Archived ${rowCount} ${table} rows for ${day}`);
      });
    }
  }
}
