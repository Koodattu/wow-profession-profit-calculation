SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "realm_variants" ADD COLUMN "unreferenced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_realm_latest_variant" ON "realm_latest" USING btree ("variant_id");
