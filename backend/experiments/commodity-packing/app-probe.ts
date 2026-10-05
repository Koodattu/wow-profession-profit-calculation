import "../../test/support/local-env";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { RecipeValuation } from "../../src/services/recipe-valuation";

const [schema, output, anchor, mode = "stable"] = process.argv.slice(2);
if (!schema || !["packing_baseline", "packing_candidate"].includes(schema) || !output || !anchor) throw new Error("Invalid probe arguments");
const target = new URL(process.env.DATABASE_URL!);
if (target.pathname !== "/copper_commodity_packing_test") throw new Error("Dedicated benchmark database required");
target.searchParams.set("search_path", `${schema},public`);
target.searchParams.set("max", "1");
process.env.DATABASE_URL = target.toString();
const NativeDate = Date;
// Preserve NativeDate.prototype so existing Date values still pass the reader's
// `instanceof Date` check. SQL expression timestamps may also arrive as strings.
globalThis.Date = new Proxy(NativeDate, {
  construct(constructor,args) { return Reflect.construct(constructor,args.length ? args : [`${anchor}T12:00:00Z`]); },
  get(constructor,key,receiver) {
    return key === "now" ? () => new NativeDate(`${anchor}T12:00:00Z`).getTime() : Reflect.get(constructor,key,receiver);
  },
});

// Opt-in prototype of the required reader edit. The source file stays untouched.
// Both baseline and candidate use the same deterministic rule, with an independent
// expected-price assertion below. Legacy mode reproduces the original tie bug.
if (mode === "stable") Bun.plugin({
  name: "commodity-packing-reader-prototype",
  setup(build) {
    build.onLoad({filter: /[\\/]services[\\/]market-history\.ts$/}, async ({path}) => {
      const source = await readFile(path,"utf8");
      const original = "ORDER BY ${commoditySnapshots.snapshotTime} DESC";
      const replacement = "ORDER BY ${commoditySnapshots.snapshotTime} DESC, ${commoditySnapshots.id} DESC";
      assert.equal(source.split(original).length-1,5,"Review reader prototype when the application query changes");
      return { contents: source.replaceAll(original,replacement),loader: "ts" };
    });
  },
});

const { sql } = await import("../../src/db");
const { aggregateDailyPrices } = await import("../../src/services/price-maintenance");
const { getMarketHistories } = await import("../../src/services/market-history");
const { createRecipeHistoryModule } = await import("../../src/services/recipe-history");
const { default: itemRoutes } = await import("../../src/routes/items");
const result: Record<string, unknown> = { checks: {}, latency: {} };
const checks = result.checks as Record<string, string>;
const latency = result.latency as Record<string, number[]>;
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data instanceof Map ? [...data] : data)).digest("hex");
try {
  await aggregateDailyPrices();
  checks.weightedDaily = digest(await sql`SELECT (to_jsonb(d)-'id')::text AS record FROM commodity_daily d ORDER BY region_id,item_id,date`);
  const cohorts = await sql`SELECT region_id,array_agg(item_id ORDER BY item_id) AS ids FROM
    (SELECT DISTINCT region_id,item_id FROM commodity_snapshots) c GROUP BY region_id ORDER BY region_id`;
  for (const cohort of cohorts) {
    const all = cohort.ids as number[];
    // Include every item for equality, then single and 32-item reads for latency.
    for (const range of ["24h", "7d", "14d", "30d", "6m", "1y", "all"] as const) {
      const histories = await getMarketHistories({ regionId: cohort.region_id, itemIds: all, range, type: "commodity" });
      checks[`${cohort.region_id}:${range}`] = digest(histories);
      for (const [itemId,points] of histories) checks[`${cohort.region_id}:${range}:${itemId}`] = digest(points);
    }
    for (const count of [1, 32]) {
      const key = `${cohort.region_id}:${count}-item-30d`;
      latency[key] = [];
      for (let run = 0; run < 9; run++) {
        const start = performance.now();
        const series = await getMarketHistories({ regionId: cohort.region_id, itemIds: all.slice(0, count), range: "30d", type: "commodity" });
        if (run >= 2) latency[key]!.push(performance.now() - start);
        checks[key] = digest(series);
      }
    }
    if (cohort.region_id === "eu") {
      const response = await itemRoutes.request(`/${all[0]}/prices?region=eu&type=commodity&range=30d`);
      if (!response.ok) throw new Error("History HTTP route failed");
      checks.http = digest(await response.json());
      // Public history is the input to both chart and full-record CSV rendering.
      await writeFile(output.replace(/\.json$/, "-chart.json"), JSON.stringify(await getMarketHistories({
        regionId: "eu", itemIds: [all[0]!], range: "30d", type: "commodity",
      }).then((map) => map.get(all[0]!))));
    }
    const valuation: RecipeValuation = {
      recipeId: 1,recipeName: "Synthetic recipe",qualityTierType: "none",professionId: 1,professionName: "Synthetic",
      affectedByMulticraft: false,affectedByResourcefulness: false,
      scenarios: [{ scenarioKey: "fixture",reagentRank: 1,outputRank: 1,
        cost: { totalCost: null,reagents: all.slice(0, 2).map((itemId, index) => ({
          slotIndex: index,itemId,itemName: "Synthetic",itemQuality: null,quantity: index+2,unitPrice: null,totalPrice: null,
        })) }, outputItemId: all[2]!,outputItemName: "Synthetic",outputItemQuality: null,outputQuantity: 2,
        outputUnitPrice: null,outputTotalPrice: null,profit: null }],
    };
    const recipes = createRecipeHistoryModule({ loadValuation: async () => valuation,
      loadMarketHistories: (request) => getMarketHistories({ ...request, type: "commodity" }) });
    checks[`${cohort.region_id}:recipe`] = digest(await recipes.getRecipeHistory(1,cohort.region_id,1,"30d"));
  }
  checks.missing = digest(await getMarketHistories({ regionId: "eu",itemIds: [2100999999],range: "30d",type: "commodity" }));
  if (mode === "stable") {
    const edge = await getMarketHistories({ regionId: "eu",itemIds: [2100100091],range: "30d",type: "commodity" });
    const duplicateHour = edge.get(2100100091)!.find(point => new NativeDate(point.time).getUTCHours() === 1);
    assert.equal(duplicateHour!.min_price,99,"Highest original ID breaks equal-timestamp ties");
    assert.equal(duplicateHour!.median_price,99);
  }
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
} finally { await sql.end(); }
