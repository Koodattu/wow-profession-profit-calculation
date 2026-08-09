# Copper — Project Plan

## 1. Overview

Copper is a compact EU Retail auction-house tracker focused on:

- Tracking commodity and realm-specific item prices over time
- Calculating crafting costs and profit margins for profession recipes
- Identifying cross-realm arbitrage opportunities for non-commodity items

### Target Expansion

- **Midnight** (patch 12.x) — the latest WoW expansion

### Region Scope

- **EU only** for initial launch (configured via `backend/src/config/regions.ts`)

---

## 2. Data Sources

### Game Data (Professions, Recipes, Items)

All profession, recipe, and item metadata comes from **in-game addon exports** parsed by Python scripts. The parsed data lives in `game-data-parsed/`:

| File                               | Contents                                                                                       | Entries |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ------- |
| `midnight_reagents_used.json`      | Item catalog — every item (reagent or crafted output) referenced by Midnight recipes           | ~990    |
| `midnight_recipes_simplified.json` | Recipe catalog — all Midnight profession recipes with reagent slots, quantities, quality tiers | ~719    |

**Why not the Blizzard API?** Modern WoW recipes (Dragonflight+) use a `modified_crafting_slots` system where the API does not expose crafted items, reagent quantities, or output quality mappings. The in-game data is complete and reliable.

### Auction House Prices (Blizzard API)

Blizzard endpoints are used for current market data, realm discovery, and incremental item metadata:

| Endpoint                                      | Namespace        | Frequency | Purpose                              |
| --------------------------------------------- | ---------------- | --------- | ------------------------------------ |
| `GET /data/wow/auctions/commodities`          | dynamic-{region} | Hourly    | Region-wide reagent/commodity prices |
| `GET /data/wow/connected-realm/{id}/auctions` | dynamic-{region} | Hourly    | Per-realm non-commodity prices       |
| `GET /data/wow/connected-realm/index`         | dynamic-{region} | Daily     | Discover connected realm IDs         |
| `GET /data/wow/item/{id}`                     | static-{region}  | Bounded batches | Hydrate discovered item names and metadata |
| `POST /token` (oauth.battle.net)              | —                | On expiry | OAuth token refresh                  |

### Price Data Format

All prices from Blizzard are in **copper** (1 gold = 10,000 copper). Stored as integers.

- **Commodities**: `unit_price` (per-unit, no bid) — region-wide
- **Realm auctions**: `buyout` (total price), `bid` (optional) — per-connected-realm

---

## 3. Game Data Structure

### Items (`midnight_reagents_used.json`)

Each entry represents a unique item ID. Fields:

| Field               | Type           | Description                                         |
| ------------------- | -------------- | --------------------------------------------------- |
| `itemID`            | number         | Blizzard item ID (primary key)                      |
| `itemName`          | string         | Display name                                        |
| `entryTypes`        | string[]       | `["reagent"]`, `["craftedOutput"]`, or both         |
| `professionNames`   | string[]       | Professions that use/produce this item              |
| `qualityRank`       | number \| null | Quality tier (1 or 2 for ranked; null for unranked) |
| `qualityRankSource` | string \| null | How rank was determined                             |

Items with quality ranks exist as **separate item IDs per rank** sharing the same name.

Entry type distribution: ~727 crafted-only, ~144 reagent-only, ~119 both.

### Recipes (`midnight_recipes_simplified.json`)

Each entry represents one recipe. Key fields:

| Field                                     | Type          | Description                                                   |
| ----------------------------------------- | ------------- | ------------------------------------------------------------- |
| `recipeID`                                | number        | Recipe ID (primary key)                                       |
| `recipeName`                              | string        | Display name                                                  |
| `professionSkillLineID`                   | number        | Profession ID                                                 |
| `professionName`                          | string        | e.g. "Midnight Alchemy"                                       |
| `recipeCategoryID` / `categoryName`       | number/string | Sub-category                                                  |
| `topCategoryID` / `topCategoryName`       | number/string | Top-level category                                            |
| `outputItemID`                            | number        | Primary output item ID                                        |
| `outputQuantityMin` / `outputQuantityMax` | number        | Output quantity range                                         |
| `qualityIDs`                              | number[]      | `[4,5,6,7,8]` for 5-rank, `[13,14]` for 2-rank, `[]` for none |
| `outputQualities`                         | object[]      | Explicit rank-to-itemID mapping (for 2-rank items)            |
| `affectedByMulticraft`                    | boolean       | Multicraft applies                                            |
| `affectedByResourcefulness`               | boolean       | Resourcefulness applies                                       |
| `affectedByIngenuity`                     | boolean       | Ingenuity applies                                             |
| `reagents`                                | object[]      | Ordered reagent slots                                         |
| `salvageTargets`                          | object[]      | Items that can be salvaged (for salvage recipes)              |

