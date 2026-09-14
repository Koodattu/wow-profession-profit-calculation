import { pgTable, text, integer, serial, bigserial, bigint, numeric, boolean, timestamp, date, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import type { GearData } from "../services/gear-data";

export const gearReference = pgTable("gear_reference", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<GearData>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface RealmListing {
  id: string;
  buyout: number;
  quantity: number;
  bid: number | null;
  timeLeft: string | null;
}

// ─── Static Data (from game-data-parsed) ─────────────────────────────

export const professions = pgTable("professions", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  expansion: text("expansion").notNull().default("Midnight"),
});

export const recipeCategories = pgTable("recipe_categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  professionId: integer("profession_id")
    .notNull()
    .references(() => professions.id),
  topCategoryId: integer("top_category_id"),
  topCategoryName: text("top_category_name"),
});

export const items = pgTable(
  "items",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    itemQuality: integer("item_quality"),
    qualityRank: integer("quality_rank"),
    isReagent: boolean("is_reagent").notNull().default(false),
    isCraftedOutput: boolean("is_crafted_output").notNull().default(false),
    marketType: text("market_type"),
    metadataStatus: text("metadata_status").notNull().default("complete"),
    itemClass: text("item_class"),
    itemSubclass: text("item_subclass"),
    inventoryType: text("inventory_type"),
    metadataUpdatedAt: timestamp("metadata_updated_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_items_name").on(t.name),
    index("idx_items_market_type").on(t.marketType),
    index("idx_items_market_name").on(t.marketType, t.name),
    index("idx_items_metadata_queue").on(t.metadataStatus, t.metadataUpdatedAt),
  ],
);

export const itemProfessions = pgTable(
  "item_professions",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    professionId: integer("profession_id")
      .notNull()
      .references(() => professions.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.professionId] })],
);

export const recipes = pgTable("recipes", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  professionId: integer("profession_id")
    .notNull()
    .references(() => professions.id),
  categoryId: integer("category_id").references(() => recipeCategories.id),
  outputItemId: integer("output_item_id").references(() => items.id),
  outputQuantityMin: integer("output_quantity_min").notNull().default(1),
  outputQuantityMax: integer("output_quantity_max").notNull().default(1),
  qualityTierType: text("quality_tier_type").notNull().default("none"),
  affectedByMulticraft: boolean("affected_by_multicraft").notNull().default(false),
  affectedByResourcefulness: boolean("affected_by_resourcefulness").notNull().default(false),
  affectedByIngenuity: boolean("affected_by_ingenuity").notNull().default(false),
});

export const recipeOutputQualities = pgTable("recipe_output_qualities", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => recipes.id),
  rank: integer("rank").notNull(),
  qualityId: integer("quality_id").notNull(),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id),
  itemQuality: integer("item_quality"),
});

export const recipeReagentSlots = pgTable("recipe_reagent_slots", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => recipes.id),
  slotIndex: integer("slot_index").notNull(),
  quantity: integer("quantity").notNull(),
  required: boolean("required").notNull().default(true),
  reagentType: integer("reagent_type").notNull(),
  slotText: text("slot_text").notNull().default(""),
});

export const recipeReagentSlotOptions = pgTable("recipe_reagent_slot_options", {
  id: serial("id").primaryKey(),
  slotId: integer("slot_id")
    .notNull()
    .references(() => recipeReagentSlots.id),
  optionIndex: integer("option_index").notNull(),
  itemId: integer("item_id").references(() => items.id),
  reagentName: text("reagent_name").notNull(),
});

export const recipeSalvageTargets = pgTable("recipe_salvage_targets", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => recipes.id),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id),
});

// ─── Infrastructure (from Blizzard API) ──────────────────────────────

export const regions = pgTable("regions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  apiHost: text("api_host").notNull(),
  oauthHost: text("oauth_host").notNull().default("oauth.battle.net"),
});

export const connectedRealms = pgTable(
  "connected_realms",
  {
    id: integer("id").notNull(),
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
  },
  (t) => [primaryKey({ columns: [t.id, t.regionId] })],
);

