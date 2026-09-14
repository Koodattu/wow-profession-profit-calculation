CREATE INDEX "idx_commodity_daily_date" ON "commodity_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_realm_daily_date" ON "realm_daily" USING btree ("date");--> statement-breakpoint
UPDATE "items"
SET "name" = 'Item #' || "id", "metadata_status" = 'pending'
WHERE btrim("name") = '';
