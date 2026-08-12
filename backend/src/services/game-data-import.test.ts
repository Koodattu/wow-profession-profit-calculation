import { describe, expect, test } from "bun:test";
import { parseProfessionCatalog, readBundledProfessionCatalog } from "./game-data-import";

function reagent(overrides: Record<string, unknown> = {}) {
  return {
    itemID: 10,
    itemName: "Reagent",
    entryTypes: ["reagent"],
    professionNames: ["Alchemy"],
    itemQuality: 2,
    qualityRank: 1,
    ...overrides,
  };
}

function recipe(overrides: Record<string, unknown> = {}) {
  return {
    recipeID: 20,
    recipeName: "Recipe",
    professionSkillLineID: 30,
    professionName: "Alchemy",
    recipeCategoryID: 40,
    categoryName: "Potions",
    topCategoryID: null,
    topCategoryName: null,
    outputItemID: 50,
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
        options: [{ optionIndex: 1, reagentItemID: 10, reagentName: "Reagent" }],
      },
    ],
    ...overrides,
  };
}

describe("Profession Catalog source", () => {
  test("accepts the bundled catalog", async () => {
    const catalog = await readBundledProfessionCatalog();
    expect(catalog.reagentEntries.length).toBeGreaterThan(0);
    expect(catalog.recipeEntries.length).toBeGreaterThan(0);
  });

  test("parses the fields and relationships Copper consumes", () => {
    const catalog = parseProfessionCatalog([reagent(), reagent({ itemID: null, itemName: "Empower" })], [recipe()]);
    expect(catalog.reagentEntries[0]?.itemID).toBe(10);
    expect(catalog.reagentEntries[1]?.itemID).toBeNull();
    expect(catalog.recipeEntries[0]?.reagents[0]?.options[0]?.reagentItemID).toBe(10);
  });

  test("rejects malformed and conflicting source data before publication", () => {
    expect(() => parseProfessionCatalog([], [recipe()])).toThrow("must not be empty");
    expect(() => parseProfessionCatalog([reagent(), reagent()], [recipe()])).toThrow("Duplicate Profession Catalog item 10");
    expect(() =>
      parseProfessionCatalog(
        [reagent()],
        [recipe(), recipe({ recipeID: 21, professionName: "Different" })],
      ),
    ).toThrow("Profession 30 has conflicting names");
    expect(() => parseProfessionCatalog([reagent()], [recipe({ qualityIDs: [1] })])).toThrow("unsupported rank count");
    expect(() =>
      parseProfessionCatalog(
        [reagent()],
        [recipe({ outputQuantityMin: 2, outputQuantityMax: 1 })],
      ),
    ).toThrow("output quantity range is invalid");
    expect(() =>
      parseProfessionCatalog(
        [reagent()],
        [
          recipe({
            reagents: [
              recipe().reagents[0],
              recipe().reagents[0],
            ],
          }),
        ],
      ),
    ).toThrow("duplicate reagent slot indexes");
  });
});
