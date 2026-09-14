CREATE TABLE "market_refresh_cycles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"region_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"total_scopes" integer DEFAULT 0 NOT NULL,
	"succeeded_scopes" integer DEFAULT 0 NOT NULL,
	"failed_scopes" integer DEFAULT 0 NOT NULL,
	"skipped_scopes" integer DEFAULT 0 NOT NULL,
	"status_reason" text,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "auction_sync_runs" ADD COLUMN "cycle_id" bigint;--> statement-breakpoint
ALTER TABLE "market_refresh_cycles" ADD CONSTRAINT "market_refresh_cycles_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_market_refresh_cycles_region_time" ON "market_refresh_cycles" USING btree ("region_id","started_at");--> statement-breakpoint
ALTER TABLE "auction_sync_runs" ADD CONSTRAINT "auction_sync_runs_cycle_id_market_refresh_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."market_refresh_cycles"("id") ON DELETE set null ON UPDATE no action;