# Copper frontend

Next.js / React interface for EU Retail auction prices, realm comparisons, and crafting scenarios. Requires Node.js 24 or newer and npm. Install the locked dependencies with `npm ci`.

## Local development with synthetic data

Follow [the backend setup](../backend/README.md) to create a disposable PostgreSQL database, run `bun run test:setup`, and start `bun run dev:fixture`. This uses the real API with synthetic prices and no Blizzard refresh jobs.

From `frontend/` in PowerShell:

```powershell
$env:API_URL='http://127.0.0.1:4112'
$env:NEXT_PUBLIC_API_URL='http://127.0.0.1:4112'
npm run dev -- --hostname 127.0.0.1 --port 3112
```

Open [Copper locally](http://127.0.0.1:3112), select a test realm, and explore Market, Professions, and Realms. The empty test realm supports missing-price checks. Stop both servers and remove only the disposable container you created when finished.

`API_URL` is used by server-rendered pages; `NEXT_PUBLIC_API_URL` is used by the browser and is fixed at build time. Both default to `http://localhost:4111` when unset. Keep them pointed at the same intended backend. Restart the frontend after changing either value.

## Verification

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Tests exercise feature behavior at API adapter boundaries. Database and HTTP integration coverage lives in `backend/test`. Production builds fetch the configured Google fonts, so the build needs network access to Google's font service.

Core browser checks: search/filter/page the market, open an item and return to the same results, compare a profession's recipe scenarios, inspect recipe history, and compare realm prices. Check narrow and wide viewports and retry after a temporary API failure. See [the improvement work log](../work/goal-improvement/STATE.md) for the recorded verification and screenshots.
