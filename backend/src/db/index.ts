import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema";

export const sql = postgres(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
