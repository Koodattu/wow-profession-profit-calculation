# Market database audit — 14 September 2026

Production access was read-only. No deployment, production migration, configuration change, refresh job, or database write was performed. Local source at the start of the audit was `f8f7044` (`refactor market and catalog architecture`).

## Why Venom Rite Mantle is missing

There are two independent findings:

1. **Production still uses the profession-only catalog.** Its `items` table contains 1,113 rows, all marked as a reagent or crafted output. The deployed `/app/backend/src/services/auction-sync.ts` downloads complete auction payloads but executes `if (!knownItemIds.has(itemId)) continue` for both commodities and realm auctions. It never discovers new item IDs. Item 271434 is absent; searching its name returns HTTP 200 with zero items, and its item endpoint returns HTTP 404.
2. **This particular item is bind on pickup.** A read-only lookup through the deployed Blizzard client at `/data/wow/item/271434` returned `Venom Rite Mantle`, Armor / Cloth / Shoulder, and `preview_item.binding = { type: "ON_ACQUIRE", name: "Binds when picked up" }`. This is a live EU item lookup, not an inference from the Wowhead PTR URL. It would not normally be listed on the AH even after broader discovery is enabled. Bonus-specific auction availability was not independently verified.

The repository's newer implementation discovers items from auction feeds and hydrates their names afterward. It has not been deployed: production has migrations 0000–0004, while the repository also contains 0005–0009. Production has neither `commodity_latest` nor `realm_latest`, and no item metadata queue columns.

An auction catalog is not a complete encyclopedia of game items. An item must be in the imported profession catalog or discovered in an auction payload to enter the newer catalog. Importing non-tradeable items would require a separate product decision and should not imply they have auction prices.

## Production measurements

The database covers 92 EU connected-realm groups containing 267 realms. Commodity and realm sync jobs reported successful runs on 14 September. The configured raw snapshot retention is **35 days**, not the newer repository default of 14 days.

| Table | Approximate rows from PostgreSQL statistics | Table / TOAST / auxiliary storage | Indexes | Total |
| --- | ---: | ---: | ---: | ---: |
| `realm_snapshots` | 17,087,044 | 1,781 MB | 1,139 MB | 2,920 MB |
| `realm_daily` | 754,726 | 120 MB | 81 MB | 201 MB |
| `commodity_snapshots` | 461,988 | 52 MB | 32 MB | 84 MB |
| `commodity_daily` | 20,032 | 3,304 kB | 2,112 kB | about 5 MB |
| `items` | 1,113 | 112 kB | 56 kB | 168 kB |

Database size was **3,220 MB** using `pg_database_size`. PostgreSQL's displayed MB figures are binary units. Row estimates can change during ongoing ingestion. The consistent local dump contained exactly 17,087,076 realm snapshot rows, spanning 14 August to 14 September.

The large table contained live history, not a large reported dead-tuple backlog. Adding item-name indexes would not address the dominant storage cost.

## Why current-price requests are slow

The deployed `getLatestRealmPricesForConnectedRealm` starts with:

```sql
SELECT max(snapshot_time)::text
FROM realm_snapshots
WHERE region_id = 'eu';
```

Production lacks an index that can efficiently find that maximum. `EXPLAIN (ANALYZE, BUFFERS)` showed a parallel sequential scan of approximately 17.1 million rows, 218,941 disk blocks read, and **2,815 ms** execution time. The item route calls the helper separately for the regional benchmark and the selected realm, so it can repeat this work before running the actual price aggregations.

Two requests to `/api/items?limit=50&connectedRealmId=1305`, measured inside the deployed backend after the dump completed, took **1,776 ms and 1,875 ms**, returning HTTP 200 and 50 items. Earlier timings during the dump were 13,737 ms and 7,485 ms; those were affected by concurrent backup load and should not be treated as a typical baseline. These are backend response timings, not browser rendering or end-to-end internet timings.

## Local migration and performance validation

A consistent, read-only `pg_dump` was streamed directly to the ignored local backup directory. The dump is 340.2 MiB and took 105.5 seconds. It was restored in 67.4 seconds into a separate PostgreSQL 16.10 container:

- Container and volume: `wow-profit-audit-20260914`
- Database: `wowtools_audit`
- Address: `127.0.0.1:5567`
- Local container limits: 2 CPUs and 2 GiB RAM
- Dump: `backups/performance-audit/production-20260914.dump`

The local container was stopped after verification to release memory. Its volume and dump are retained; `docker start wow-profit-audit-20260914` resumes this test environment.

Existing migrations 0005–0009 applied successfully to the complete restored database through `bun run migrate`. The original dump remains unchanged. The restored database now contains migrated tables, test fixtures, and the storage experiment, so it is a test environment rather than an untouched production clone.

| Check | Before | After |
| --- | ---: | ---: |
| Latest realm timestamp SQL, same local database | 1,832 ms, full history scan | 1.18 ms, backward index scan |
| New item route, first local request | — | 53.7 ms |
| New item route, four subsequent local requests | — | 7.8–11.8 ms |

The timestamp index is already in migration 0007. More importantly, the newer `current-market.ts` reads bounded current-price tables rather than looking through history for current quotes.

