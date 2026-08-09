# WoW Tools — Auction House Data Analysis

A World of Warcraft auction house data analysis platform focused on professions, crafting cost calculations, and gold-making opportunities.

## Features

- **Price Tracking** — Hourly snapshots of commodity (region-wide) and per-realm auction data with interactive charts (24h, 7d, 30d, 6m, 1y, all)
- **Crafting Cost Calculator** — Calculate crafting costs and profit margins accounting for reagent ranks (R1/R2) and crafted item ranks (1–5)
- **Realm Arbitrage** — Find the best realms to buy and sell non-commodity items
- **Profession Browser** — Browse Midnight professions, recipes, and reagents
- **Client-Side Simulation** — (Planned) Multicraft, resourcefulness, and ingenuity calculations

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

- **Items & Recipes**: Extracted from in-game addon, parsed to JSON in `game-data-parsed/`
- **Prices**: Blizzard Game Data API (commodities + per-realm auctions), fetched hourly
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

## Documentation

See [docs/plan.md](docs/plan.md) for the full project plan, database schema, and implementation roadmap.
