# Copper improvement goal

## Starting state
- Goal: carry out the full attached end-to-end improvement request; one agent, local uncommitted changes only.
- Revision: `5e615817d500aeb5de993a44dc5989c9a2b114ce`, branch `main`.
- Staged, unstaged, and untracked files: none. No repository/ancestor AGENTS.md found; supplied global instructions apply.
- Stack: Next 16.3.5 / React 19.2.8, Hono / Bun, PostgreSQL 16. English-only web app; no locale system. Preserve compact dark/gold market-tool identity.
- Installed runtime: Node 24.4.1, Bun 1.3.9 (repository declares 1.3.14). Both dependency directories already exist.
- Git commands require per-command `-c safe.directory=C:/Users/Juha/Desktop/Projektit/wow-profession-profit-calculation` under the sandbox account.

## Plan and journeys
Inspect and establish baseline → implement bounded batches → verify each journey and combined diff.
1. Choose realm → browse/search/filter/page items → inspect quote, history, gear variants.
2. Open profession → compare recipe scenarios → inspect recipe/reagent prices and history.
3. Compare realm opportunities → inspect an item and its realm markets.
4. Recover from unavailable data, network failures, and invalid input without losing context.

## Baseline
- `cd backend; bun test`: 40 passed, 0 failed; explicit dummy credentials and unreachable local database URL, no external resources used.
- `cd backend; bun run typecheck`: passed.
- `cd frontend; npm test; npm run lint`: 20 tests passed; lint passed.
- Docker inventory required escalation. Created only `copper-goal-test-20261003`, PostgreSQL 16.14, localhost:55433, 512 MB / 1 CPU. Existing containers untouched.
- Normal backend entrypoint starts external refresh jobs immediately. Do not run it for testing; use route assembly without scheduler and a dedicated synthetic database.
- Some existing integration tests require populated EU market/history data. Need bounded synthetic fixture and disposable database before running them.

## Ranked backlog and disposition
| Priority | Candidate / evidence | Acceptance | Confidence / effort / risk |
| --- | --- | --- | --- |
| 1 | Isolated verification: normal startup refreshes Blizzard; integration suite assumes market data | Done: real HTTP/database tests use bounded synthetic data; CI runs all 10 suites | High / medium / low |
| 1 | Windows archive flushing fails with EPERM; async test matcher stalls | Done: verified recoverable archives and coverage checks pass on Windows and Linux | High / small / low |
| 2 | Fractional paging and oversized IDs reach data access; equal-name pages are unstable | Done: invalid requests return 400; stable name/ID ordering; stale page recovers to last page | High / small / low |
| 2 | Market mobile prices are offscreen; details lose search/filter/page context | Done: prices fit at 320/390px; URL retains context; empty/error recovery verified | High / medium / low |
| 2 | Realm/catalog, recipe/history, and comparison failures have no reliable recovery | Done: retries preserve input; cached values disclose refresh failure; partial recipe remains usable | High / medium / low |
| 3 | Realm changes unnecessarily refetch EU commodities | Done: deterministic initial load + two changes falls from 3 adapter calls to 1 | High / small / low |
| 3 | Zero profit says N/A; quantity says listings; inconsistent EU benchmark label | Done: known zero remains 0g 0s; missing quotes stay absent; canonical labels used | High / small / low |
| 3 | Enlarged text overflows controls; keyboard scroll areas lack focus targets | Done: 200% text fits; focus/pressed states, touch targets, wrapped controls, keyboard scroll verified | High / small / low |

## Decisions and boundaries
- Use existing design tokens and English terminology from CONTEXT.md; no redesign or new product features.
- Use requested skills selectively. Loaded diagnosing-bugs, end-user-ui-ux, impeccable + product/audit. Impeccable context script ran from repository with `--target frontend`; infer context from existing code (no PRODUCT.md).
- During implementation: no commits, external writes, deployment/configuration changes, production dependencies, or production data. The user subsequently authorized committing and pushing the completed changes.
- Environment files are not evidence that a database is disposable. Never print their contents.

