import { config } from "dotenv";
import { resolve } from "path";

// Load root .env first (Blizzard creds), then backend .env (overrides)
config({ path: resolve(import.meta.dir, "../../../.env") });
config({ path: resolve(import.meta.dir, "../../.env") });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function positiveInteger(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

export const env = {
  BLIZZARD_CLIENT_ID: required("BLIZZARD_CLIENT_ID"),
  BLIZZARD_CLIENT_SECRET: required("BLIZZARD_CLIENT_SECRET"),
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://wowtools:wowtools@localhost:5566/wowtools",
  BACKEND_PORT: positiveInteger("BACKEND_PORT", 4111),
  BLIZZARD_REQUEST_TIMEOUT_MS: positiveInteger("BLIZZARD_REQUEST_TIMEOUT_MS", 30_000),
  BLIZZARD_MAX_RETRIES: positiveInteger("BLIZZARD_MAX_RETRIES", 4),
  REALM_SYNC_CONCURRENCY: positiveInteger("REALM_SYNC_CONCURRENCY", 4),
  ITEM_METADATA_BATCH_SIZE: positiveInteger("ITEM_METADATA_BATCH_SIZE", 500),
  REALM_HISTORY_INTERVAL_HOURS: positiveInteger("REALM_HISTORY_INTERVAL_HOURS", 6),
  PRICE_STALE_AFTER_MINUTES: positiveInteger("PRICE_STALE_AFTER_MINUTES", 55),
  PRICE_READINESS_MAX_AGE_MINUTES: positiveInteger("PRICE_READINESS_MAX_AGE_MINUTES", 90),
  RAW_SNAPSHOT_RETENTION_DAYS: positiveInteger("RAW_SNAPSHOT_RETENTION_DAYS", 14),
  DAILY_HISTORY_RETENTION_DAYS: positiveInteger("DAILY_HISTORY_RETENTION_DAYS", 365),
  NODE_ENV: process.env.NODE_ENV ?? "development",
} as const;
