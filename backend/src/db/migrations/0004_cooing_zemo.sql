CREATE TABLE "sync_jobs" (
	"name" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text
);