For the route benchmark, current tables were populated **locally only** from the final commodity snapshot and the final snapshot per connected realm. The resulting fixture has 626 commodity rows (160 kB) and 23,345 realm rows (5,128 kB). Old snapshots lack variant identities, so the fixture uses `base` variants. It does not represent the larger all-item, all-variant market the new fetcher will eventually collect. Network paths, hardware, cache state, and catalog sizes differ; the route measurements are not a promised production speedup. This fixture preparation is not a production backfill migration.

## Storage experiment

The copied history contained 7,876,518 rows within the latest 14 days. A separate local table, `audit.realm_history_6h`, was populated by selecting the latest observation for each item and connected realm in each six-hour UTC bucket, limited to 14 days. It retains the copied history columns and all indexes from the migrated history table.

| Realm history | Rows | Table storage | Indexes | Total |
| --- | ---: | ---: | ---: | ---: |
| Existing production history | about 17.1 million | 1,781 MB | 1,139 MB | 2,920 MB |
| Local 14-day / six-hour sample | 1,345,104 | 140 MB | 121 MB | **261 MB** |

This is about **91% less storage for realm raw history**. Fixed six-hour buckets approximate the repository's elapsed-time sampling cadence; they are not identical. This experiment did not delete the original copied history. It demonstrates a possible retention/resolution tradeoff, not a production migration or an estimate of total future database size. Six-hour sampling loses intraday detail; daily rollups retain daily summaries. Full-market current data and long-term daily history will consume additional space.

The newer fetcher already samples tracked realm history every six hours. Switching to it changes future sampling; it does not automatically compact existing hourly history. Likewise, deploying code alone will not override the production setting of `RAW_SNAPSHOT_RETENTION_DAYS=35`.

## Local correction made during the audit

The newer incremental daily rollup used `last_success_at - interval '1 day'` as its cutoff. With a last success at 03:15, it omitted the first 3 hours and 15 minutes of the preceding UTC day, then overwrote that day's existing summary with partial data. Comparing the full and partial preceding day on the copy changed all 626 commodity averages.

Both commodity and realm rollups now round that cutoff to the start of the preceding UTC day. The scan remains incremental. A regression test seeds prices before and after 03:15 and verifies that rerunning maintenance preserves the full-day minimum and average in both tables while adding the following day's data. It failed before the fix and passed afterward. This defect was in the newer local code; the older production code currently aggregates all history.

Validation completed:

- Existing migrations 0005–0009 on the full copied production database.
- 21 database-independent backend tests.
- All 19 existing database integration tests on the isolated copy.
- The new rollup regression test, failing before and passing after the fix.
- Backend TypeScript checking after the fix.
- Diff whitespace checking.

Local Bun was 1.3.9; the repository declares Bun 1.3.14. No production deployment, frontend build, or full-market load test was performed.

## Recommended order of work

1. **Deploy the already implemented current-price architecture, with the rollup fix, in a separately authorized deployment.** Review migrations and initial refresh timing together. The new current tables start empty and require a successful auction refresh before meaningful current prices are available. Broader discovery also requires time for item-name hydration; the default batch of 500 every five minutes is at most 6,000 names per hour before failures and request limits. Missing names during that initial backlog can still prevent name searches from matching.
2. **Choose history resolution and retention explicitly.** Six-hour tracked realm history plus 14 days of raw observations offers substantial savings; daily summaries support longer charts. Keep the 35-day policy if that resolution is required. Ensure full-day rollups succeed before pruning. Do not delete historical data merely to make a size target.
3. **Re-measure after full-market discovery.** The current test catalog is much smaller than the intended market. Measure current-table sizes, per-request query plans, metadata backlog, and write churn before choosing more indexes or precomputed summaries.
4. **Consider time partitions when history growth warrants them.** Daily or weekly partitions can let expired history be removed by dropping partitions rather than deleting millions of rows. They introduce partition management and constraint/migration work, so they are a later step, not required to fix today's item lookup. See [PostgreSQL partitioning](https://www.postgresql.org/docs/16/ddl-partitioning.html).
5. **Optimize the measured remaining reads.** If broad name searches become slow, a `pg_trgm` GIN index can support the existing `%search%` / `ILIKE` pattern; a normal name B-tree is not a general substring index. It adds storage and write work, and is unnecessary for today's 1,113-item catalog. If EU benchmark aggregation over all variants becomes expensive, compute per-item/per-realm summaries during refresh or add a short-lived shared response cache keyed by region, selected realm, filters, and pagination. The new item endpoint already emits short HTTP cache lifetimes. See [PostgreSQL trigram indexes](https://www.postgresql.org/docs/16/pgtrgm.html).
6. **Only then consider deeper schema compression.** A shared variant identity table could reduce repeated bonus/modifier JSON and long variant keys across realms, but should be justified by full-market measurements. Avoid dropping variants or using narrower price columns just to save bytes: that risks mixing gear versions or overflowing copper amounts.

Deleting old rows makes their space reusable; it generally does not immediately return all of it to the filesystem. A table rewrite such as `VACUUM FULL` requires an exclusive lock and additional temporary disk space. Any production compaction needs its own maintenance plan; none was run here. See [PostgreSQL vacuuming and disk recovery](https://www.postgresql.org/docs/16/routine-vacuuming.html).