## Completed batches
### Batch 1 — Isolated verification and Windows history archives
- Extracted unchanged HTTP assembly into `backend/src/app.ts`; production startup remains unchanged. Added guarded synthetic database setup, sequential integration runner, localhost fixture server, documented commands.
- Fresh migrations passed on PostgreSQL 16.14; seeded 829 commodities, 284 realm items, three realms, three observations (bundled catalog + synthetic prices only).
- Reproduced baseline archive timeout in Bun 1.3.9 and declared 1.3.14. Phase probes isolated a Windows Bun `rejects.toThrow` stall after filesystem I/O. Awaiting the rejection before equivalent error type/message assertions exposed real `EPERM fsync` in `syncFile`.
- Fixed Windows file flushing with `r+`; POSIX read-only directory flushing unchanged. Reference: [Windows FlushFileBuffers write access requirement](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers).
- `npm exec --yes --package=bun@1.3.14 -- bun test ./test/price-maintenance.integration.ts`: 5 passed. Archive test ~78ms after prior timeout/EPERM; validates refusal to delete before coverage, exact recovery/hash and idempotence.
- `npm exec --yes --package=bun@1.3.14 -- bun test ./test/realm-history-storage.integration.ts`: 1 passed, ~343ms; packing, late observations, exact rollups, verified archives all pass. Apparent weighted-average failure was downstream of failed fixture setup, not an averaging defect.
- Temporary diagnostics and query probe removed. Bun package restore did not change lockfile; sandbox resolver still fails for postgres, so database runs use standard escalation. Exact declared runtime is available via npm exec without changing host installation.
- Live baseline Chrome: homepage, realm selection, market list/filter. 390px screenshot confirms Current/Available columns lie offscreen in 720px table. SearchBar is unreferenced, so no user-facing search-dropdown work is warranted.

## Blocked / deferred
- Existing external integration credentials and real market data are intentionally not used for verification.
- No physical mobile device, Safari, or Firefox verification was available. Responsive checks used Chrome at 320, 390, 768, and 1440px; text scaling used a temporary 200% root font override, subsequently removed.
- Production-scale load/storage measurement and live Blizzard end-to-end refreshes remain outside this synthetic-data run. No performance extrapolation, new index/cache, schema migration, or retention change is claimed.
- An older task-created Chrome tab (1498337787, localhost:3112) lost its debugger connection during goal continuation. Reacquiring/claiming it to close it failed. The later tab was closed and browser overrides reset; the old tab may require manual closing. This does not leave a running server.

### Batch 2 — HTTP input and paging correctness
- Reproduced `page=1.5` returning 200 with a fractional page. Added route-level integration coverage for fractional pagination and IDs outside PostgreSQL's integer range; 16 invalid requests now return 400 before database access.
- Equal-name fixture rows exposed undefined page ordering. Sort by name + ID; stale/out-of-range page requests recover to the last populated page instead of a dead-end empty list.
- Full guarded integration runner on declared Bun 1.3.14: **37 passed**, 0 failed across 10 suites; backend typecheck passed. A second Windows Bun rejection-matcher stall in gear-market was fixed using the same equivalent error type/message assertions. No assertions weakened, no timeouts increased.
- Setup can run repeatedly without replaying observations older than current market state.

### Batch 3 — Core web journeys
- Impeccable harden/adapt references loaded. Preserve dark/gold tokens and compact desktop table; adapt mobile rows so name, price, quantity, and EU realm benchmark all fit.
- Market search/type/page now live in URL using Next's documented native history integration; item links retain a safe return path. Empty state clears filters; error state retries without losing input; selected filters use aria-pressed.
- Realm catalog retry and unavailable-storage session selection: failing tests reproduced both; 4 selected-realm tests now pass.
- EU commodity workload (first load + two realm changes): 3 adapter requests before, 1 after. Two item-browser regressions went red then green; no production latency claim.
- Corrected Available from listings to units (the value sums quantities) and formatPrice(0) from N/A to 0g 0s; missing quotes remain null/Not listed.
- Recipe history and realm comparison now distinguish failure from empty data and offer retry. Recipe back navigation returns to its profession. Time-range buttons expose selection and 44px targets. Profession tables retain full scenario comparison in a horizontal scroll area at narrow widths.
- Saved baseline mobile evidence: `evidence/market-mobile-before.png`. Final `evidence/market-mobile-after.png` shows prices in the same 390px viewport with filters retained. Desktop, history-failure, root-error, and 200% text screenshots are beside it.