### Reagent Slot Structure

Each slot in `reagents[]`:

| Field         | Type     | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `slotIndex`   | number   | Display order (1-based)                      |
| `quantity`    | number   | How many needed                              |
| `required`    | boolean  | Mandatory vs optional                        |
| `reagentType` | number   | 0=special, 1=standard, 2=finishing, 3=socket |
| `slotText`    | string   | Label ("" for fixed reagents)                |
| `options`     | object[] | Interchangeable items for this slot          |

Each option: `{ optionIndex, reagentItemID (nullable), reagentName }`

### Quality Tier System

| `qualityIDs`  | Meaning                                                | Count |
| ------------- | ------------------------------------------------------ | ----- |
| `[4,5,6,7,8]` | 5-rank gear (rank determined by crafting skill)        | ~345  |
| `[13,14]`     | 2-rank consumables/reagents (explicit output per rank) | ~217  |
| `[]`          | Non-ranked (cooking, toys, mounts, decor)              | ~157  |

### Professions

9 Midnight professions: Alchemy (2906), Blacksmithing (2907), Cooking (2908), Enchanting (2909), Engineering (2910), Inscription (2913), Jewelcrafting (2914), Leatherworking (2915), Tailoring (2918)

---

## 4. Database Schema

### Static Data (from game-data-parsed)

```sql
-- Professions
CREATE TABLE professions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  expansion TEXT NOT NULL DEFAULT 'Midnight'
);

-- Recipe categories
CREATE TABLE recipe_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  profession_id INTEGER NOT NULL REFERENCES professions(id),
  top_category_id INTEGER,
  top_category_name TEXT
);

-- Shared profession + auction item catalog
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  item_quality INTEGER,
  quality_rank INTEGER,
  is_reagent BOOLEAN NOT NULL DEFAULT false,
  is_crafted_output BOOLEAN NOT NULL DEFAULT false,
  market_type TEXT,
  metadata_status TEXT NOT NULL DEFAULT 'complete',
  item_class TEXT,
  item_subclass TEXT,
  inventory_type TEXT,
  metadata_updated_at TIMESTAMPTZ
);

-- Many-to-many: which professions reference this item
CREATE TABLE item_professions (
  item_id INTEGER NOT NULL REFERENCES items(id),
  profession_id INTEGER NOT NULL REFERENCES professions(id),
  PRIMARY KEY (item_id, profession_id)
);

-- Recipes
CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  profession_id INTEGER NOT NULL REFERENCES professions(id),
  category_id INTEGER REFERENCES recipe_categories(id),
  output_item_id INTEGER NOT NULL REFERENCES items(id),
  output_quantity_min INTEGER NOT NULL DEFAULT 1,
  output_quantity_max INTEGER NOT NULL DEFAULT 1,
  quality_tier_type TEXT NOT NULL DEFAULT 'none',
  affected_by_multicraft BOOLEAN NOT NULL DEFAULT false,
  affected_by_resourcefulness BOOLEAN NOT NULL DEFAULT false,
  affected_by_ingenuity BOOLEAN NOT NULL DEFAULT false
);

-- Output quality mappings (for 2-rank recipes)
CREATE TABLE recipe_output_qualities (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  rank INTEGER NOT NULL,
  quality_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  item_quality INTEGER NOT NULL
);

-- Reagent slots
CREATE TABLE recipe_reagent_slots (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  slot_index INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  reagent_type INTEGER NOT NULL,
  slot_text TEXT NOT NULL DEFAULT ''
);

-- Options within a reagent slot
CREATE TABLE recipe_reagent_slot_options (
  id SERIAL PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES recipe_reagent_slots(id),
  option_index INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  reagent_name TEXT NOT NULL
);

-- Salvage targets
CREATE TABLE recipe_salvage_targets (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  item_id INTEGER NOT NULL REFERENCES items(id)
);
```

