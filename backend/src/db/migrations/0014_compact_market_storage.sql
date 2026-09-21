SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
LOCK TABLE realm_latest IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE realm_variants (
 id serial PRIMARY KEY, variant_key text NOT NULL CONSTRAINT realm_variants_variant_key_unique UNIQUE,
 context integer, bonus_lists jsonb NOT NULL, modifiers jsonb NOT NULL,
 pet_breed_id integer, pet_level integer, pet_quality_id integer, pet_species_id integer
);
--> statement-breakpoint
INSERT INTO realm_variants (variant_key,context,bonus_lists,modifiers,pet_breed_id,pet_level,pet_quality_id,pet_species_id)
SELECT DISTINCT variant_key,context,bonus_lists,modifiers,pet_breed_id,pet_level,pet_quality_id,pet_species_id FROM realm_latest;
--> statement-breakpoint
CREATE TABLE realm_latest_compact (
 region_id text NOT NULL, connected_realm_id integer NOT NULL, item_id integer NOT NULL,
 variant_id integer NOT NULL, listings jsonb, sync_run_id bigint NOT NULL, observed_at timestamptz NOT NULL,
 min_buyout bigint NOT NULL, avg_buyout bigint NOT NULL, median_buyout bigint NOT NULL,
 total_value numeric(40,0), max_buyout bigint NOT NULL, total_quantity bigint NOT NULL, num_auctions integer NOT NULL
);
--> statement-breakpoint
INSERT INTO realm_latest_compact
SELECT r.region_id,r.connected_realm_id,r.item_id,v.id,
 CASE WHEN r.listings IS NULL THEN NULL ELSE coalesce((
  SELECT jsonb_agg(jsonb_build_array(l->'id',l->'buyout',l->'quantity',l->'bid',l->'timeLeft') ORDER BY ord)
  FROM jsonb_array_elements(r.listings) WITH ORDINALITY a(l,ord)
 ),'[]'::jsonb) END,
 r.sync_run_id,r.observed_at,r.min_buyout,r.avg_buyout,r.median_buyout,r.total_value,r.max_buyout,r.total_quantity,r.num_auctions
FROM realm_latest r JOIN realm_variants v USING(variant_key);
--> statement-breakpoint
ALTER TABLE realm_latest_compact ADD CONSTRAINT realm_latest_region_id_connected_realm_id_item_id_variant_id_pk PRIMARY KEY(region_id,connected_realm_id,item_id,variant_id);
--> statement-breakpoint
ANALYZE realm_latest_compact;
--> statement-breakpoint
ANALYZE realm_variants;
--> statement-breakpoint
ANALYZE realm_latest;
--> statement-breakpoint
DO $$ BEGIN
 IF (SELECT count(*) FROM realm_latest) <> (SELECT count(*) FROM realm_latest_compact) OR (
  SELECT count(*) FROM realm_latest r JOIN realm_variants v USING(variant_key)
  JOIN realm_latest_compact n ON (n.region_id,n.connected_realm_id,n.item_id,n.variant_id)=(r.region_id,r.connected_realm_id,r.item_id,v.id)
  WHERE to_jsonb(r) IS DISTINCT FROM (
   (to_jsonb(n)-'variant_id'-'listings') || (to_jsonb(v)-'id') || jsonb_build_object('listings',
    CASE WHEN n.listings IS NULL THEN NULL ELSE coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',l->0,'buyout',l->1,'quantity',l->2,'bid',l->3,'timeLeft',l->4) ORDER BY ord)
     FROM jsonb_array_elements(n.listings) WITH ORDINALITY a(l,ord)), '[]'::jsonb) END))
 ) <> 0 THEN RAISE EXCEPTION 'Current market reconstruction failed; original data retained'; END IF;
END $$;
--> statement-breakpoint
DROP TABLE realm_latest;
--> statement-breakpoint
ALTER TABLE realm_latest_compact RENAME TO realm_latest;
--> statement-breakpoint
ALTER TABLE realm_latest ADD CONSTRAINT realm_latest_region_id_regions_id_fk FOREIGN KEY(region_id) REFERENCES regions(id);
--> statement-breakpoint
ALTER TABLE realm_latest ADD CONSTRAINT realm_latest_item_id_items_id_fk FOREIGN KEY(item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE realm_latest ADD CONSTRAINT realm_latest_variant_id_realm_variants_id_fk FOREIGN KEY(variant_id) REFERENCES realm_variants(id);
--> statement-breakpoint
CREATE INDEX idx_realm_latest_item ON realm_latest(region_id,item_id);
--> statement-breakpoint
CREATE TABLE realm_history_blocks (
 region_id text NOT NULL, connected_realm_id integer NOT NULL, item_id integer NOT NULL,
 day date NOT NULL, observations jsonb NOT NULL,
 CONSTRAINT realm_history_blocks_region_id_connected_realm_id_item_id_day_pk PRIMARY KEY(region_id,connected_realm_id,item_id,day),
 CONSTRAINT realm_history_blocks_item_id_items_id_fk FOREIGN KEY(item_id) REFERENCES items(id)
);
--> statement-breakpoint
CREATE INDEX idx_realm_history_blocks_item_day ON realm_history_blocks(item_id,day);
--> statement-breakpoint
CREATE INDEX idx_realm_history_blocks_day ON realm_history_blocks(day);
--> statement-breakpoint
CREATE VIEW realm_history AS
 SELECT id,connected_realm_id,region_id,item_id,snapshot_time,min_buyout,avg_buyout,median_buyout,max_buyout,total_quantity,num_auctions,total_value,
 (snapshot_time AT TIME ZONE 'UTC')::date AS history_day FROM realm_snapshots
 UNION ALL
 SELECT o.id,b.connected_realm_id,b.region_id,b.item_id,o.snapshot_time,o.min_buyout,o.avg_buyout,o.median_buyout,o.max_buyout,o.total_quantity,o.num_auctions,o.total_value,b.day
 FROM realm_history_blocks b CROSS JOIN LATERAL jsonb_to_recordset(b.observations) AS o(
  id bigint,snapshot_time timestamptz,min_buyout bigint,avg_buyout bigint,median_buyout bigint,max_buyout bigint,total_quantity bigint,num_auctions integer,total_value numeric(40,0));
--> statement-breakpoint
ANALYZE realm_latest;
--> statement-breakpoint
ANALYZE realm_variants;