### Batch 4 — Final review, accessibility, and CI coverage
- Sequential code-review self-review covered the staged/unstaged/untracked result against the clean starting revision and this goal. Found and fixed hidden refresh failures when returning to a previously loaded realm; retained prices now have a warning and retry. HTTP-boundary UI regression reproduced the defect before the fix.
- Frontend: 29 tests pass; lint and TypeScript pass. Production build passes on Windows Node 24.4.1; final layout-only rebuild also passed. Backend: 40 unit tests, 37 integration tests, typecheck, and `drizzle-kit check` pass on declared Bun 1.3.14.
- CI now uses the guarded integration runner, covering current-market/catalog and new HTTP cases previously omitted from its explicit test list. Service definitions, permissions, and deployment configuration unchanged.
- Both existing Dockerfiles build successfully with disposable task tags `copper-goal-backend:20261003` and `copper-goal-frontend:20261003`; Compose validation passes. The full runner also passes all 37 integration tests in the built Linux/Bun 1.3.14 image with a read-only test mount and the disposable PostgreSQL database (1 CPU, 512MB).
- Production standalone frontend was started using the existing Dockerfile's layout (copy public/static assets, run generated server.js). Browser verification found no uncaught exceptions or HTTP error responses before intentional failure injection; canceled navigation/prefetch requests are recorded separately.
- Text-size QA at 390px reproduced 527px page overflow at 200% root text size. Wrapped navigation/filters/pagination fix it: 375px content width inside a 390px viewport, no offscreen controls. Existing contrast tokens against card background: muted 6.38:1, accent 11.05:1, foreground 16.31:1. Reduced-motion transitions measured 0.00001s.
- Database assessment: current markets and recipe/history reads already batch item IDs; no N+1 rewrite, cache, or index justified. Warm synthetic search scans 1,113 catalog rows, returns 14, 67 shared buffer hits, 26kB sort, 0.443ms execution. Example table/index footprints after tests: items 488/824kB, realm_latest 320/392kB, commodity_latest 304/96kB. These are local diagnostics, not production benchmarks or space-saving claims.
- Browser journeys verified: dashboard search by Enter; market filters, page 2, details/back URL, empty-search clear; realm and commodity scopes; missing quotes; item-version modal with realm comparison and Escape focus return; profession → recipe → profession; history ranges/charts; category keyboard search/Escape; comparison empty/failure/retry; realm catalog failure/retry; market cached-refresh warning/retry. Production server-page failure recovered through Retry page after restoring the API. Keyboard ArrowRight moved the focused profession scroll area by 40px. Final production comparison navigation had no uncaught exceptions, uncanceled network failures, or HTTP error responses.

## Reproducible verification
Use a dedicated disposable PostgreSQL 16 database as described in `backend/README.md`. The commands below were run with the explicit test URL; `npm exec` supplied the declared Bun version because the host default is older.

```powershell
# From backend/, after creating the test container described in its README:
$env:DATABASE_URL='postgresql://copper_goal:copper_goal@127.0.0.1:55433/copper_goal_test'
$env:BLIZZARD_CLIENT_ID='synthetic-test'
$env:BLIZZARD_CLIENT_SECRET='synthetic-test'
$env:NODE_ENV='test'
npm exec --yes --package=bun@1.3.14 -- bun --no-env-file test  # 40 pass
bun run typecheck                                        # pass
npm exec --yes --package=bun@1.3.14 -- bun x drizzle-kit check # pass
npm exec --yes --package=bun@1.3.14 -- bun run test:integration # 37 pass

# From frontend/:
$env:API_URL='http://127.0.0.1:4112'
$env:NEXT_PUBLIC_API_URL='http://127.0.0.1:4112'
npm test              # 29 pass across 10 files
npm run lint          # pass
npx tsc --noEmit      # pass
npm run build         # pass; Google font downloads require network access

# From repository root, build-only checks (no application containers started):
docker compose --profile app config --quiet
docker build --tag copper-goal-backend:20261003 --file backend/Dockerfile .
docker build --tag copper-goal-frontend:20261003 --build-arg NEXT_PUBLIC_API_URL=http://127.0.0.1:4112 frontend
```

