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

Recipe rank, salvage-input, output-quality, and gross-profit rules are owned by `src/services/recipe-valuation.ts`. Single-recipe, profession and craft-plan views are projections of the same valuation implementation. The plan uses `GET /api/crafting/recipes?ids=1230864,1230860&connectedRealmId=1305` (EU only, 1–50 positive recipe IDs, explicit realm required). Duplicate IDs are deduplicated and missing catalog recipes are omitted. Scenario `cost.reagentsComplete` distinguishes unresolved required materials from known materials without market quotes.

Raw and daily item history reads are owned by `src/services/market-history.ts`. `src/services/recipe-history.ts` batch-loads those item series once, aligns sparse timelines, and returns every canonical Recipe Scenario through one HTTP request.

One commodity or connected-realm Auction Refresh is owned by `src/services/auction-refresh.ts`. It records the attempt, fetches through an injected auction source, normalizes the payload, and atomically replaces current state while applying the realm-history cadence. `src/services/market-refresh-cycle.ts` owns regional orchestration, per-scope freshness, partial outcomes, and the status consumed by readiness and the dashboard.

The bundled Profession Catalog is validated and published through `src/services/profession-catalog.ts`. Startup ensures it exists; the reimport command replaces it. Publication is locked and transactional while auction-owned item fields and market history remain intact.

OAuth caching, concurrent token refresh, bounded retries, one-time 401 replay, and paging are owned by `src/services/blizzard-client.ts`. The production credentials adapter is `src/services/blizzard.ts`; callers consume one authenticated client interface.

The normal test suite is database-independent:

```bash
bun test
```

The database-backed suite requires an explicitly configured disposable local PostgreSQL 16 database. The runner rejects non-local targets and database names without a `_test` suffix, migrates it, and seeds bounded synthetic auctions over the bundled catalog. It runs suites sequentially in separate processes, with dummy Blizzard credentials and no external refreshes. Profession Catalog cases temporarily replace the catalog, so never use a shared database:

```powershell
# From backend/ (test-only credentials)
docker run -d --name copper-local-test --memory=512m --cpus=1 -p 127.0.0.1:55433:5432 -e POSTGRES_USER=copper_goal -e POSTGRES_PASSWORD=copper_goal -e POSTGRES_DB=copper_goal_test postgres:16
$env:DATABASE_URL='postgresql://copper_goal:copper_goal@127.0.0.1:55433/copper_goal_test'
bun run test:integration
```

For browser checks, run `bun run test:setup`, then `bun run dev:fixture`. This exposes the real HTTP routes at `http://127.0.0.1:4112` without the production scheduler. Start the frontend with both `API_URL` and `NEXT_PUBLIC_API_URL` set to that URL. All prices in this mode are synthetic. Remove only the container you created when finished: `docker rm -fv copper-local-test`.

For richer history checks, optionally run `bun run --no-env-file test/seed-history.ts` after setup with the same explicit disposable `DATABASE_URL`. It preserves existing samples and adds bounded hourly/daily series for item `236761` and recipe `1230866` with gaps, an average-price outlier, missing quotes, and approximate daily averages. Test `/items/236761?range=7d` and `/recipes/1230866?range=6m&realm=2`; realm 3 remains empty. Do not run the integration suite concurrently with browser checks because catalog tests replace fixture state.

For market-filter QA, `bun run --no-env-file test/seed-market-filters.ts` adds 30,000 clearly named synthetic items to that same disposable database. It includes category/subcategory/slot metadata, ranks, rarity, quoted and unlisted items, different realm prices, and catalog profession links. Repeated seeding preserves existing records. Realm 3 stays empty. This fixture is optional and is never loaded by normal startup. Use a separate fresh disposable database for the full integration suite: catalog tests replace profession data, and their cleanup can exceed its timeout with the optional large fixture.

`GET /api/items` filters the full catalog before counting and pagination. Optional filters are `category`, `subcategory`, `slot`, `rarity` (0–8 or `unknown`), `rank` (1–5 or `none`), `usage` (`reagent`/`crafted`), `profession` (catalog ID), `availability` (`listed`/`unlisted`), and inclusive `minPrice`/`maxPrice` (whole copper) and `minQuantity`/`maxQuantity` (whole listed units). `search` matches names or an exact item ID; `searchMode=exact` matches a full name, ignoring case. `sort` accepts `name-asc`, `name-desc`, `price-asc`, `price-desc`, `quantity-asc`, `quantity-desc`; missing quotes sort last with stable name/ID ties. Realm quotes use `connectedRealmId`; legacy requests without a realm retain the EU benchmark semantics. Commodity-only browsing never uses realm quotes. `GET /api/items/filters` supplies current metadata categories, subcategories, slots and catalog professions. Unknown category metadata can be selected with `category=unknown`.

The runtime and lockfile are maintained with Bun 1.3.14.