### Infrastructure (from Blizzard API)

```sql
CREATE TABLE regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_host TEXT NOT NULL,
  oauth_host TEXT NOT NULL DEFAULT 'oauth.battle.net'
);

CREATE TABLE connected_realms (
  id INTEGER NOT NULL,
  region_id TEXT NOT NULL REFERENCES regions(id),
  PRIMARY KEY (id, region_id)
);

CREATE TABLE realms (
  id INTEGER NOT NULL,
  region_id TEXT NOT NULL,
  connected_realm_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  locale TEXT,
  timezone TEXT,
  realm_type TEXT,
  population TEXT,
  PRIMARY KEY (id, region_id)
);
```

### Current Market Tables

Normal price reads never scan history:

- `commodity_latest` has one row per EU commodity item and is atomically replaced after each successful regional fetch.
- `realm_latest` has one row per connected realm, item, and auction variant. Its stable variant key covers context, bonus lists, modifiers, and battle-pet attributes.
- `auction_sync_runs` records bounded sync diagnostics and freshness; it is pruned with raw history.

Failed fetches leave the previous current-state rows intact. `sync_run_id` links current rows to their successful fetch without a foreign key, allowing old run diagnostics to be pruned independently.

### Time-Series Price Tables

```sql
CREATE TABLE commodity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  snapshot_time TIMESTAMPTZ NOT NULL,
  min_price BIGINT NOT NULL,
  avg_price BIGINT,
  median_price BIGINT,
  max_price BIGINT,
  total_quantity BIGINT NOT NULL,
  num_auctions INTEGER,
  price_p10 BIGINT,
  price_p25 BIGINT
);

CREATE INDEX idx_commodity_item_time ON commodity_snapshots(item_id, snapshot_time DESC);
CREATE INDEX idx_commodity_snapshot_time ON commodity_snapshots(snapshot_time DESC);

CREATE TABLE realm_snapshots (
  id BIGSERIAL PRIMARY KEY,
  connected_realm_id INTEGER NOT NULL,
  region_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  snapshot_time TIMESTAMPTZ NOT NULL,
  min_buyout BIGINT NOT NULL,
  avg_buyout BIGINT,
  median_buyout BIGINT,
  max_buyout BIGINT,
  total_quantity BIGINT NOT NULL,
  num_auctions INTEGER
);

CREATE INDEX idx_realm_snap_item_time ON realm_snapshots(item_id, snapshot_time DESC);
CREATE INDEX idx_realm_snap_realm_time ON realm_snapshots(connected_realm_id, region_id, snapshot_time DESC);
CREATE INDEX idx_realm_snapshot_time ON realm_snapshots(snapshot_time DESC);

CREATE TABLE commodity_daily (
  id BIGSERIAL PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  date DATE NOT NULL,
  min_price BIGINT,
  avg_price BIGINT,
  max_price BIGINT,
  avg_quantity BIGINT,
  UNIQUE(region_id, item_id, date)
);

CREATE TABLE realm_daily (
  id BIGSERIAL PRIMARY KEY,
  connected_realm_id INTEGER NOT NULL,
  region_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  date DATE NOT NULL,
  min_buyout BIGINT,
  avg_buyout BIGINT,
  max_buyout BIGINT,
  avg_quantity BIGINT,
  UNIQUE(connected_realm_id, region_id, item_id, date)
);
```

---

## 5. Backend Architecture

### Project Structure

```
backend/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── regions.ts
│   ├── db/
│   │   ├── index.ts
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── services/
│   │   ├── blizzard.ts
│   │   ├── blizzard-client.ts
│   │   ├── blizzard-auction-source.ts
│   │   ├── auction-refresh.ts
│   │   ├── auction-sync.ts
│   │   ├── current-market.ts
│   │   ├── market-history.ts
│   │   ├── recipe-valuation.ts
│   │   ├── recipe-history.ts
│   │   ├── realm-sync.ts
│   │   └── game-data-import.ts
│   ├── jobs/
│   │   └── scheduler.ts
│   └── routes/
│       ├── items.ts
│       ├── professions.ts
│       ├── realms.ts
│       └── health.ts
├── drizzle.config.ts
└── package.json
```