Linux runner verification used the backend image above:
```powershell
$taskTestDirectory=(Resolve-Path -LiteralPath 'backend\test').Path
docker run --rm --name copper-goal-linux-test-20261003 --memory=512m --cpus=1 --network container:copper-goal-test-20261003 --mount "type=bind,source=$taskTestDirectory,target=/app/backend/test,readonly" -e DATABASE_URL=postgresql://copper_goal:copper_goal@127.0.0.1:5432/copper_goal_test --entrypoint bun copper-goal-backend:20261003 run --no-env-file test/run-integration.ts
```
The database container for that command was named `copper-goal-test-20261003`; adapt only the container name if following the README's `copper-local-test` example. Both are explicitly disposable resources.

## Completion coverage and review
| Area / requirement | Current evidence and decision |
| --- | --- |
| Existing purpose, users, identity, locales | Repository README/CONTEXT and real UI inspected; EU Retail pricing/valuation workflows preserved, dark/gold tokens retained, English-only strings consistent. No game UI or new roadmap added. |
| Core journeys and recovery | Browser scenarios above exercised normal, loading, empty, missing-price, partial, validation, network-failure, and recovered states. Screenshots in `evidence/`; automated regressions at HTTP/adapter/user-visible boundaries. |
| Accessibility/adaptation | Native labels, pressed states, focus outline, Escape/focus return, keyboard scrolling, enlarged text, narrow/desktop layouts, reduced motion; documented physical-device/browser limitations. Dense multi-scenario/comparison tables intentionally remain horizontally scrollable with a visible cue. |
| Performance | Reproduced and removed redundant commodity requests; existing request cancellation guards and batch queries inspected. Warm local SQL plan did not justify an index/cache change. No unmeasured latency or storage reduction claim. |
| Database/storage | PostgreSQL 16 fresh migrations and repeated setup tested; transactions, late observations, exact weighted values, idempotence, archive integrity/recovery, and rollback verified by real integration tests. Schema/retention unchanged. |
| Reliability/security | Positive integer boundaries validated before SQL; queries remain parameterized; last-response guards, partial failures, request timeout/retry budgets, atomic publication, and cleanup covered by existing/new tests. Public read-only model and security policy unchanged; no secrets/logged credentials or live external fixtures. |
| Architecture/DX | HTTP assembly separated from scheduled startup for real route tests; guarded synthetic setup/runner documented; all integration suites wired into existing CI test job. No dependency/stack upgrade or production dependency added. |
| Standards self-review | Compared tracked and new files against starting revision; no unrelated rewrites, security/deployment changes, weakened assertions, or debug probes. `git diff --check` passes. |
| Goal/spec self-review | All feasible high-priority backlog entries meet their acceptance criteria; all applicable areas assessed. Remaining items are unavailable external/device verification or production-only measurement, explicitly recorded. |
| Cleanup | Preview processes stopped; ports 3112/4112/55433 have no listeners. Task PostgreSQL container and anonymous volume, Linux test container, and two image tags removed. Existing containers/images untouched; ordinary shared build caches retained. Next-generated AGENTS.md/CLAUDE.md and empty probe directory removed. Browser caveat above. |

## Status / next action
Implementation and verification are complete. The user subsequently authorized committing and pushing these changes to `origin/main`. Use `backend/README.md` and `frontend/README.md` to recreate the synthetic preview. No further high-priority implementation remains.
