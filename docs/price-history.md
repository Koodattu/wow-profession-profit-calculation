# Price history and compaction

Keep detailed observations in PostgreSQL for 30 days by default (`RAW_SNAPSHOT_RETENTION_DAYS`). Keep daily summaries indefinitely. Before removing any older UTC day's observations, write and verify a compressed archive. The Compose `price_history_archives` volume is mounted at `/archives` and survives container replacement. Outside Compose, `HISTORY_ARCHIVE_DIR` defaults to the repository's ignored `backups/price-history` directory.

The archive preserves every saved snapshot column. It cannot recover original individual auction listings or variants that were never stored in older snapshots. Current auction state is still refreshed separately. Tracked realm history defaults to one observation per UTC hour; `REALM_HISTORY_INTERVAL_HOURS` can explicitly reduce that sampling frequency. History coverage remains all commodities and the tracked profession realm items; broad realm discovery does not automatically create history for every non-profession item.

## Statistical contract

For each item, region, UTC day, and connected realm where applicable:

- Daily average = `sum(total_value) / sum(total_quantity)`, rounded once to copper.
- `total_value` is the sum of listing unit price times available quantity for commodities, or the actual listing buyout totals for realm auctions. New observations retain this exact integer as a decimal database value, including values too large for JavaScript's safe integer range.
- `observed_quantity` and `sample_count` retain the weights needed to combine daily summaries correctly in later rollups.
- Daily minimum/maximum are the lowest/highest observed per-unit prices. Displayed daily quantity is the average available quantity per observation, not the sum of repeated observations.
- An auction seen in several snapshots contributes to each observation. These are quantity-weighted observations of listed supply, not completed sales or a time-weighted sales price.
- Legacy snapshots lack exact value totals. Their existing rounded average times quantity supplies an approximation, marked by `average_is_exact = false`. Old daily rows whose raw data is already unavailable remain intact; missing precision cannot be reconstructed.
- Exact daily medians cannot be derived from hourly medians. Daily median is unavailable. Current realm medians are also unavailable when combining multiple variant distributions. No average of medians is presented as a median.
- The separately labeled EU realm benchmark remains the unweighted average of realm minimum prices. It is a realm-comparison statistic, not the quantity-weighted pooled auction average.

Charts through 30 days use detailed observations. Six-month, one-year, and all-time charts use daily summaries, including a weighted average line. Long-term daily data and archives have no automatic expiration.

## Maintenance guarantees

The first run of the weighted rollup implementation recomputes all raw history that is still available. Later runs revisit complete UTC days starting one day before the last successful weighted rollup. A separate `quantity-weighted-rollups` job marker prevents the old arithmetic-average maintenance marker from skipping this backfill. Reruns replace a day's aggregate rather than double-counting its observations.

For each expired UTC day and source table, compaction uses a repeatable-read transaction to:

1. Compare every source group's row count, total quantity, total value, average, minimum, and maximum with its stored daily summary.
2. Stream the source rows to a new gzip-compressed NDJSON file without parsing database numeric values through JavaScript floating point.
3. Flush the archive, decompress it, and verify its uncompressed SHA-256 and record count.
4. Publish a JSON manifest and flush it and the containing directory on Linux.
5. Delete exactly the archived rows and check the affected row count before committing.

An incomplete rollup, unwritable archive directory, corrupt archive, or database conflict prevents that day's deletion. A crash after publishing an archive but before committing may leave a duplicate archive on retry; the original snapshot IDs allow deduplication. Archive filenames are unique and existing files are never overwritten. Failed `.partial` files are not verified archives and can be removed only after checking that the database still retains their observations.

Late imports into an already compacted day require reconciliation with its archive. Compaction refuses mismatching daily totals rather than silently overwriting the preserved summary. The ordinary fetcher records present-time observations, so this does not affect normal ingestion.

## Verification and recovery

Verify a file and its manifest from the backend environment:

```sh
bun run verify-history-archive /archives/commodity_snapshots-DATE-UUID.ndjson.gz
```

The manifest identifies the source table, UTC day, record count, and SHA-256 of the uncompressed NDJSON. The integration test verifies that decompressed records can be read back through PostgreSQL's `json_populate_record` without losing the exact value total.

For recovery, first verify the file, then decompress it and import each JSON line into an isolated recovery database with the matching snapshot schema using `json_populate_record(NULL::commodity_snapshots, record::json)` or its realm equivalent. Restore original IDs and deduplicate by ID if several archives cover the same day. Do not restore directly over live history or reset live sequences without a reviewed recovery plan.

Database dumps alone do not contain the archive volume. The Compose `db-backup` service first takes a database dump, then bundles the archive volume into a matching `price-history-TIMESTAMP.tar`. Keep both files together and copy both off-host. Local archives protect against calculation mistakes and database compaction; an off-host copy is required to protect against loss of the VM's disk. Never use `docker compose down -v` on this stack unless intentionally deleting both database and archives.

Compaction makes PostgreSQL space reusable; it does not necessarily immediately shrink the filesystem allocation. No automatic `VACUUM FULL` or table rewrite is performed.
