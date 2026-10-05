# Commodity history packing experiment

Measured 2026-10-05 against source commit `2a404ca`. This is an opt-in local
prototype based on the existing realm history implementation. Application source,
migrations, configuration and default behavior are unchanged. Nothing was deployed
or committed, and production access was read-only.

**Decision: proceed with a focused production implementation and its integration
tests; do not roll out this experiment directly.** Packing preserved every stored
observation and reduced compacted history storage by 52.4% on both fixtures.
Reading older data costs more CPU, and deployment requires a deterministic chart
tie-breaker, day pruning, archive integration and a separate disk reclamation plan.

## Data and method

The baseline has the original commodity snapshot columns, indexes and item/region
foreign keys. The candidate retains recent rows in an equivalent raw table and
packs older rows into JSONB arrays keyed by `(region_id, item_id, day)`, with a
separate day index. A union view reconstructs the original SQL types. There is no
locator table, dictionary or additional per-observation index.

Both layouts start with identical records. Packing uses one transaction per UTC
day, an advisory lock and a raw-table writer lock. It merges late arrivals, checks
both directions with `EXCEPT ALL`, then deletes the verified raw rows. The latest
three UTC calendar days stay raw: at the fixed anchor of October 5, packing only
touches timestamps before October 3. This storage change retains the existing
30-day detailed-history policy, daily rollups and gzip archives.

Two datasets were measured:

| Dataset | Original observations | Item/region pairs | UTC days | Packed observations | Recent raw observations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Synthetic | 45,405 | 99 | 30 | 41,517 | 3,888 |
| Bounded production sample plus seven synthetic edge records | 11,114 | 67 | 11 | 8,060 | 3,054 |

The synthetic fixture covers EU/US, dense and sparse items, missed observations,
null fields, unequal prices at duplicate timestamps, IDs above JavaScript's safe
integer range, microsecond timestamps, zero quantities and a 40-digit total.

The explicitly authorized read-only SSH export copied **11,107 observations and
3,162,107 bytes (3.02 MiB)** in one successful extraction. Its independent SQL and
client caps were 32,000 observations and 24 MiB. The retained budget ledger reserves
that full allowance against the task's cumulative 100,000-observation / 100 MiB
limit; failed attempts also consume reservations. No full database, dump or volume
was copied, and the export created no remote files or tables.

The sample contains 64 EU items on nine non-contiguous dates: September 7, 14, 21,
25, 28 and October 1-4. Selection uses dense/middle/sparse daily-count cohorts from
September 29 and October 1-2, deterministic hashed item ordering and indexed
item/day reads capped at 32 observations each. Item and region reference names are
local placeholders. No real US observations were returned; US coverage is synthetic.

Sample SHA-256:
`6e736b8d710cc81bbd9d0a3c3caa2fe9bd196eec25242371ca3e5c6783244a41`.
The sample, ledger, detailed results, plans, chart inputs and archives remain in the
Git-ignored repository directory `backups/commodity-packing-20261005/`.

PostgreSQL was `16.10-alpine3.22`, with `pglz`, 128 MiB shared buffers and 4 MiB
work memory. PostgreSQL and the separate Bun 1.3.14 runner each had a two-CPU,
1 GiB container limit. SQL timings are server execution times from
`EXPLAIN (ANALYZE, BUFFERS)`: two warmups and seven measured runs, alternating
layouts. The real application service also ran two warmups and seven measurements
per request; those service runs were sequential by layout, not alternating.
These are small, warm-cache local measurements, not production latency forecasts.

## Storage results

Sizes use `pg_total_relation_size`, including heap, indexes, TOAST and relation
forks. History means the original raw table versus candidate raw plus blocks.
The broader totals also count allocated daily rollups, sync bookkeeping and common
item/region reference tables and shared sequences, once per alternative. Ordinary
application tables unrelated to commodity history are excluded from both.

| Dataset / scope | Baseline bytes | Candidate bytes after local rewrite | Reduction |
| --- | ---: | ---: | ---: |
| Synthetic history | 8,536,064 | 4,063,232 | 52.40% |
| Synthetic, all counted structures | 9,297,920 | 4,816,896 | 48.19% |
| Sample plus edges, history | 2,220,032 | 1,056,768 | 52.40% |
| Sample plus edges, all counted structures | 2,588,672 | 1,425,408 | 44.94% |

