CREATE TABLE "item_expansion_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_expansions" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"expansion" integer NOT NULL
);
