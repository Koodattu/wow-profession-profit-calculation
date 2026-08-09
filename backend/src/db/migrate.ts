import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from ".";
import { withAdvisoryLock } from "./advisory-lock";

export async function migrateDatabase(): Promise<void> {
  const result = await withAdvisoryLock("wowtools:database-migrations", async () => {
    console.log("[Startup] Applying database migrations");
    await migrate(db, { migrationsFolder: resolve(import.meta.dir, "migrations") });
  });

  if (!result.acquired) {
    throw new Error("Another instance is applying database migrations; retry startup shortly");
  }

  console.log("[Startup] Database migrations are current");
}