The sample candidate's final history allocation is 663,552 bytes of recent raw
storage plus 393,216 bytes of blocks. The baseline history is 2.117 MiB and the
candidate is 1.008 MiB. Reference tables are shared across fixture runs, so their
allocated pages include the union of local reference stubs; both layouts count
the same allocation.

**Packing alone does not deliver that physical reduction.** Before the local
`VACUUM FULL`, candidate history occupied 12,894,208 bytes for synthetic data and
2,875,392 bytes for the sample: new blocks coexist with allocated raw-table pages.
The harness explicitly rewrites only its local candidate tables and measures
again. The baseline is also compacted before comparison. The numbers measure
PostgreSQL relation allocations, not host free space or Docker Desktop VHD shrinkage.
No production disk space was reclaimed by this work.

| Operation | Synthetic | Sample plus edges |
| --- | ---: | ---: |
| Initial packing | 1,115 ms | 222 ms |
| WAL generated during initial packing | 6,417,240 bytes | 1,040,456 bytes |
| Local candidate table rewrites | 42.5 ms | 28.5 ms |
| Archive, verify and recover every record | 3,693 ms | 1,017 ms |
| Gzip output for that recovery run | 2,135,416 bytes | 220,890 bytes |

The archive figures include one added late observation: 45,406 recovered records
in 30 files and 11,115 in 11 files. Archives are a subsequent retention/recovery
test, not an extra live storage structure needed by packing. Existing archives
and backups would still consume their normal disk space in production. Temporary
tables, WAL, recovery tables and older local test artifacts are not included in
the steady-state relation totals.

Dense sample blocks with at least 20 observations average 851 bytes of stored JSONB
for 6,880 observations across 289 blocks. The four sample blocks with one to three
observations average 715 bytes. Synthetic sparse blocks average 708 bytes for about
two observations. Packing very sparse days can cost more than keeping their rows;
the aggregate result is dominated by dense items.

Applying the sample's 52.4% history reduction to the previously observed
1,187 MiB production commodity table gives a **conditional estimate of about
622 MiB (0.61 GiB)** after reclamation. This replaces the earlier unmeasured realm
analogy. It is not a measured production saving: sample selection, recent-row
proportion, data compressibility and existing bloat can all change the result.

## Read and write cost

Median milliseconds; each cell is baseline -> candidate.

| Operation | Synthetic | Sample plus edges |
| --- | ---: | ---: |
| SQL hourly chart, one EU item | 1.030 -> 2.099 | 0.241 -> 0.511 |
| SQL hourly chart, 32 EU items | 25.211 -> 68.284 | 6.101 -> 14.276 |
| SQL full-record export, 32 EU items | 12.077 -> 49.817 | 2.811 -> 10.573 |
| SQL full weighted daily recomputation | 15.961 -> 127.411 | 3.678 -> 20.279 |
| SQL incremental recent daily recomputation | 0.970 -> 1.338 | 0.566 -> 0.851 |
| SQL recent observations, 32 EU items | 0.532 -> 0.692 | 0.334 -> 0.470 |
| Insert 512 rows, including foreign-key checks | 11.090 -> 10.502 | 10.496 -> 10.574 |
| Actual history service, one EU item / 30d | 3.645 -> 4.402 | 2.119 -> 1.720 |
| Actual history service, 32 EU items / 30d | 57.566 -> 87.204 | 15.645 -> 21.542 |
| Actual observation component and CSV generation | 365.819 -> 373.770 | 95.982 -> 94.108 |

JSONB expansion makes older-data scans slower. Full daily backfills were 5.5-8.0x
slower, which makes an explicit `history_day` predicate important for routine
incremental maintenance. The SQL chart/recent queries prototype that predicate.
The application service probe uses the existing reader through an adapter view
and does not add day pruning; it includes query, driver and JavaScript work but
not network or browser rendering. Tiny apparent improvements are measurement
noise, not evidence of faster reads or writes. Insert timings exclude commit and
are rolled back after each run.

The CSV measurement renders the existing `HistoryRecords` component in jsdom for
one item's complete hourly chart series. It verifies every downloadable row,
including those beyond the visible page, and identical CSV output between layouts.
It is not a browser performance test or a raw database export measurement; the
separate SQL export row above covers all original columns for the selected items.

## Correctness and the required reader fix

