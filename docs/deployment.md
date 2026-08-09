# Deployment

The Compose stack is suitable for a single host behind a TLS-terminating reverse proxy. It binds the frontend, backend, and database ports to loopback so they are not directly exposed on the host network.

## Configuration

Copy `.env.example` to `.env` and replace every `replace_me` value. Production deployments should use unique database credentials and the platform's secret manager or a root-readable environment file rather than committing secrets.

`DATABASE_URL` is used when the backend runs directly on the host. `APP_DATABASE_URL` is the Compose backend connection string and must use the `db` hostname. Keep both credentials consistent with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`.

`NEXT_PUBLIC_API_URL` is compiled into the browser bundle. Set it to the public HTTPS URL that reaches the backend, then rebuild the frontend image. `API_URL` remains the internal server-side address (`http://backend:4111`) in Compose.

Database migrations and the bundled game catalog are applied automatically before the backend starts listening. Blizzard price refreshes then run in the background at minute 5 of every hour. The readiness endpoint is `/api/health/ready`; it reports database/catalog status, price freshness, and the last result of each persistent sync job.

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

Backups are written to `BACKUP_DIR` (default `./backups`) with owner-only permissions. Copy them to separate durable storage and schedule the command using the host scheduler. Test restores periodically against a disposable database:

```bash
docker compose exec -T db createdb -U wowtools wowtools_restore_test
docker compose exec -T db pg_restore -U wowtools -d wowtools_restore_test --clean --if-exists < backups/your-backup.dump
```

Adjust the database username in those commands if it was changed. Never test a restore over the live database.
