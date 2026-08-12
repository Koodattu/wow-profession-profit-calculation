import { afterAll, describe, expect, test } from "bun:test";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { db, sql } from "../src/db";
import { commoditySnapshots, items, professions, recipes } from "../src/db/schema";
import {
  publishProfessionCatalog,
  readBundledProfessionCatalog,
  type ProfessionCatalogData,
} from "../src/services/game-data-import";
import { createProfessionCatalogModule } from "../src/services/profession-catalog";

const TEST_ITEM = 2_100_001_500;
const TEST_OUTPUT = 2_100_001_501;
let bundled: ProfessionCatalogData;

const fixture: ProfessionCatalogData = {
  reagentEntries: [
    {
      itemID: TEST_ITEM,
      itemName: "Bundled Seed Name",
      entryTypes: ["reagent"],
      professionNames: ["Architecture"],
      itemQuality: 1,
      qualityRank: 2,
    },
  ],
  recipeEntries: [
    {
      recipeID: 2_000_001_500,
      recipeName: "Architecture Recipe",
      professionSkillLineID: 2_000_001_501,
      professionName: "Architecture",
      recipeCategoryID: 2_000_001_502,
      categoryName: "Architecture",
      topCategoryID: null,
      topCategoryName: null,
      outputItemID: TEST_OUTPUT,
      outputQuantityMin: 1,
      outputQuantityMax: 1,
      qualityIDs: [],
      outputQualities: [],
      affectedByMulticraft: false,
      affectedByResourcefulness: false,
      affectedByIngenuity: false,
      salvageTargets: [],
      reagents: [
        {
          slotIndex: 1,
          slotText: "",
          quantity: 1,
          required: true,
          reagentType: 1,
          options: [{ optionIndex: 1, reagentItemID: TEST_ITEM, reagentName: "Architecture Reagent" }],
        },
      ],
    },
  ],
};

async function cleanTestItems(): Promise<void> {
  await sql`DELETE FROM commodity_snapshots WHERE item_id IN (${TEST_ITEM}, ${TEST_OUTPUT})`;
  await sql`DELETE FROM items WHERE id IN (${TEST_ITEM}, ${TEST_OUTPUT})`;
}

afterAll(async () => {
  if (bundled) await publishProfessionCatalog(bundled);
  await cleanTestItems();
  await sql.end();
});

describe.serial("Profession Catalog interface", () => {
  test("publishes relationships atomically while preserving market-owned item data", async () => {
    bundled = await readBundledProfessionCatalog();
    await cleanTestItems();
    await db.insert(items).values({
      id: TEST_ITEM,
      name: "Hydrated Market Name",
      itemQuality: 4,
      qualityRank: null,
      marketType: "commodity",
      metadataStatus: "complete",
      itemClass: "Trade Goods",
      itemSubclass: "Parts",
      inventoryType: "Non-equippable",
      metadataUpdatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    await db.insert(items).values({
      id: TEST_OUTPUT,
      name: `Item #${TEST_OUTPUT}`,
      metadataStatus: "pending",
      marketType: "realm",
    });
    await db.insert(commoditySnapshots).values({
      regionId: "eu",
      itemId: TEST_ITEM,
      snapshotTime: new Date("2026-08-12T00:00:00.000Z"),
      minPrice: 100,
      totalQuantity: 10,
    });

    await publishProfessionCatalog(fixture);

    const [item] = await db.select().from(items).where(eq(items.id, TEST_ITEM));
    const [output] = await db.select().from(items).where(eq(items.id, TEST_OUTPUT));
    const [professionCount] = await db.select({ value: drizzleSql<number>`count(*)::int` }).from(professions);
    const [recipeCount] = await db.select({ value: drizzleSql<number>`count(*)::int` }).from(recipes);
    const [historyCount] = await db
      .select({ value: drizzleSql<number>`count(*)::int` })
      .from(commoditySnapshots)
      .where(eq(commoditySnapshots.itemId, TEST_ITEM));

    expect(item).toEqual(expect.objectContaining({
      name: "Hydrated Market Name",
      itemQuality: 4,
      qualityRank: 2,
      isReagent: true,
      marketType: "commodity",
      metadataStatus: "complete",
      itemClass: "Trade Goods",
    }));
    expect(output).toEqual(expect.objectContaining({
      name: "Architecture Recipe",
      metadataStatus: "complete",
      marketType: "realm",
      isCraftedOutput: true,
    }));
    expect(professionCount?.value).toBe(1);
    expect(recipeCount?.value).toBe(1);
    expect(historyCount?.value).toBe(1);
  });

  test("rolls back a failure immediately before publication commits", async () => {
    const before = await db.select({ id: professions.id }).from(professions);

    let failure: unknown;
    try {
      await publishProfessionCatalog(fixture, {
        beforeCommit: async () => {
          throw new Error("forced publication failure");
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("forced publication failure");

    const after = await db.select({ id: professions.id }).from(professions);
    expect(after).toEqual(before);
  });

  test("a concurrent ensure waits for the lock and rechecks the catalog", async () => {
    const connection = await sql.reserve();
    await connection`SELECT pg_advisory_lock(hashtextextended('copper:profession-catalog', 0))`;
    let lockHeld = true;
    try {
      const module = createProfessionCatalogModule({
        load: async () => bundled,
        publish: async () => {
          throw new Error("ensure should not republish an existing catalog");
        },
        lockTimeoutMs: 2_000,
      });
      const resultPromise = module.ensurePresent();
      await Bun.sleep(200);
      await connection`SELECT pg_advisory_unlock(hashtextextended('copper:profession-catalog', 0))`;
      lockHeld = false;

      await expect(resultPromise).resolves.toEqual({ outcome: "already-present" });
    } finally {
      if (lockHeld) await connection`SELECT pg_advisory_unlock(hashtextextended('copper:profession-catalog', 0))`;
      connection.release();
    }
  });
});