The unmodified chart reader orders values by `snapshot_time DESC` alone. Two
observations with the same timestamp and different prices have no defined winner.
Packing changes physical order and exposed different chart results for the
deliberately ambiguous synthetic item. No real sampled item differed in the
legacy comparison. This is a reader ambiguity, not a lost observation.

`app-probe.ts` applies an opt-in, in-memory Bun source transform to all five
commodity chart aggregates: `snapshot_time DESC, id DESC`. It requires exactly
five matching expressions so a future source change fails visibly. Both layouts
use this same rule, and an independent assertion checks that the higher original
ID selects price 99 and median 99 for the duplicate timestamp. The legacy result
differences are retained in the result JSON instead of being hidden. No production
source was edited to apply this proposed behavior.

Verification completed:

- Bidirectional SQL `EXCEPT ALL` checks on all 13 original columns after packing,
  rewrite, repeat packing and late arrival. SQL preserves original integer IDs,
  microsecond timestamps, nulls, quantities, auction counts, p10/p25 and
  `numeric(40,0)` values; the storage/archive path never parses these into JS numbers.
- Corrupted percentile injection rejects packing and rolls back the whole day.
  Repeated packing is a no-op; concurrent repeated packers merge a late observation
  without changing multiplicity. Recent observations remain raw.
- Existing history service output for every fixture item across 24h, 7d, 14d, 30d,
  6m, 1y and all ranges, weighted daily output, missing-item behavior, an actual
  EU item HTTP route and recipe history with a synthetic valuation. There were
  716 synthetic and 492 sample service/response fingerprints per layout, identical
  with the proposed tie-breaker.
- An independent daily average assertion: total value 950 / quantity 18 rounds
  once to 53 across four observations, including duplicate times and a late row.
- Recent archival is refused under the 30-day rule, and stale daily totals prevent
  deletion. With the clock advanced by 31 days, every packed and raw observation
  is archived, checked by the existing archive verifier, recovered through SQL and
  compared against the baseline in both directions. A truncated gzip is rejected.
- Both complete benchmark runs passed all 11 check groups each. The frontend
  component passed 18 CSV equality tests across the two datasets. Backend
  TypeScript, frontend TypeScript and targeted frontend ESLint passed; the existing
  backend unit suite passed 43 tests / 125 assertions.

This validates exact storage and compatibility with existing application
serialization; it does not make existing JavaScript numeric APIs more precise.
No power-loss or disk-full fault injection, production-scale concurrent ingestion,
cold-cache test, full application integration suite or browser build was performed.
The sample favors items present in late September, covers selected dates rather
than a continuous window, contains no real US data and has 27.5% recent raw rows.
It is not a catalog-weighted estimate of production workload or space.

## Reproduce locally

Use the repository's existing backend/frontend dependencies, Docker Desktop and
PowerShell. These commands use only the dedicated local benchmark container and
test database. The runner checks the local Docker endpoint and container purpose
label; database entry points require localhost and the exact test database name.

From the repository root, create the container once (the credentials are disposable
local test values):

```powershell
docker pull postgres:16.10-alpine3.22
docker pull oven/bun:1.3.14-alpine
docker run --detach --name copper-commodity-packing-20261005 --label purpose=commodity-packing-benchmark --cpus=2 --memory=1g -p 127.0.0.1:55435:5432 -e POSTGRES_USER=copper_bench -e POSTGRES_PASSWORD=copper_bench -e POSTGRES_DB=copper_commodity_packing_test postgres:16.10-alpine3.22
```

For an existing stopped benchmark container, use
`docker start copper-commodity-packing-20261005` instead. Wait for
`docker exec copper-commodity-packing-20261005 pg_isready -U copper_bench -d copper_commodity_packing_test`
to report accepting connections, then run:

```powershell
& .\backend\experiments\commodity-packing\run-local.ps1 -Dataset synthetic
& .\backend\experiments\commodity-packing\run-local.ps1 -Dataset sample
```

The second command reuses the saved bounded sample and refuses to run if it is
missing. Neither command contacts production. A run recreates only the two
experiment schemas, applies existing application migrations in the dedicated
test database and inserts local reference stubs. It replaces that dataset's result
JSON and adds uniquely named archives. The final archive/recovery checks empty the
candidate history deliberately; the baseline and recovered table retain the data.
Do not point this harness at another database or change its guards.

The one-time authorized export was run from the repository root with
`python backend/experiments/commodity-packing/extract_sample.py`. It is not needed
for reproduction here: the script refuses to overwrite the existing sample.
Retain its ledger, including any failed reservations, and reuse the current sample.

