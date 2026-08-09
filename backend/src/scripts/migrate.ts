import { sql } from "../db";
import { migrateDatabase } from "../db/migrate";

try {
  await migrateDatabase();
} finally {
  await sql.end({ timeout: 5 });
}
