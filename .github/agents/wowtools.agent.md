---
applyTo: "**"
---

# WoW Tools Agent Instructions

You are working on **WoW Tools**, a World of Warcraft auction house data analysis platform.

## Project Overview

- **Purpose**: Track AH prices, calculate crafting costs, find cross-realm arbitrage
- **Stack**: Bun runtime, Hono (backend), Next.js + React (frontend), PostgreSQL, Drizzle ORM
- **Region**: EU only (configured in `backend/src/config/regions.ts`)
- **Expansion**: Midnight (12.x)

## Critical Context

### Data Sources

- **Game data** (professions, recipes, items) comes from `game-data-parsed/*.json` — parsed from in-game addon exports
- **Price data** (auction house) comes from Blizzard API — commodities endpoint + per-realm auctions
- We do NOT use Blizzard API for profession/recipe/item metadata — it's unreliable for modern recipes

### Key Files

- `game-data-parsed/midnight_reagents_used.json` — Item catalog (~990 items with IDs, names, quality ranks, entry types)
- `game-data-parsed/midnight_recipes_simplified.json` — Recipe catalog (~719 recipes with reagent slots, quantities, output items)
- `docs/plan.md` — Full database schema, architecture, and roadmap

### Price Rules

- All prices in **copper** (1 gold = 10,000 copper). Store as integers, never floats.
- **Commodities** = region-wide, `unit_price` (per unit)
- **Realm auctions** = per-connected-realm, `buyout` (total price)
- Snapshots aggregated at ingestion (min/avg/median/max/quantity per item)

### Quality/Rank System

- Reagents: R1 and R2 — separate item IDs, same name
- Crafted gear: R1–R5 (quality determined by crafting skill, same item ID entries in `qualityIDs: [4,5,6,7,8]`)
- Crafted consumables/reagents: R1–R2 with explicit output item IDs per rank (`qualityIDs: [13,14]`, `outputQualities[]`)
- Default assumption: buyers want R5 gear, R2 consumables

### Blizzard API Namespaces

- `dynamic-{region}` — auctions, realm status (refreshed hourly)
- We do NOT use `static-{region}` endpoints

## Project Structure

```
wow-tools/
├── frontend/           # Next.js app (port 3111)
├── backend/            # Hono API server (port 4111)
├── game-data-parsed/   # Addon-exported item + recipe data
├── docs/               # plan.md
├── docker-compose.yml
└── .env
```

## Coding Rules

1. **Read `docs/plan.md`** before making architectural decisions.
2. **Drizzle ORM** for all DB operations. Schema in `backend/src/db/schema.ts`.
3. **Hono routes** in `backend/src/routes/`. Each file exports a Hono app mounted in `index.ts`.
4. **Environment variables** validated in `backend/src/config/env.ts`. Never read `process.env` directly elsewhere.
5. **Blizzard API calls** go through `backend/src/services/blizzard-api.ts` — used ONLY for auction/realm data.
6. **Prices are copper integers** (BIGINT in DB, number in TS). No floating point for money.
7. **EU region only** for now. All code accepts `regionId` parameter for future expansion.
8. **Run `bun`**, not `npm` or `yarn`.
9. **PostgreSQL on port 5566**. Connection: `postgresql://wowtools:wowtools@localhost:5566/wowtools`.
10. **Use context7 MCP** to look up Hono, Drizzle, Next.js docs before implementing.
11. **Check `game-data-parsed/`** for item/recipe data structures.
12. **Game data import** via `backend/src/services/game-data-import.ts` — reads JSON files, upserts into DB.

## Common Tasks

### Adding a new API route

1. Create route file in `backend/src/routes/`
2. Export a Hono instance
3. Mount it in `backend/src/index.ts`

### Adding/modifying DB tables

1. Edit `backend/src/db/schema.ts`
2. Run `bun run db:generate`
3. Run `bun run db:push`

### Refreshing game data

1. Update JSON files in `game-data-parsed/`
2. Restart backend (auto-imports on startup)
