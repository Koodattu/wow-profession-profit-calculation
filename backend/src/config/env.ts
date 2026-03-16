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

export const env = {
  BLIZZARD_CLIENT_ID: required("BLIZZARD_CLIENT_ID"),
  BLIZZARD_CLIENT_SECRET: required("BLIZZARD_CLIENT_SECRET"),
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://wowtools:wowtools@localhost:5566/wowtools",
  BACKEND_PORT: Number(process.env.BACKEND_PORT ?? 4111),
  NODE_ENV: process.env.NODE_ENV ?? "development",
} as const;
