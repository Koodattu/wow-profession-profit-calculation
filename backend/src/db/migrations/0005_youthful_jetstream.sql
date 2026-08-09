CREATE TABLE "auction_sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"region_id" text NOT NULL,
	"scope" text NOT NULL,
	"connected_realm_id" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"row_count" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "commodity_latest" (
	"region_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"sync_run_id" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"min_price" bigint NOT NULL,
	"avg_price" bigint NOT NULL,
	"median_price" bigint NOT NULL,
	"max_price" bigint NOT NULL,
	"total_quantity" bigint NOT NULL,
	"num_auctions" integer NOT NULL,
	"price_p10" bigint NOT NULL,
	"price_p25" bigint NOT NULL,
	CONSTRAINT "commodity_latest_region_id_item_id_pk" PRIMARY KEY("region_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "realm_latest" (
	"region_id" text NOT NULL,
	"connected_realm_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"variant_key" text NOT NULL,
	"sync_run_id" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"context" integer,
	"bonus_lists" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pet_breed_id" integer,
	"pet_level" integer,
	"pet_quality_id" integer,
	"pet_species_id" integer,
	"min_buyout" bigint NOT NULL,
	"avg_buyout" bigint NOT NULL,
	"median_buyout" bigint NOT NULL,
	"max_buyout" bigint NOT NULL,
	"total_quantity" bigint NOT NULL,
	"num_auctions" integer NOT NULL,
	CONSTRAINT "realm_latest_region_id_connected_realm_id_item_id_variant_key_pk" PRIMARY KEY("region_id","connected_realm_id","item_id","variant_key")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "market_type" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "metadata_status" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_class" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_subclass" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "inventory_type" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "metadata_updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "items" i
SET "market_type" = 'commodity'
WHERE EXISTS (
	SELECT 1 FROM "commodity_snapshots" cs WHERE cs."item_id" = i."id"
);--> statement-breakpoint
UPDATE "items" i
SET "market_type" = 'realm'
WHERE i."market_type" IS NULL
	AND EXISTS (
		SELECT 1 FROM "realm_snapshots" rs WHERE rs."item_id" = i."id"
	);--> statement-breakpoint
ALTER TABLE "auction_sync_runs" ADD CONSTRAINT "auction_sync_runs_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_latest" ADD CONSTRAINT "commodity_latest_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_latest" ADD CONSTRAINT "commodity_latest_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_latest" ADD CONSTRAINT "realm_latest_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_latest" ADD CONSTRAINT "realm_latest_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auction_sync_runs_scope_time" ON "auction_sync_runs" USING btree ("region_id","scope","finished_at");--> statement-breakpoint
CREATE INDEX "idx_auction_sync_runs_status" ON "auction_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_commodity_latest_observed" ON "commodity_latest" USING btree ("region_id","observed_at");--> statement-breakpoint
CREATE INDEX "idx_realm_latest_item" ON "realm_latest" USING btree ("region_id","item_id");--> statement-breakpoint
CREATE INDEX "idx_realm_latest_realm" ON "realm_latest" USING btree ("region_id","connected_realm_id","observed_at");--> statement-breakpoint
CREATE INDEX "idx_items_name" ON "items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_items_market_type" ON "items" USING btree ("market_type");
