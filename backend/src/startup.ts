import { migrateDatabase } from "./db/migrate";
import { ensureProfessionCatalog } from "./services/profession-catalog";

export async function initializeDatabase(): Promise<void> {
  await migrateDatabase();

  const result = await ensureProfessionCatalog();
  console.log(`[Startup] Profession Catalog ${result.outcome === "published" ? "published" : "already present"}`);
}