export const realms = pgTable(
  "realms",
  {
    id: integer("id").notNull(),
    regionId: text("region_id").notNull(),
    connectedRealmId: integer("connected_realm_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale"),
    timezone: text("timezone"),
    realmType: text("realm_type"),
    population: text("population"),
  },
  (t) => [primaryKey({ columns: [t.id, t.regionId] })],
);

export const syncJobs = pgTable("sync_jobs", {
  name: text("name").primaryKey(),
  status: text("status").notNull().default("idle"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export const marketRefreshCycles = pgTable(
  "market_refresh_cycles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    totalScopes: integer("total_scopes").notNull().default(0),
    succeededScopes: integer("succeeded_scopes").notNull().default(0),
    failedScopes: integer("failed_scopes").notNull().default(0),
    skippedScopes: integer("skipped_scopes").notNull().default(0),
    statusReason: text("status_reason"),
    lastError: text("last_error"),
  },
  (t) => [index("idx_market_refresh_cycles_region_time").on(t.regionId, t.startedAt)],
);

export const auctionSyncRuns = pgTable(
  "auction_sync_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cycleId: bigint("cycle_id", { mode: "number" }).references(() => marketRefreshCycles.id, { onDelete: "set null" }),
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    scope: text("scope").notNull(),
    connectedRealmId: integer("connected_realm_id"),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowCount: integer("row_count"),
    lastError: text("last_error"),
  },
  (t) => [index("idx_auction_sync_runs_scope_time").on(t.regionId, t.scope, t.finishedAt), index("idx_auction_sync_runs_status").on(t.status)],
);

// Current market state is kept separately from history so normal reads remain
// small and an item disappearing from an auction payload is represented exactly.
export const commodityLatest = pgTable(
  "commodity_latest",
  {
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    syncRunId: bigint("sync_run_id", { mode: "number" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    minPrice: bigint("min_price", { mode: "number" }).notNull(),
    avgPrice: bigint("avg_price", { mode: "number" }).notNull(),
    medianPrice: bigint("median_price", { mode: "number" }).notNull(),
    maxPrice: bigint("max_price", { mode: "number" }).notNull(),
    totalQuantity: bigint("total_quantity", { mode: "number" }).notNull(),
    numAuctions: integer("num_auctions").notNull(),
    priceP10: bigint("price_p10", { mode: "number" }).notNull(),
    priceP25: bigint("price_p25", { mode: "number" }).notNull(),
    totalValue: numeric("total_value", { precision: 40, scale: 0 }),
  },
  (t) => [primaryKey({ columns: [t.regionId, t.itemId] }), index("idx_commodity_latest_observed").on(t.regionId, t.observedAt)],
);

export const realmLatest = pgTable(
  "realm_latest",
  {
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    connectedRealmId: integer("connected_realm_id").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    variantKey: text("variant_key").notNull(),
    listings: jsonb("listings").$type<RealmListing[]>(),
    syncRunId: bigint("sync_run_id", { mode: "number" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    context: integer("context"),
    bonusLists: jsonb("bonus_lists").$type<number[]>().notNull().default([]),
    modifiers: jsonb("modifiers").$type<{ type: number; value: number }[]>().notNull().default([]),
    petBreedId: integer("pet_breed_id"),
    petLevel: integer("pet_level"),
    petQualityId: integer("pet_quality_id"),
    petSpeciesId: integer("pet_species_id"),
    minBuyout: bigint("min_buyout", { mode: "number" }).notNull(),
    avgBuyout: bigint("avg_buyout", { mode: "number" }).notNull(),
    medianBuyout: bigint("median_buyout", { mode: "number" }).notNull(),
    totalValue: numeric("total_value", { precision: 40, scale: 0 }),
    maxBuyout: bigint("max_buyout", { mode: "number" }).notNull(),
    totalQuantity: bigint("total_quantity", { mode: "number" }).notNull(),
    numAuctions: integer("num_auctions").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.regionId, t.connectedRealmId, t.itemId, t.variantKey] }),
    index("idx_realm_latest_item").on(t.regionId, t.itemId),
    index("idx_realm_latest_realm").on(t.regionId, t.connectedRealmId, t.observedAt),
  ],
);

// ─── Time-Series Price Tables ────────────────────────────────────────

export const commoditySnapshots = pgTable(
  "commodity_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    minPrice: bigint("min_price", { mode: "number" }).notNull(),
    avgPrice: bigint("avg_price", { mode: "number" }),
    medianPrice: bigint("median_price", { mode: "number" }),
    maxPrice: bigint("max_price", { mode: "number" }),
    totalQuantity: bigint("total_quantity", { mode: "number" }).notNull(),
    numAuctions: integer("num_auctions"),
    priceP10: bigint("price_p10", { mode: "number" }),
    priceP25: bigint("price_p25", { mode: "number" }),
    totalValue: numeric("total_value", { precision: 40, scale: 0 }),
  },
  (t) => [index("idx_commodity_item_time").on(t.itemId, t.snapshotTime), index("idx_commodity_snapshot_time").on(t.snapshotTime)],
);

export const realmSnapshots = pgTable(
  "realm_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    connectedRealmId: integer("connected_realm_id").notNull(),
    regionId: text("region_id").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    minBuyout: bigint("min_buyout", { mode: "number" }).notNull(),
    avgBuyout: bigint("avg_buyout", { mode: "number" }),
    medianBuyout: bigint("median_buyout", { mode: "number" }),
    totalValue: numeric("total_value", { precision: 40, scale: 0 }),
    maxBuyout: bigint("max_buyout", { mode: "number" }),
    totalQuantity: bigint("total_quantity", { mode: "number" }).notNull(),
    numAuctions: integer("num_auctions"),
  },
  (t) => [
    index("idx_realm_snap_item_time").on(t.itemId, t.snapshotTime),
    index("idx_realm_snap_realm_time").on(t.connectedRealmId, t.regionId, t.snapshotTime),
    index("idx_realm_snapshot_time").on(t.snapshotTime),
  ],
);

