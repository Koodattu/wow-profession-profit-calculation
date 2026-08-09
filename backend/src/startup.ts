import { db } from "./db";
import { withAdvisoryLock } from "./db/advisory-lock";
import { migrateDatabase } from "./db/migrate";
import { professions } from "./db/schema";
import { importGameData } from "./services/game-data-import";

export async function initializeDatabase(): Promise<void> {
  await migrateDatabase();

  const result = await withAdvisoryLock("wowtools:catalog-import", async () => {
    const existingGame = await db.select({ id: professions.id }).from(professions).limit(1);
    if (existingGame.length > 0) {
      return;
    }

    console.log("[Startup] Static game catalog is empty; importing bundled data");
    await importGameData();
    console.log("[Startup] Static game catalog import complete");
  });

  if (!result.acquired) {
    throw new Error("Another instance is importing the static game catalog; retry startup shortly");
  }
}
