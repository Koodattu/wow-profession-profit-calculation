import { pgTable, text, integer, serial, bigserial, bigint, boolean, timestamp, date, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

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

export const items = pgTable("items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  qualityRank: integer("quality_rank"),
  isReagent: boolean("is_reagent").notNull().default(false),
  isCraftedOutput: boolean("is_crafted_output").notNull().default(false),
});

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
  },
  (t) => [index("idx_commodity_item_time").on(t.itemId, t.snapshotTime), index("idx_commodity_region_time").on(t.regionId, t.snapshotTime)],
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
    maxBuyout: bigint("max_buyout", { mode: "number" }),
    totalQuantity: bigint("total_quantity", { mode: "number" }).notNull(),
    numAuctions: integer("num_auctions"),
  },
  (t) => [index("idx_realm_snap_item_time").on(t.itemId, t.snapshotTime), index("idx_realm_snap_realm_time").on(t.connectedRealmId, t.regionId, t.snapshotTime)],
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
  },
  (t) => [uniqueIndex("commodity_daily_region_item_date").on(t.regionId, t.itemId, t.date)],
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
  },
  (t) => [uniqueIndex("realm_daily_realm_region_item_date").on(t.connectedRealmId, t.regionId, t.itemId, t.date)],
);
