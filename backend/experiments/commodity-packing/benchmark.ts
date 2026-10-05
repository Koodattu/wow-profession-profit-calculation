import "../../test/support/local-env";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { inspect } from "node:util";
import { createCandidate, pack, packDay, assertExact, columns, rollupQuery } from "./packing";
import { archiveDay, digestArchive } from "./archive";

const target = new URL(process.env.DATABASE_URL!);
if (target.pathname !== "/copper_commodity_packing_test") throw new Error("Dedicated copper_commodity_packing_test database required");
const output = process.env.BENCH_OUTPUT ?? "../backups/commodity-packing-20261005";
const anchor = process.env.BENCH_ANCHOR ?? "2026-10-05";
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error("Invalid anchor day");
const sample = process.env.BENCH_SAMPLE;
const label = sample ? "bounded-production" : "synthetic";
await mkdir(output, { recursive: true });
const { sql } = await import("../../src/db");
const { migrateDatabase } = await import("../../src/db/migrate");
const report: Record<string, any> = { label, anchor, checks: [], timings: {} };
const check = (name: string) => { report.checks.push(name); console.log(`PASS ${name}`); };
const dayAt = (age: number) => new Date(Date.parse(`${anchor}T00:00:00Z`)-age*86400000).toISOString().slice(0,10);
const cutoff = dayAt(2);
const edgeDay = dayAt(5);
const median = (values: number[]) => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]!;

async function sizes() {
  return [...await sql`SELECT n.nspname AS schema,c.relname AS relation,
    pg_relation_size(c.oid)::float8 AS heap_bytes,pg_indexes_size(c.oid)::float8 AS index_bytes,
    CASE WHEN c.reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END::float8 AS toast_bytes,
    pg_total_relation_size(c.oid)::float8 AS total_bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname IN ('packing_baseline','packing_candidate') AND c.relkind='r')
      OR (n.nspname='public' AND c.relname IN ('items','regions','commodity_snapshots_id_seq','commodity_daily_id_seq'))
    ORDER BY n.nspname,c.relname`];
}

async function probe(schema: string, mode = "stable") {
  const path = join(output, `${label}-${schema}${mode === 'legacy' ? '-legacy' : ''}.json`);
  const child = Bun.spawn([process.execPath,"run","--no-env-file",join(import.meta.dir,"app-probe.ts"),schema,path,anchor,mode],
    { env: process.env, stdout: "pipe",stderr: "pipe" });
  const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if (code) {
    await writeFile(join(output,`${label}-${schema}-error.log`),stdout+stderr);
    throw new Error(`Application probe failed; private diagnostic saved for ${schema}`);
  }
  return JSON.parse(await readFile(path,"utf8"));
}

