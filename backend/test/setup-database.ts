import "./support/local-env";
import { sql } from "../src/db";
import { initializeDatabase } from "../src/startup";
import { createAuctionRefreshModule } from "../src/services/auction-refresh";

// Bounded synthetic auctions over the bundled, public profession catalog.
// No remote fetches, secrets, production data, or background jobs.
try {
  await initializeDatabase();
  await sql`INSERT INTO regions (id, name, api_host) VALUES ('eu', 'Europe', 'example.invalid') ON CONFLICT DO NOTHING`;
  for (const [id, name] of [[1, "Silvermoon (Test)"], [2, "Draenor (Test)"], [3, "Empty Realm (Test)"]] as const) {
    await sql`INSERT INTO connected_realms (id, region_id) VALUES (${id}, 'eu') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO realms (id, region_id, connected_realm_id, name, slug)
      VALUES (${id}, 'eu', ${id}, ${name}, ${`test-${id}`}) ON CONFLICT DO NOTHING`;
  }
  const catalog = await sql<{ id: number; is_reagent: boolean }[]>`SELECT id, is_reagent FROM items ORDER BY id`;
  const commodityItems = catalog.filter((item) => item.is_reagent || item.id % 3 !== 0);
  const realmItems = catalog.filter((item) => !item.is_reagent && item.id % 3 === 0);
  const tracked = new Set(realmItems.map((item) => item.id));
  const now = Date.now();
  const [existing] = await sql`SELECT count(*)::int AS count FROM market_observations WHERE region_id = 'eu'`;
  // Repeated setup refreshes current data without replaying older observations.
  for (const hoursAgo of existing?.count ? [0] : [2, 1, 0]) {
    const refresh = createAuctionRefreshModule({
      now: () => new Date(now - hoursAgo * 3_600_000),
      realmHistoryIntervalHours: 1,
      source: {
        fetchCommodityAuctions: async () => commodityItems.map((item) => ({
          item: { id: item.id }, quantity: 100 + item.id % 100,
          unit_price: (item.is_reagent ? 10_000 : 500_000) + item.id % 100 * 100 + hoursAgo * 100,
        })),
        fetchRealmAuctions: async (_region, realmId) => realmId === 3 ? [] : realmItems.map((item) => ({
          id: item.id * 10 + realmId, item: { id: item.id }, quantity: 1,
          buyout: 1_000_000 * realmId + item.id % 100 * 1_000 + hoursAgo * 1_000, time_left: "LONG",
        })),
      },
    });
    await refresh.refreshCommodities("eu");
    for (const realmId of [1, 2, 3]) await refresh.refreshRealm("eu", realmId, tracked);
  }
  console.log(`Synthetic test data ready: ${commodityItems.length} commodities, ${realmItems.length} realm items, 3 realms.`);
} finally {
  await sql.end();
}