// ─── Aggregated Tables ───────────────────────────────────────────────

export const commodityDaily = pgTable(
  "commodity_daily",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    regionId: text("region_id")
      .notNull()
      .references(() => regions.id),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    date: date("date").notNull(),
    minPrice: bigint("min_price", { mode: "number" }),
    avgPrice: bigint("avg_price", { mode: "number" }),
    maxPrice: bigint("max_price", { mode: "number" }),
    avgQuantity: bigint("avg_quantity", { mode: "number" }),
    totalValue: numeric("total_value", { precision: 40, scale: 0 }),
    observedQuantity: numeric("observed_quantity", { precision: 40, scale: 0 }),
    sampleCount: integer("sample_count"),
    averageIsExact: boolean("average_is_exact").notNull().default(false),
  },
  (t) => [uniqueIndex("commodity_daily_region_item_date").on(t.regionId, t.itemId, t.date), index("idx_commodity_daily_date").on(t.date)],
);

export const realmDaily = pgTable(
  "realm_daily",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    connectedRealmId: integer("connected_realm_id").notNull(),
    regionId: text("region_id").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    date: date("date").notNull(),
    minBuyout: bigint("min_buyout", { mode: "number" }),
    avgBuyout: bigint("avg_buyout", { mode: "number" }),
    maxBuyout: bigint("max_buyout", { mode: "number" }),
    avgQuantity: bigint("avg_quantity", { mode: "number" }),
    totalValue: numeric("total_value", { precision: 40, scale: 0 }),
    observedQuantity: numeric("observed_quantity", { precision: 40, scale: 0 }),
    sampleCount: integer("sample_count"),
    averageIsExact: boolean("average_is_exact").notNull().default(false),
  },
  (t) => [
    uniqueIndex("realm_daily_realm_region_item_date").on(t.connectedRealmId, t.regionId, t.itemId, t.date),
    index("idx_realm_daily_date").on(t.date),
    index("idx_realm_daily_item_region_date").on(t.itemId, t.regionId, t.date),
  ],
);
