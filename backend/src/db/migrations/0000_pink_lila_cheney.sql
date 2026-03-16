CREATE TABLE "commodity_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"region_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"date" date NOT NULL,
	"min_price" bigint,
	"avg_price" bigint,
	"max_price" bigint,
	"avg_quantity" bigint
);
--> statement-breakpoint
CREATE TABLE "commodity_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"region_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"min_price" bigint NOT NULL,
	"avg_price" bigint,
	"median_price" bigint,
	"max_price" bigint,
	"total_quantity" bigint NOT NULL,
	"num_auctions" integer,
	"price_p10" bigint,
	"price_p25" bigint
);
--> statement-breakpoint
CREATE TABLE "connected_realms" (
	"id" integer NOT NULL,
	"region_id" text NOT NULL,
	CONSTRAINT "connected_realms_id_region_id_pk" PRIMARY KEY("id","region_id")
);
--> statement-breakpoint
CREATE TABLE "item_professions" (
	"item_id" integer NOT NULL,
	"profession_id" integer NOT NULL,
	CONSTRAINT "item_professions_item_id_profession_id_pk" PRIMARY KEY("item_id","profession_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality_rank" integer,
	"is_reagent" boolean DEFAULT false NOT NULL,
	"is_crafted_output" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professions" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"expansion" text DEFAULT 'Midnight' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connected_realm_id" integer NOT NULL,
	"region_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"date" date NOT NULL,
	"min_buyout" bigint,
	"avg_buyout" bigint,
	"max_buyout" bigint,
	"avg_quantity" bigint
);
--> statement-breakpoint
CREATE TABLE "realm_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connected_realm_id" integer NOT NULL,
	"region_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"min_buyout" bigint NOT NULL,
	"avg_buyout" bigint,
	"median_buyout" bigint,
	"max_buyout" bigint,
	"total_quantity" bigint NOT NULL,
	"num_auctions" integer
);
--> statement-breakpoint
CREATE TABLE "realms" (
	"id" integer NOT NULL,
	"region_id" text NOT NULL,
	"connected_realm_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"locale" text,
	"timezone" text,
	"realm_type" text,
	"population" text,
	CONSTRAINT "realms_id_region_id_pk" PRIMARY KEY("id","region_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_categories" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"profession_id" integer NOT NULL,
	"top_category_id" integer,
	"top_category_name" text
);
--> statement-breakpoint
CREATE TABLE "recipe_output_qualities" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"quality_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_quality" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_reagent_slot_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot_id" integer NOT NULL,
	"option_index" integer NOT NULL,
	"item_id" integer,
	"reagent_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_reagent_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"slot_index" integer NOT NULL,
	"quantity" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"reagent_type" integer NOT NULL,
	"slot_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_salvage_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"profession_id" integer NOT NULL,
	"category_id" integer,
	"output_item_id" integer NOT NULL,
	"output_quantity_min" integer DEFAULT 1 NOT NULL,
	"output_quantity_max" integer DEFAULT 1 NOT NULL,
	"quality_tier_type" text DEFAULT 'none' NOT NULL,
	"affected_by_multicraft" boolean DEFAULT false NOT NULL,
	"affected_by_resourcefulness" boolean DEFAULT false NOT NULL,
	"affected_by_ingenuity" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_host" text NOT NULL,
	"oauth_host" text DEFAULT 'oauth.battle.net' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commodity_daily" ADD CONSTRAINT "commodity_daily_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_daily" ADD CONSTRAINT "commodity_daily_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_snapshots" ADD CONSTRAINT "commodity_snapshots_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_snapshots" ADD CONSTRAINT "commodity_snapshots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_realms" ADD CONSTRAINT "connected_realms_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_professions" ADD CONSTRAINT "item_professions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_professions" ADD CONSTRAINT "item_professions_profession_id_professions_id_fk" FOREIGN KEY ("profession_id") REFERENCES "public"."professions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_daily" ADD CONSTRAINT "realm_daily_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_snapshots" ADD CONSTRAINT "realm_snapshots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_categories" ADD CONSTRAINT "recipe_categories_profession_id_professions_id_fk" FOREIGN KEY ("profession_id") REFERENCES "public"."professions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_output_qualities" ADD CONSTRAINT "recipe_output_qualities_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_output_qualities" ADD CONSTRAINT "recipe_output_qualities_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_reagent_slot_options" ADD CONSTRAINT "recipe_reagent_slot_options_slot_id_recipe_reagent_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."recipe_reagent_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_reagent_slot_options" ADD CONSTRAINT "recipe_reagent_slot_options_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_reagent_slots" ADD CONSTRAINT "recipe_reagent_slots_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_salvage_targets" ADD CONSTRAINT "recipe_salvage_targets_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_salvage_targets" ADD CONSTRAINT "recipe_salvage_targets_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_profession_id_professions_id_fk" FOREIGN KEY ("profession_id") REFERENCES "public"."professions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_category_id_recipe_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."recipe_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_output_item_id_items_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commodity_daily_region_item_date" ON "commodity_daily" USING btree ("region_id","item_id","date");--> statement-breakpoint
CREATE INDEX "idx_commodity_item_time" ON "commodity_snapshots" USING btree ("item_id","snapshot_time");--> statement-breakpoint
CREATE INDEX "idx_commodity_region_time" ON "commodity_snapshots" USING btree ("region_id","snapshot_time");--> statement-breakpoint
CREATE UNIQUE INDEX "realm_daily_realm_region_item_date" ON "realm_daily" USING btree ("connected_realm_id","region_id","item_id","date");--> statement-breakpoint
CREATE INDEX "idx_realm_snap_item_time" ON "realm_snapshots" USING btree ("item_id","snapshot_time");--> statement-breakpoint
CREATE INDEX "idx_realm_snap_realm_time" ON "realm_snapshots" USING btree ("connected_realm_id","region_id","snapshot_time");