After the backend runs, exercise the actual frontend component:

```powershell
Push-Location frontend
npm test -- --config experiments/commodity-packing/vitest.config.mts
$env:COMMODITY_PACKING_DATASET = 'bounded-production'
npm test -- --config experiments/commodity-packing/vitest.config.mts
Remove-Item Env:COMMODITY_PACKING_DATASET
Pop-Location
```

Static checks and existing backend unit tests:

```powershell
Push-Location backend
bun run typecheck
bun test
Pop-Location
Push-Location frontend
npx tsc --noEmit
npx eslint experiments/commodity-packing/check.ts experiments/commodity-packing/vitest.config.mts
Pop-Location
```

Stop only the benchmark container when finished, retaining its database:
`docker stop copper-commodity-packing-20261005`.

The source files are:

| File | Purpose |
| --- | --- |
| `fixture.sql` | Deterministic dense/sparse data and precision cases |
| `packing.ts` | Candidate tables, exact reconstruction, packing and weighted SQL |
| `archive.ts` | Local prototype of packed/raw archive source and verified deletion |
| `app-probe.ts` | Existing application readers and explicit tie-breaker experiment |
| `benchmark.ts` | Paired storage/performance measurement and recovery assertions |
| `extract_sample.py` | Capped read-only export and cumulative reservation ledger |
| `run-local.ps1` | Dedicated local Docker runner |
| `../../../frontend/experiments/commodity-packing/` | Opt-in real CSV component check |

## Minimum production change proposal

1. Add `commodity_history_blocks` with the demonstrated key, day index and foreign
   keys, plus a typed `commodity_history` read view. Keep the actual
   `commodity_snapshots` table, sequence, indexes and ingestion path. The experiment's
   view named `commodity_snapshots` is only a reader adapter and must not become the
   production write target. Add migration checks for empty and populated fixtures.
2. Point commodity history reads at the union view; add explicit day bounds and the
   `snapshot_time DESC, id DESC` tie-breaker for all five chart values. Use the same
   day pruning for incremental daily aggregation. Preserve public response fields,
   quantity weighting and all existing range behavior.
3. Extend commodity archive day discovery and reads to raw plus packed data.
   Preserve the current original-column NDJSON and manifest format, SQL numeric
   serialization, fsync/hash verification, daily coverage requirement and verified
   raw-plus-block deletion. Keep the detailed retention at 30 days and existing
   daily/archive retention unchanged.
4. Integrate one-day packing into maintenance after archival, using one shared
   commodity maintenance advisory lock and the raw writer lock. Backfill in bounded
   day batches between refreshes. Test pack/ingestion/archive concurrency, rollback,
   late observations, deterministic chart values and full recovery in the normal
   integration suite before enabling production packing. Preserve the original
   sequence so newly ingested IDs cannot collide with packed observations.
5. Plan physical reclamation as a separate maintenance operation. Remeasure disk
   and relation allocations, available recovery material and other workloads first.
   The earlier shared-server reading was about 12 GiB free on a 75 GiB filesystem;
   it is not a current guarantee. A preliminary additional working-space budget of
   roughly 3-4 GiB for blocks, rewrite scratch, indexes and WAL is a planning allowance,
   not a tested upper bound. Add existing backup/archive growth and other projects'
   requirements, and stop between batches if headroom becomes insufficient. Do not
   create a full local production clone or run other projects' rewrites concurrently.
6. Verify record/read/archive equivalence before reclamation. Ordinary vacuum makes
   deleted space reusable; returning table allocation to the filesystem may require
   a separately scheduled, blocking `VACUUM FULL` of the commodity raw table. It
   needs a temporary table copy and rebuilds indexes; WAL adds further headroom needs.
   Avoid a whole-database rewrite. PostgreSQL's
   [vacuuming documentation](https://www.postgresql.org/docs/16/routine-vacuuming.html)
   describes these locking and space tradeoffs. No production rewrite is authorized
   or performed by this experiment.

After packing begins, rollback must retain a compatible reader/archive path or
expand all blocks losslessly back into raw rows with sufficient disk space. An
application-only rollback followed by dropping the blocks would lose access to
history. The smallest useful next change is the additive schema/view, deterministic
filtered reader, bounded packer and archive integration with the regression cases
above; no retention change, index removal or unrelated refactor is needed.
