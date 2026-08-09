# Copper — EU Auction House

A fast, compact EU Retail auction-house tracker with profession cost calculations as one focused feature.

## Features

- **Market Browser** — Current commodity and connected-realm prices for every item discovered in Blizzard auction data
- **Price Tracking** — Hourly commodity history and compact six-hour profession-item realm history with daily rollups
- **Crafting Cost Calculator** — Calculate reagent costs and gross profit estimates across supported reagent/output rank scenarios
- **Realm Arbitrage** — Find the best realms to buy and sell non-commodity items
- **Profession Browser** — Browse Midnight professions, recipes, and reagents
- **Profession Stat Simulation** — Not yet enabled; authoritative multicraft, resourcefulness, and ingenuity inputs are not bundled

## Architecture

| Component | Technology                 | Port |
| --------- | -------------------------- | ---- |
| Frontend  | Next.js + React (Node.js) | 3111 |
| Backend   | Hono (Bun)            | 4111 |
| Database  | PostgreSQL 16         | 5566 |

## Project Structure

```
wow-tools/
├── frontend/           # Next.js + React application
├── backend/            # Hono API server
├── game-data-parsed/   # In-game addon data (items, recipes)
├── docs/               # Project documentation
├── docker-compose.yml  # PostgreSQL and optional production app stack
└── .env                # Blizzard API credentials (not committed)
```

## Data Sources

- **Professions & Recipes**: Extracted from an in-game addon and parsed to JSON in `game-data-parsed/`
- **Market catalog**: Discovered from auction payloads and hydrated incrementally from Blizzard item metadata
- **Prices**: Blizzard Game Data API (commodities + connected-realm auctions), fetched hourly
- **Realms**: Blizzard API connected realm discovery

## Quick Start

### Prerequisites

- [Node.js 24](https://nodejs.org/) for the frontend
- [Bun](https://bun.sh) for the backend
- [Docker](https://www.docker.com/) for PostgreSQL
- Blizzard API credentials in `.env`:
  ```
  BLIZZARD_CLIENT_ID=your_client_id
  BLIZZARD_CLIENT_SECRET=your_client_secret
  ```

### Development

```bash
# Start PostgreSQL
docker compose up -d db

# Backend
cd backend
bun install
bun dev

# Frontend
cd frontend
npm ci
npm run dev
```

### Production containers

Build the optimized frontend and backend images without starting them:

```bash
docker compose --profile app build
```

The `app` profile keeps the default `docker compose up` behavior database-only.

The backend automatically applies migrations, imports the bundled profession catalog when needed, refreshes current Blizzard auction data hourly, and hydrates newly discovered item names in bounded batches. Current market tables are atomically replaced per scope; history is intentionally sampled and retained separately so normal reads stay small and fast. See [docs/deployment.md](docs/deployment.md) for production environment, readiness, reverse-proxy, and backup guidance.

Auction data is provided by Blizzard on an as-is basis. Copper is not affiliated with or endorsed by Blizzard Entertainment.

## Documentation

See [docs/plan.md](docs/plan.md) for the full project plan, database schema, and implementation roadmap.
