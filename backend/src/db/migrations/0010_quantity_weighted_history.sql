ALTER TABLE "commodity_daily" ADD COLUMN "total_value" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "commodity_daily" ADD COLUMN "observed_quantity" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "commodity_daily" ADD COLUMN "sample_count" integer;--> statement-breakpoint
ALTER TABLE "commodity_daily" ADD COLUMN "average_is_exact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commodity_latest" ADD COLUMN "total_value" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "commodity_snapshots" ADD COLUMN "total_value" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "realm_daily" ADD COLUMN "total_value" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "realm_daily" ADD COLUMN "observed_quantity" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "realm_daily" ADD COLUMN "sample_count" integer;--> statement-breakpoint
ALTER TABLE "realm_daily" ADD COLUMN "average_is_exact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "realm_latest" ADD COLUMN "total_value" numeric(40, 0);--> statement-breakpoint
ALTER TABLE "realm_snapshots" ADD COLUMN "total_value" numeric(40, 0);