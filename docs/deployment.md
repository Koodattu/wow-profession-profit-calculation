# Deployment

The Compose stack is suitable for a single host behind a TLS-terminating reverse proxy. It binds the frontend, backend, and database ports to loopback so they are not directly exposed on the host network.

## Configuration

Copy `.env.example` to `.env` and replace every `replace_me` value. Production deployments should use unique database credentials and the platform's secret manager or a root-readable environment file rather than committing secrets.

`DATABASE_URL` is used when the backend runs directly on the host. `APP_DATABASE_URL` is the Compose backend connection string and must use the `db` hostname. Keep both credentials consistent with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`.

`NEXT_PUBLIC_API_URL` is compiled into the browser bundle. Set it to the public HTTPS URL that reaches the backend, then rebuild the frontend image. `API_URL` remains the internal server-side address (`http://backend:4111`) in Compose.

Database migrations and the bundled profession catalog are applied automatically before the backend starts listening. Blizzard price refreshes then run in the background at minute 5 of every hour. Newly discovered auction items are hydrated in bounded batches every five minutes, with newer item IDs prioritized after profession items. The readiness endpoint is `/api/health/ready`; it reports database/catalog status, price freshness, and the last result of each persistent sync job.

`REALM_SYNC_CONCURRENCY` limits simultaneous connected-realm downloads. Keep the default of `4` unless measurements show the API and database have headroom. `ITEM_METADATA_BATCH_SIZE` limits item-detail requests per hydration run. Realm history is sampled every `REALM_HISTORY_INTERVAL_HOURS`; current realm data is still refreshed hourly. Raw history defaults to 30 days (`RAW_SNAPSHOT_RETENTION_DAYS`). Daily summaries and compressed raw archives are retained indefinitely. Six-month and longer charts use quantity-weighted daily rollups. The `price_history_archives` volume must be backed up alongside PostgreSQL. Compaction verifies both the daily summary and a durable archive before removing database rows; see [price history](price-history.md) for calculation and recovery details.

Current auction feeds are reconciled hourly using transaction-local staging: insert new versions, update changed content, and remove disappeared versions. Unchanged rows retain their storage and last-change timestamp. `market_observations` records the latest successful observation per feed (connected realm `0` denotes commodities); price and listing APIs use that timestamp, falling back to the row timestamp until the first incremental refresh. Snapshot history is recorded independently even when current prices do not change. Listing order is canonicalized, but bid, quantity, price, and time-left changes are still published. All publication and history writes commit atomically.

Blizzard item-detail 404 responses retain the catalog item and any existing name under metadata status `unavailable`, with a weekly retry. Other failures use status `failed` and retry after one hour. A successful retry restores `complete`. Existing failed items are classified on their next eligible attempt; no auction item is removed for lacking metadata.

Migration `0013` adds the small observation table and sets per-table history autovacuum thresholds: 1% plus 1,000 dead tuples for raw snapshots, 2% plus 1,000 for daily summaries, and a 2% analyze scale factor. It does not rewrite history, change retention, or run `VACUUM FULL`. Storage-option changes have a five-second lock timeout; a conflicting maintenance operation causes the migration to roll back and startup to retry. A rollback to an older application version should be followed by an auction refresh because old readers do not use feed-level observation timestamps.

## Build and start

```bash
docker compose --profile app build
docker compose --profile app up -d
docker compose --profile app ps
```

Point a reverse proxy at `127.0.0.1:3111` for the frontend and `127.0.0.1:4111` for the backend. TLS certificates, DNS, firewall policy, and provider-specific routing remain the responsibility of the deployment platform.

## Backups

Create a timestamped PostgreSQL custom-format backup:

```bash
docker compose --profile backup run --rm db-backup
```

A database dump and matching raw-history archive bundle are written to `BACKUP_DIR` (default `./backups`) with owner-only permissions. Copy both to separate durable storage and schedule the command using the host scheduler. Test restores periodically against a disposable database:

```bash
docker compose exec -T db createdb -U wowtools wowtools_restore_test
docker compose exec -T db pg_restore -U wowtools -d wowtools_restore_test --clean --if-exists < backups/your-backup.dump
```

Adjust the database username in those commands if it was changed. Never test a restore over the live database.
