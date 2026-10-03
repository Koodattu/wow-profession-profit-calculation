import { migrateDatabase } from "./db/migrate";
import { ensureProfessionCatalog } from "./services/profession-catalog";
import { ensureItemExpansions } from "./services/item-expansions";

export async function initializeDatabase(): Promise<void> {
  await migrateDatabase();
  console.log(`[Startup] Item expansion reference ${await ensureItemExpansions()}`);

  const result = await ensureProfessionCatalog();
  console.log(`[Startup] Profession Catalog ${result.outcome === "published" ? "published" : "already present"}`);
}
