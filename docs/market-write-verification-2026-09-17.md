# Incremental market refresh verification — 17 September 2026

The read-only production audit measured approximately 109 GiB of checkpoint WAL distance over 24 hours. The old ingestion path replaced all current realm rows each hour, including unchanged versions. The database contained 1.93 million current realm-version rows, while raw realm history had an estimated 1.79 million dead tuples under default autovacuum settings.

The implementation stages each incoming feed in a temporary table, compares all market content, and writes only inserted, changed, or disappeared versions. Feed freshness is stored separately and joined by current-price and listing readers. Quantities, exact value totals, individual listings, and hourly history remain intact. Publication uses one transaction; failures preserve the previous content and freshness. Concurrent publication of the same scope is serialized, and older observations cannot overwrite newer ones.

## Local validation

PostgreSQL 16.10 and Bun 1.3.14 ran in isolated local Docker containers. No production copy or new off-host backup was required. All 37 backend unit tests and 31 integration tests passed, as did TypeScript and Drizzle migration validation. Existing market integration tests require market data, so the empty database received synthetic commodity/realm quotes and recipe history using the bundled profession catalog. The metadata retry test uses a transaction-local item table to isolate its queue.

Regression checks cover unchanged heap tuple identities, refreshed timestamps in quotes/benchmarks/listings, unchanged hourly history sampling, canonical listing order, changed bids/time-left, insertion/removal, realm isolation, exact totals beyond JavaScript's safe integer range, failed transactions, outdated observations, metadata 404 classification, retry timing, and recovery.

## Synthetic write benchmark

20,000 realm variants, two auctions each, on a local database limited to two CPUs and 2 GiB RAM. Each measurement began after a checkpoint. The old replacement path and the new reconciliation path received identical inputs. A checksum of every stored content column, excluding observation/run provenance, matched for every pair.

| Changed rows | Old elapsed | New elapsed | Old WAL bytes | New WAL bytes | WAL reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0% | 1,522 ms | 563 ms | 30,405,336 | 372,248 | 99% |
| 20% | 1,613 ms | 599 ms | 32,101,648 | 6,535,640 | 80% |
| 100% | 1,650 ms | 744 ms | 32,432,336 | 30,567,312 | 6% |

These are single local samples of the current-state publication phase, not a forecast of production savings or a benchmark of Blizzard download time. Live reductions depend on how many listings change. The first refresh can also canonicalize listing arrays from the previous implementation. PostgreSQL may reuse freed space without shrinking allocated files.

The benchmark script and raw outputs are retained locally under ignored `backups/performance-audit/`. No off-host backup schedule was added.
