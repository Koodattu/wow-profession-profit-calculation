# backend

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run start
```

To type-check:

```bash
bun run typecheck
```

Current commodity quotes, selected-realm quotes, EU realm benchmarks, and cross-realm comparisons are owned by `src/services/current-market.ts`. Crafting and HTTP routes consume that module instead of defining price aggregation rules.

Recipe rank, salvage-input, output-quality, and gross-profit rules are owned by `src/services/recipe-valuation.ts`. Single-recipe and profession views are projections of the same valuation implementation.

Raw and daily item history reads are owned by `src/services/market-history.ts`. `src/services/recipe-history.ts` batch-loads those item series once, aligns sparse timelines, and returns every canonical Recipe Scenario through one HTTP request.

One commodity or connected-realm Auction Refresh is owned by `src/services/auction-refresh.ts`. It records the attempt, fetches through an injected auction source, normalizes the payload, and atomically replaces current state while applying the realm-history cadence. `src/services/auction-sync.ts` only schedules refreshes across configured realms.

OAuth caching, concurrent token refresh, bounded retries, one-time 401 replay, and paging are owned by `src/services/blizzard-client.ts`. The production credentials adapter is `src/services/blizzard.ts`; callers consume one authenticated client interface.

The normal test suite is database-independent:

```bash
bun test
```

The database-backed characterization suite requires a populated local database. Auction Refresh cases create and clean an isolated `archtest` region and reserved item-ID range:

```bash
docker compose up -d db
cd backend
bun run test:integration
```

The runtime and lockfile are maintained with Bun 1.3.14.
