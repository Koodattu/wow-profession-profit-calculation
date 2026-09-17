CREATE TABLE "market_observations" (
	"region_id" text NOT NULL,
	"connected_realm_id" integer NOT NULL,
	"sync_run_id" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_observations_region_id_connected_realm_id_pk" PRIMARY KEY("region_id","connected_realm_id")
);
--> statement-breakpoint
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "realm_snapshots" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint
ALTER TABLE "commodity_snapshots" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint
ALTER TABLE "realm_daily" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint
ALTER TABLE "commodity_daily" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02);
