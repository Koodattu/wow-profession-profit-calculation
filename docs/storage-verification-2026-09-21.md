# Lossless market storage — 21 September 2026

The change reduces repeated variant definitions and historical row/index overhead. Retention remains 30 days of detailed observations, indefinite weighted daily summaries, and verified recoverable archives. No off-host backup configuration changes.

## Local production-sample benchmark

PostgreSQL 16.10 and Bun 1.3.14 in an isolated Docker database, limited to two CPUs and 2 GiB RAM. Read-only production samples contained 96,839 current realm/version rows and 89,773 history observations from five realms across approximately three days. Samples and scripts remain in ignored `backups/storage-audit-20260921/`.

| Candidate | Original bytes | Candidate bytes, including indexes | Reduction |
| --- | ---: | ---: | ---: |
| Current rows plus shared definitions | 58,286,080 | 42,131,456 | 27.7% |
| History packed into daily blocks | 19,406,848 | 4,521,984 | 76.7% |

The final implementation migrated the populated sample successfully, verifying exact reconstruction before replacing the old table. It packed all 89,773 observations in 2.25 seconds and compared all columns in both directions with no differences. Final blocks occupied 4,120,576 bytes. Deleting raw rows leaves reusable allocation; shrinking existing production files requires a separately scheduled rewrite.

History API results were identical before/after packing. Three local timings (milliseconds): selected-realm single item 20/3/4 before and 5/4/3 after; all-realm single item 33/5/3 and 7/4/5; all-realm 100-item batch 104/63/62 and 106/96/97. Larger batches spend additional CPU expanding JSONB. These are small local measurements, not production latency guarantees.

An unchanged 4,021-row current feed reconciled in 195 ms, preserving every row's heap identity and not consuming variant sequence IDs. Item 271434 returned 66 sampled versions and individual listings through the unchanged public response format.

All 37 backend unit tests and 23 relevant integration tests passed, along with TypeScript and Drizzle migration validation. Migrations succeeded on both an empty database and the populated production sample. A local `VACUUM (FULL, ANALYZE)` reduced the now-empty raw history relation to 40,960 bytes while all 89,773 observations remained readable through the view.

## Guarantees and checks

- Variant definitions retain the original key, bonuses, modifiers, context and pet attributes. Identical definitions are shared across items and realms; displayed item levels are never used as identity.
- Listings preserve original array order and every field, including null values; migration verifies complete JSONB row reconstruction before replacing the old table.
- Packing preserves exact PostgreSQL numeric totals and microsecond timestamps without routing either through JavaScript numbers/dates.
- Regression coverage includes differing quantities, repeated observations, missing samples, legacy null totals, weighted rollups, charts for individual/combined realms, late observations, simultaneous packers, corrupt-packing rollback, archive reconciliation/recovery and multi-day sampling cadence.
- Current-market regressions retain failed-refresh rollback, realm/variant isolation, pagination, changes to bids/time-left, freshness and unchanged-row behavior. Shared definitions do not consume sequence IDs on unchanged refreshes.

The historical primary key and lookup indexes remain: packing reduces their working set to recent raw observations. The old current-market `(region_id, connected_realm_id, observed_at)` index is removed; scope reconciliation uses the new primary-key prefix, and item lookup retains its existing index. Variant definitions persist when auctions disappear, avoiding identity churn; their growth should be included in future size audits.

## Release and rollback

Migration 0014 is transactional and requires a current-market write/read lock. It creates and validates a replacement table, builds a smaller primary key and retains foreign keys. Conflicting identities or any reconstruction mismatch abort the migration. A five-second lock timeout prevents waiting indefinitely for another workload; schedule this release between refreshes.

Take a same-host database backup and matching archive bundle before the release. Allow additional space for the replacement current table, packed blocks and WAL. The migration does not immediately pack history; startup/daily maintenance does that in separate per-day transactions. Verify readiness, refresh completion, history/listing endpoints, maintenance status and table sizes after release.

After packing completes, an operator can run `VACUUM (FULL, ANALYZE) realm_snapshots` during a coordinated maintenance window to return its unused allocation to the filesystem. This locks the raw history table and is deliberately not part of recurring maintenance or application startup. Ordinary future vacuum can reuse space in the much smaller raw table.

An older application cannot read the new current-market schema. Rollback requires the matching pre-release database backup plus application image, or a reviewed reverse migration that reconstructs all current rows and expands blocks. Do not roll back only the application or discard blocks. Archive file format is unchanged.
