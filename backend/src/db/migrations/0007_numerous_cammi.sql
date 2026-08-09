DROP INDEX "idx_commodity_region_time";--> statement-breakpoint
CREATE INDEX "idx_commodity_snapshot_time" ON "commodity_snapshots" USING btree ("snapshot_time");--> statement-breakpoint
CREATE INDEX "idx_realm_snapshot_time" ON "realm_snapshots" USING btree ("snapshot_time");