### Data Loading Strategy

1. **On startup**: Apply migrations and import the profession catalog only when it is missing
2. **On startup**: Refresh stale connected-realm and current-price data in the background
3. **Every hour**: Atomically replace current commodity and realm state after successful fetches
4. **Every five minutes**: Hydrate a bounded batch of newly discovered item metadata, prioritizing profession items and newer IDs
5. **Daily**: Refresh realms, incrementally roll raw samples into daily history, and prune expired rows

### API Endpoints

```
GET  /api/health
GET  /api/market/summary?region=eu&connectedRealmId=:id
GET  /api/realms?region=eu
GET  /api/items?region=eu&type=all|commodity|realm&search=:query&page=:page
GET  /api/items/:itemId
GET  /api/items/:itemId/prices?range=24h|7d|14d|30d|6m|1y|all&region=eu
GET  /api/items/:itemId/realm-prices?region=eu
GET  /api/professions
GET  /api/professions/:id
GET  /api/professions/:id/recipes
GET  /api/professions/recipes/:id
GET  /api/crafting/professions/:id?region=eu&connectedRealmId=:id
GET  /api/crafting/recipes/:id?region=eu&connectedRealmId=:id
```

---

## 6. Frontend Architecture

### Key Pages

```
/                           # Dashboard
/items                      # Searchable current market
/professions                # List professions
/professions/:id            # Profession recipes
/recipes/:id                # Recipe detail with crafting cost
/items/:id                  # Item price charts
/flipping                   # Cross-realm price comparison
/privacy                    # Concise data and logging policy
```

---

## 7. Implementation Roadmap

### Phase 1: Foundation ✓

- [x] Explore Blizzard API structure
- [x] Design database schema
- [x] Write project documentation
- [x] Scaffold frontend + backend projects
- [x] Set up Docker Compose (PostgreSQL)
- [x] Implement Drizzle schema and migrations
- [x] Implement non-destructive profession data import
- [x] Implement Blizzard OAuth + resilient API client
- [x] Implement connected-realm discovery
- [x] Implement commodity + connected-realm auction sync

### Phase 2: Price Data Collection ✓

- [x] Atomic current-market tables for fast reads
- [x] Hourly commodity and connected-realm ingestion
- [x] Variant-aware current realm data
- [x] Compact realm-history sampling and daily aggregation
- [x] Price history API endpoints
- [x] Bounded item metadata hydration

### Phase 3: Frontend MVP ✓

- [x] Market-first dashboard and complete item browser
- [x] Item price and quantity charts
- [x] Profession browser and recipe cost detail
- [x] Connected-realm selector and comparison

### Phase 4: Deferred Features

- [x] Connected-realm price comparison
- [x] Gross crafting profit calculator
- [ ] Client-side multicraft/resourcefulness simulation
- [ ] User accounts, personal watchlists, and alerts
- [ ] Additional regions

---

## 8. Key Decisions

1. **Game data from addon, not API** — The Blizzard API doesn't expose crafted items, reagent quantities, or quality mappings for modern recipes. We extract this data from an in-game addon and parse it with Python scripts.

2. **Blizzard API only for prices** — Only auction house data and connected realm discovery.

3. **Store current state separately from history** — Atomically replace compact current-market tables and keep sampled aggregate history; never retain raw auctions.

4. **EU-only initially** — Region support architected in from the start.

5. **Copper as base unit** — Integers only, no floats for money.

6. **Separate commodity vs realm tables** — Different pricing models (unit_price vs buyout).

7. **Preserve realm variants** — Bonus lists, modifiers, context, and battle-pet attributes form a stable variant identity in current realm data.

8. **Bound growth deliberately** — Commodity history is hourly, profession-related realm history is sampled every six hours, raw history defaults to 14 days, 30-day and longer charts use daily rollups, and daily history defaults to one year.
