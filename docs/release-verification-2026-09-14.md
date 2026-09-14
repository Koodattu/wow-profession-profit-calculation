# Production release verification — 14 September 2026

The existing VM auto-deployer deployed `ea04a1d` from `main` at 13:40:20 UTC (16:40 Helsinki), after the NETTIAUTO maintenance lock cleared. The project was already configured for automatic deployment; the market changes had been on `auction-house` rather than `main`. The deployer explicitly reported this project's deployment successful. Its overall service failure at that time was caused by a separate project's non-main checkout.

## Live data and item search

The first broad refresh finished at 13:49:43 UTC: 93 successful scopes, zero failures, covering EU commodities and all 92 connected-realm groups. Production then contained 30,896 items, including 29,783 non-profession items, and 1,981,244 current realm variant rows. All new current realm rows retained exact value totals.

Venom Rite Mantle, item 271434, was discovered from actual auction feeds. Search and its detail page worked in Chrome, including Kazzak prices and the connected-realm comparison. The earlier inference that base-item binding metadata ruled out AH availability was incorrect. The old profession-only discovery filter caused the missing search result.

Names are hydrated in the background in batches of 500 every five minutes. At 13:53 UTC, 2,567 metadata records were complete, 28,321 pending, and eight failed. Failed item lookups included Blizzard 404 responses; the existing job retries failed metadata after 24 hours. Unhydrated items may not yet match name searches. This initial backlog takes several hours under the existing request budget.

Current prices cover all discovered auction items and retain realm variants. Historical realm snapshots still cover tracked profession items; commodity history covers all observed commodities. This release does not create historical prices for non-profession realm items such as Venom Rite Mantle.

## History preservation

Production uses 30-day detailed retention, hourly tracked realm sampling, daily summaries without expiry, and verified compressed raw archives without expiry. Daily averages use total listed value divided by observed quantity, with integer totals retained for later aggregation. Legacy observations without exact value totals are marked approximate; daily medians are unavailable rather than calculated from averages of medians. See [the statistical and recovery contract](price-history.md).

The one-time weighted backfill succeeded at 13:51:12 UTC. Maintenance completed at 13:51:20 UTC and archived the expired UTC day, 14 August:

| Source | Saved observations | Compressed size |
| --- | ---: | ---: |
| Commodity snapshots | 4,382 | 150.4 KiB |
| Realm snapshots | 160,348 | 3.8 MiB |

Both archives were independently checked with the production verification CLI. Copies were transferred off the VM, decompressed locally, and their uncompressed SHA-256 hashes matched the manifests. A fresh pre-release database dump is also retained locally.

Local recovery artifacts are ignored by Git:

- `backups/performance-audit/production-before-release-20260914.dump`
- `backups/performance-audit/production-archives-20260914.tar`
- `backups/performance-audit/production-archives-20260914/`

The archive tar SHA-256 is `FF4F12A797E5EBC652C4E0FB1F8C2CF6E425E4B7DDC26C4AF1B260875DBD7D9B`. This was a verified off-host transfer for this release; no recurring off-host backup schedule was added. Future database backups must include the archive volume, as the Compose backup service now does.

## Performance and storage

Measured inside the backend against the complete broad-market dataset. Each row lists three sequential requests during or just after initial history maintenance; these are backend response times, not browser load times or a controlled load test.

| Request | Response times (ms) |
| --- | --- |
| 50 items, Kazzak | 547, 29, 32 |
| 50 realm items, Kazzak | 1,428, 45, 56 |
| Venom Rite Mantle search, Kazzak | 300, 70, 56 |
| Aetherlume all-time daily history, 32 points | 13, 4, 7 |
| Aetherlume 30-day history, 718 points | 194, 57, 53 |

The old 50-item endpoint took 1,776 and 1,875 ms before deployment. Current-price reads now use the current tables instead of scanning historical snapshots. Chrome confirmed the item search, item details, realm comparison, and all-time daily chart. The final UI wording uses “Price summary” because selecting a daily range changes the displayed summary and must not imply a live quote.

After broad ingestion and weighted backfill, PostgreSQL reported 4,202 MB total database size, with 788 MB in `realm_latest`, 3,040 MB in `realm_snapshots`, and 245 MB in `realm_daily`. Full-market coverage adds current-state storage. Archiving makes old database space reusable but does not immediately shrink allocated files; no `VACUUM FULL` or destructive table rewrite was run. The earlier six-hour storage experiment was not applied: the chosen policy preserves hourly detail for 30 days.

## Verification

Before release: migrations through 0011 on the full production copy, 22 backend unit tests, 25 backend integration tests, eight frontend tests, backend type checking, migration checks, frontend lint/build, and Docker build checks passed. GitHub CI passed before the release was merged. The final UI wording correction also passed frontend lint and production build. Production startup applied migrations successfully, all market scopes refreshed, weighted maintenance succeeded, and both archives passed independent verification.