async function queryBenchmark(name: string, baseline: string, candidate: string, parameters: string[] = []) {
  const timing: Record<string, number[]> = { baseline: [],candidate: [] };
  for (let run=0; run<9; run++) {
    for (const kind of run%2 ? ["candidate","baseline"] : ["baseline","candidate"]) {
      const query = kind === "baseline" ? baseline : candidate;
      const [plan] = await sql.unsafe(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`,parameters);
      const data = plan!["QUERY PLAN"][0];
      if (run>=2) timing[kind]!.push(Number(data["Execution Time"]));
      if (run===8) await writeFile(join(output,`${label}-${name}-${kind}-plan.json`),JSON.stringify(data,null,2));
    }
  }
  report.timings[name] = { ...timing,baseline_median_ms: median(timing.baseline!),candidate_median_ms: median(timing.candidate!) };
}

try {
  await migrateDatabase();
  await sql`SET statement_timeout='60s'`;
  await sql`SET lock_timeout='2s'`;
  await sql`SET timezone='UTC'`;
  // Only these two experiment-owned schemas are reset. Public application fixtures are preserved.
  await sql.unsafe(`DROP SCHEMA IF EXISTS packing_candidate CASCADE; DROP SCHEMA IF EXISTS packing_baseline CASCADE;
    CREATE SCHEMA packing_baseline;
    CREATE TABLE packing_baseline.commodity_snapshots (LIKE public.commodity_snapshots INCLUDING ALL);
    CREATE TABLE packing_baseline.commodity_daily (LIKE public.commodity_daily INCLUDING ALL);
    CREATE TABLE packing_baseline.sync_jobs (LIKE public.sync_jobs INCLUDING ALL);`);
  let fixture = await readFile(join(import.meta.dir,"fixture.sql"),"utf8");
  if (sample) {
    const bytes = await readFile(sample);
    assert(bytes.length<=100*1024*1024,"Sample byte cap exceeded");
    const records = bytes.toString("utf8").trim().split("\n").filter(Boolean);
    assert(records.length<=100000,"Sample row cap exceeded");
    for (let offset=0; offset<records.length; offset+=500) {
      // Preserve numeric lexemes and microseconds: the database parses raw JSON.
      await sql.unsafe(`INSERT INTO packing_baseline.commodity_snapshots
        SELECT * FROM json_populate_recordset(NULL::public.commodity_snapshots,$1::json)`,
        [`[${records.slice(offset,offset+500).join(",")}]`]);
    }
    report.sample = { observation_rows: records.length,uncompressed_bytes: bytes.length,
      profile: await sql`SELECT region_id,(snapshot_time AT TIME ZONE 'UTC')::date::text AS day,
        count(*)::int AS observations,count(DISTINCT item_id)::int AS items
        FROM packing_baseline.commodity_snapshots GROUP BY region_id,(snapshot_time AT TIME ZONE 'UTC')::date ORDER BY day,region_id` };
    fixture = fixture.slice(fixture.indexOf("-- Different IDs"));
  }
  await sql.unsafe(fixture.replaceAll(":'anchor'", `'${anchor}'`));
  await sql`INSERT INTO public.regions(id,name,api_host)
    SELECT DISTINCT region_id,'Local benchmark','example.invalid' FROM packing_baseline.commodity_snapshots ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.items(id,name)
    SELECT DISTINCT item_id,'Local benchmark' FROM packing_baseline.commodity_snapshots ON CONFLICT DO NOTHING`;
  await sql.unsafe(`ALTER TABLE packing_baseline.commodity_snapshots ADD FOREIGN KEY(region_id) REFERENCES public.regions(id);
    ALTER TABLE packing_baseline.commodity_snapshots ADD FOREIGN KEY(item_id) REFERENCES public.items(id);`);
  await sql.unsafe("VACUUM (FULL,ANALYZE) packing_baseline.commodity_snapshots");
  await createCandidate(sql);
  const [counts] = await sql`SELECT count(*)::int AS rows,count(DISTINCT (region_id,item_id))::int AS item_regions,
    count(DISTINCT (snapshot_time AT TIME ZONE 'UTC')::date)::int AS days,
    count(*) FILTER (WHERE snapshot_time<${cutoff}::date AT TIME ZONE 'UTC')::int AS packable_rows,
    count(*) FILTER (WHERE snapshot_time>=${cutoff}::date AT TIME ZONE 'UTC')::int AS recent_rows
    FROM packing_baseline.commodity_snapshots`;
  report.dataset = counts;
  report.runtime = (await sql`SELECT version(),current_setting('shared_buffers') AS shared_buffers,
    current_setting('work_mem') AS work_mem,current_setting('default_toast_compression') AS compression`)[0];
  report.sizes_before = await sizes();
  const legacyBaseline = await probe("packing_baseline","legacy");
  const baselineProbe = await probe("packing_baseline");

  // Corrupt the candidate, prove the verification rejects it, and check rollback.
  await sql.unsafe(`CREATE FUNCTION packing_candidate.corrupt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.observations=jsonb_set(NEW.observations,'{0,price_p10}','-1'::jsonb); RETURN NEW; END $$;
    CREATE TRIGGER corrupt BEFORE INSERT ON packing_candidate.commodity_history_blocks
      FOR EACH ROW EXECUTE FUNCTION packing_candidate.corrupt();`);
  await assert.rejects(packDay(sql,edgeDay),/reconstruction failed/);
  await sql.unsafe("DROP TRIGGER corrupt ON packing_candidate.commodity_history_blocks; DROP FUNCTION packing_candidate.corrupt()");
  await assertExact(sql);
  check("corrupt percentile rejected and day transaction rolled back");

  const [beforeWal] = await sql`SELECT pg_current_wal_insert_lsn()::text AS lsn`;
  const started = performance.now();
  report.packing = await pack(sql,cutoff);
  report.packing.elapsed_ms = performance.now()-started;
  report.packing.wal_bytes = Number((await sql`SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),${beforeWal!.lsn}::pg_lsn)::text AS n`)[0]!.n);
  await assertExact(sql);
  check("every original column reconstructed exactly with EXCEPT ALL in both directions");
  assert.equal((await pack(sql,cutoff)).rows,0);
  const [recent] = await sql`SELECT count(*)::int AS n FROM packing_candidate.commodity_raw`;
  assert.equal(recent!.n,counts!.recent_rows);
  check("repeated packing is a no-op and recent mutable observations remain raw");
  report.sizes_after_packing = await sizes();
  const compactStarted = performance.now();
  await sql.unsafe("VACUUM (FULL,ANALYZE) packing_candidate.commodity_raw");
  await sql.unsafe("VACUUM (FULL,ANALYZE) packing_candidate.commodity_history_blocks");
  report.local_rewrite_ms = performance.now()-compactStarted;
  await assertExact(sql);
  const legacyCandidate = await probe("packing_candidate","legacy");
  const legacyDifferences = Object.keys(legacyBaseline.checks).filter(key => legacyBaseline.checks[key] !== legacyCandidate.checks[key]);
  // Do not hide the defect: only the deliberately ambiguous synthetic item may
  // differ. Every real item and all daily/HTTP/recipe responses still match.
  assert(legacyDifferences.every(key => /^eu:(7d|14d|30d)(:2100100091)?$/.test(key)),"Unexpected legacy application difference");
  report.legacy_reader = { changed_checks: legacyDifferences,required_fix: "snapshot_time DESC, id DESC for all five commodity chart values" };
  const candidateProbe = await probe("packing_candidate");
  assert.deepEqual(candidateProbe.checks,baselineProbe.checks);
  check("all item HTTP/history/recipe/daily results match with the opt-in stable reader, including independently checked duplicate timestamps");
  report.application = { baseline: baselineProbe.latency,candidate: candidateProbe.latency,checks: Object.keys(candidateProbe.checks).length };
  report.sizes_after_rewrite = await sizes();
  report.blocks = await sql`SELECT region_id,count(*)::int AS blocks,
    round(avg(jsonb_array_length(observations)),2)::text AS mean_observations,
    round(avg(pg_column_size(observations)),1)::text AS mean_stored_bytes,
    count(*) FILTER (WHERE jsonb_array_length(observations)<=3)::int AS sparse_blocks
    FROM packing_candidate.commodity_history_blocks GROUP BY region_id ORDER BY region_id`;
  report.block_density = await sql`SELECT CASE WHEN jsonb_array_length(observations)<=3 THEN '1-3'
    WHEN jsonb_array_length(observations)<20 THEN '4-19' ELSE '20+' END AS samples_per_block,
    count(*)::int AS blocks,sum(jsonb_array_length(observations))::int AS observations,
    round(avg(pg_column_size(observations)),1)::text AS mean_stored_bytes
    FROM packing_candidate.commodity_history_blocks GROUP BY 1 ORDER BY 1`;
  const ids = (await sql`SELECT DISTINCT item_id FROM packing_baseline.commodity_snapshots WHERE region_id='eu' ORDER BY item_id LIMIT 32`).map(r => r.item_id);
  const idsSql = ids.join(",");
  const old = "packing_baseline.commodity_snapshots";
  const view = "packing_candidate.commodity_history";
  for (const count of [1,32]) {
    const filter = `region_id='eu' AND item_id IN (${ids.slice(0,count).join(",")}) AND snapshot_time>=$1::date AT TIME ZONE 'UTC'`;
    const chart = (relation: string, extra: string) => `SELECT item_id,date_trunc('hour',snapshot_time) AS hour,
      (array_agg(min_price ORDER BY snapshot_time DESC,id DESC))[1] AS min_price,
      (array_agg(avg_price ORDER BY snapshot_time DESC,id DESC))[1] AS avg_price,
      (array_agg(median_price ORDER BY snapshot_time DESC,id DESC))[1] AS median_price,
      (array_agg(max_price ORDER BY snapshot_time DESC,id DESC))[1] AS max_price,
      (array_agg(total_quantity ORDER BY snapshot_time DESC,id DESC))[1] AS total_quantity
      FROM ${relation} WHERE ${filter} ${extra} GROUP BY item_id,date_trunc('hour',snapshot_time) ORDER BY item_id,hour DESC`;
    await queryBenchmark(`chart-${count}-items`,chart(old,""),chart(view,"AND history_day>=$1::date"),[dayAt(29)]);
  }
  await queryBenchmark("full-record-export",`SELECT ${columns} FROM ${old} WHERE region_id='eu' AND item_id IN (${idsSql}) ORDER BY item_id,snapshot_time,id`,
    `SELECT ${columns} FROM ${view} WHERE region_id='eu' AND item_id IN (${idsSql}) ORDER BY item_id,snapshot_time,id`);
  await queryBenchmark("weighted-daily-full",rollupQuery(old),rollupQuery(view));
  await queryBenchmark("weighted-daily-incremental",
    rollupQuery(`(SELECT * FROM ${old} WHERE snapshot_time >= $1::date AT TIME ZONE 'UTC') s`),
    rollupQuery(`(SELECT * FROM ${view} WHERE history_day >= $1::date AND snapshot_time >= $1::date AT TIME ZONE 'UTC') s`),[dayAt(1)]);
  await queryBenchmark("recent-32-items",
    `SELECT ${columns} FROM ${old} WHERE region_id='eu' AND item_id IN (${idsSql}) AND snapshot_time >= $1::date AT TIME ZONE 'UTC' ORDER BY item_id,snapshot_time,id`,
    `SELECT ${columns} FROM ${view} WHERE region_id='eu' AND item_id IN (${idsSql}) AND history_day >= $1::date AND snapshot_time >= $1::date AT TIME ZONE 'UTC' ORDER BY item_id,snapshot_time,id`,[dayAt(1)]);
  const writes: Record<string, number[]> = { baseline: [],candidate: [] };
  const rollback = new Error("Intentional local write benchmark rollback");
  for (let run=0;run<9;run++) {
    for (const kind of run%2 ? ["candidate","baseline"] : ["baseline","candidate"]) {
      const table = kind === "baseline" ? old : "packing_candidate.commodity_raw";
      try {
        await sql.begin(async (tx) => {
          const [plan] = await tx.unsafe(`EXPLAIN (ANALYZE,WAL,BUFFERS,FORMAT JSON)
            INSERT INTO ${table} SELECT 9007199254840000+row_number() OVER(),region_id,item_id,
              $1::date+interval '12 hours',min_price,avg_price,median_price,max_price,total_quantity,num_auctions,price_p10,price_p25,total_value
            FROM (SELECT * FROM ${old} ORDER BY id LIMIT 512) s`,[anchor]);
          if (run>=2) writes[kind]!.push(Number(plan!["QUERY PLAN"][0]["Execution Time"]));
          throw rollback;
        });
      } catch (error) { if (error !== rollback) throw error; }
    }
  }
  report.timings["insert-512-rows"] = { ...writes,baseline_median_ms: median(writes.baseline!),candidate_median_ms: median(writes.candidate!) };
  await assertExact(sql);
  check("paired 512-row ingestion timings rolled back without changing either dataset");

  // Late arrivals into an already packed day must augment its existing weights.
  const late = `SELECT 9007199254741999::bigint AS id,region_id,item_id,snapshot_time+interval '5 microseconds',
    min_price,avg_price,median_price,max_price,total_quantity,num_auctions,price_p10,price_p25,total_value
    FROM packing_baseline.commodity_snapshots WHERE id=9007199254740993`;
  await sql.unsafe(`INSERT INTO packing_candidate.commodity_raw ${late}`);
  await sql.unsafe(`INSERT INTO packing_baseline.commodity_snapshots ${late}`);
  const lateStarted = performance.now();
  await Promise.all([packDay(sql,edgeDay),packDay(sql,edgeDay)]);
  report.late_repack_ms = performance.now()-lateStarted;
  await assertExact(sql);
  check("late microsecond arrival and concurrent repeated packers preserve multiplicity");
  const archives = join(output,`${label}-archives`);
  await assert.rejects(archiveDay(sql,archives,edgeDay,new Date(`${anchor}T12:00:00Z`)),/30-day detailed retention/);
  check("30-day detailed retention refuses archival of the recent fixture");
  const futureArchiveTime = new Date(Date.parse(`${anchor}T12:00:00Z`)+31*86400000);
  await assert.rejects(archiveDay(sql,archives,edgeDay,futureArchiveTime),/coverage is incomplete/);
  await assertExact(sql);
  check("stale daily totals prevent archival deletion");
  // Recompute exactly the affected day for the archive test.
  await sql`DELETE FROM packing_candidate.commodity_daily WHERE date=${edgeDay}::date`;
  await sql.unsafe(`INSERT INTO packing_candidate.commodity_daily
    (region_id,item_id,date,min_price,avg_price,max_price,avg_quantity,total_value,observed_quantity,sample_count,average_is_exact)
    ${rollupQuery(`(SELECT * FROM ${view} WHERE history_day=$1::date) s`)}`, [edgeDay]);
  const [weighted] = await sql`SELECT avg_price::text,total_value::text,observed_quantity::text,sample_count
    FROM packing_candidate.commodity_daily WHERE region_id='eu' AND item_id=2100100091 AND date=${edgeDay}::date`;
  assert.deepEqual(weighted,{ avg_price: "53",total_value: "950",observed_quantity: "18",sample_count: 4 });
  check("independent weighted average 950/18 rounds once to 53, including unequal prices at duplicate timestamps");
  const { verifyHistoryArchive } = await import("../../src/services/price-history-archive");
  await sql.unsafe("CREATE TABLE packing_candidate.recovered (LIKE packing_baseline.commodity_snapshots INCLUDING ALL)");
  const archiveDays = await sql`SELECT DISTINCT (snapshot_time AT TIME ZONE 'UTC')::date::text AS day
    FROM packing_baseline.commodity_snapshots ORDER BY day`;
  const recoveredArchives = [];
  const archiveStart = performance.now();
  for (const {day} of archiveDays) {
    const archived = await archiveDay(sql,archives,day,futureArchiveTime);
    assert.deepEqual(await verifyHistoryArchive(archived.path),{ rows: archived.rows,sha256: archived.sha256 });
    const bytes = await readFile(archived.path);
    const lines = gunzipSync(bytes).toString("utf8").trim().split("\n");
    for (let i=0; i<lines.length; i+=500) await sql.unsafe(`INSERT INTO packing_candidate.recovered
      SELECT * FROM json_populate_recordset(NULL::public.commodity_snapshots,$1::json)`, [`[${lines.slice(i,i+500).join(",")}]`]);
    recoveredArchives.push({...archived,compressed_bytes: bytes.length});
  }
  const [recovery] = await sql.unsafe(`WITH differences AS (
    (SELECT ${columns} FROM ${old} EXCEPT ALL SELECT * FROM packing_candidate.recovered)
    UNION ALL (SELECT * FROM packing_candidate.recovered EXCEPT ALL SELECT ${columns} FROM ${old}))
    SELECT count(*)::int AS n FROM differences`);
  assert.equal(recovery!.n,0);
  const [left] = await sql`SELECT count(*)::int AS n FROM packing_candidate.commodity_history`;
  assert.equal(left!.n,0);
  check("existing archive verifier and SQL recovery reproduce every record, from both packed blocks and recent raw rows");
  const corrupt = join(archives,"corrupt-fixture.ndjson.gz");
  await writeFile(corrupt,(await readFile(recoveredArchives[0]!.path)).subarray(0,20));
  await assert.rejects(digestArchive(corrupt));
  check("truncated gzip archive is rejected");
  report.archive = { files: recoveredArchives.length,rows: recoveredArchives.reduce((n,a) => n+a.rows,0),
    compressed_bytes: recoveredArchives.reduce((n,a) => n+a.compressed_bytes,0),
    archive_verify_recover_ms: performance.now()-archiveStart };
  await writeFile(join(output,`${label}-result.json`),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({ dataset: report.dataset,checks: report.checks.length,packing_ms: report.packing.elapsed_ms,
    result: join(output,`${label}-result.json`) }));
} catch (error) {
  // SQL diagnostics can include private sample parameters. Never print them.
  await writeFile(join(output,`${label}-failure.log`),inspect(error,{ depth: 5 }));
  console.error(`Benchmark failed; private diagnostic: ${join(output,`${label}-failure.log`)}`);
  process.exitCode = 1;
} finally { await sql.end(); }
