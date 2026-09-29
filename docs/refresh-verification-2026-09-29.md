# Refresh writes and reliability — 29 September 2026

The production audit found recurrent response-body decompression failures, roughly 38 GB/day of generated WAL and 12 GB/day of temporary-file writes, and 282,810 unused definitions among 581,174 realm variants. The WAL and temporary-file counters overlap with Docker block I/O and are not additional retained storage or internet bandwidth.

## Changes

- Read JSON inside the existing bounded retry loop, including OAuth responses. HTTP 404 classification, Retry-After, and the single token-refresh replay remain intact. The request timeout now remains active during body consumption. A stream failure cannot publish a partial auction snapshot.
- Filter already-correct catalog items before the upsert. PostgreSQL otherwise locks conflicting rows even when the update condition is false. The remaining upsert still handles concurrent item discovery, preserves hydrated metadata, and retains commodity precedence.
- Use transaction-local 32 MB work memory for current-market reconciliation. This reduces large hash-join spills without changing global PostgreSQL settings. Memory is per operation and must be considered alongside the existing four concurrent realm workers.
- Retire unused definitions only after a 30-day grace period. Returning definitions are unmarked, current references are rechecked, and shared/exclusive transaction locks coordinate publication and cleanup. Cleanup skips active writers and bounds each SQL statement to 60 seconds. An index on the referencing variant ID avoids scanning all listings for every foreign-key deletion check.

## Local production-data rehearsal

Read-only production copies were restored into isolated PostgreSQL 16.10. The sample contains 1,857,312 current realm/version rows and all 581,174 definitions. No production write queries were used for profiling.

On the 52,043-row realm 1305 sample, the old catalog upsert locked 15,731 already-correct items and generated 3,742,486 bytes of WAL, taking 171 ms. Filtering before upsert produced no conflicts or WAL and took 13 ms. The unchanged-market hash comparison spilled 1,416 temporary blocks at default work memory (77 ms); at 32 MB it used one hash batch without temporary blocks (58 ms). These isolated measurements establish the avoided work, not an end-to-end production reduction guarantee.

The additive migration succeeded on empty and populated databases. A full-data retirement rehearsal marked 282,810 definitions in 7.0 seconds. Advancing the clock by 31 days removed the same 282,810 in 13.2 seconds. Before/after row counts and aggregate fingerprints of every live row and its referenced definition matched. Regression tests separately cover live references, the exact grace boundary, returning versions, stable external keys, unchanged listing fields, and cleanup overlapping a writer.

## Deployment

Validation passed with the production Linux Bun 1.3.14 runtime: TypeScript, all 40 unit tests, all 25 integration tests in the CI suite, and migration from an empty database. An additional 10 catalog/current-market integration tests passed locally after populating their required EU fixtures. The older Windows Bun 1.3.9 runtime stalled in an unchanged archive-streaming test; the same archive tests passed on Linux without modifying their assertions or timeout. Drizzle migration metadata validation also passed.

Use the shared VM deployment lock and a fresh same-host database dump plus archive bundle. Include the production Compose override and `--no-deps` when running the backup helper. Stop the backend between refresh cycles before applying migration 0015; its five-second lock timeout prevents indefinite migration waits. The migration is additive, so the previous backend remains a rollback option after stopping the new one. A rollback stops retirement sweeps; it does not reconstruct already-retired definitions, which have no current or historical references.

The first production sweep only starts the grace period. It deliberately does not reclaim existing unused definitions immediately. Historical retention, weighted totals, archive format, and off-host backup policy are unchanged.
