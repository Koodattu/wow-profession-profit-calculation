import { afterAll, describe, expect, test } from "bun:test";
import { db, sql } from "../src/db";
import { items, regions } from "../src/db/schema";
import {
  createAuctionRefreshModule,
  type AuctionSource,
  type CommodityAuctionInput,
  type RealmAuctionInput,
} from "../src/services/auction-refresh";

const TEST_REGION = "archtest";
const TEST_ITEM_MIN = 2_100_000_000;
const TEST_ITEM_MAX = 2_100_000_999;

type Row = Record<string, unknown>;

function rows(result: Iterable<object | undefined>): Row[] {
  return Array.from(result) as Row[];
}

async function cleanAuctionRefreshTestMarket(): Promise<void> {
  await sql`DELETE FROM realm_daily WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM commodity_daily WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM realm_snapshots WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM commodity_snapshots WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM realm_latest WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM commodity_latest WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM auction_sync_runs WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM realms WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM connected_realms WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM regions WHERE id = ${TEST_REGION}`;
  await sql`DELETE FROM items WHERE id BETWEEN ${TEST_ITEM_MIN} AND ${TEST_ITEM_MAX}`;
}

async function prepareTestMarket(): Promise<void> {
  await cleanAuctionRefreshTestMarket();
  await db.insert(regions).values({
    id: TEST_REGION,
    name: "Architecture Test",
    apiHost: "invalid.local",
    oauthHost: "invalid.local",
  });
}

async function seedTestItems(itemIds: number[]): Promise<void> {
  for (let index = 0; index < itemIds.length; index += 500) {
    const batch = itemIds.slice(index, index + 500);
    await db
      .insert(items)
      .values(batch.map((id) => ({ id, name: `Architecture Test Item ${id}`, metadataStatus: "complete" })))
      .onConflictDoNothing();
  }
}

function sourceWith(overrides: Partial<AuctionSource>): AuctionSource {
  return {
    fetchCommodityAuctions: overrides.fetchCommodityAuctions ?? (async () => []),
    fetchRealmAuctions: overrides.fetchRealmAuctions ?? (async () => []),
  };
}

afterAll(async () => {
  await sql.end();
});

describe.serial("auction refresh interface", () => {
  test("a failed fetch preserves current market state and records the failed run", async () => {
    await prepareTestMarket();
    try {
      await seedTestItems([TEST_ITEM_MIN]);
      let shouldFail = false;
      const source = sourceWith({
        async fetchCommodityAuctions() {
          if (shouldFail) throw new Error("fixture feed unavailable");
          return [{ item: { id: TEST_ITEM_MIN }, quantity: 7, unit_price: 1234 }];
        },
      });
      const refresh = createAuctionRefreshModule({ source, realmHistoryIntervalHours: 6 });

      await refresh.refreshCommodities(TEST_REGION);
      const before = rows(await sql`SELECT min_price, total_quantity FROM commodity_latest WHERE region_id = ${TEST_REGION}`)[0];
      shouldFail = true;

      let refreshError: unknown;
      try {
        await refresh.refreshCommodities(TEST_REGION);
      } catch (error) {
        refreshError = error;
      }

      const after = rows(await sql`SELECT min_price, total_quantity FROM commodity_latest WHERE region_id = ${TEST_REGION}`)[0];
      const runs = rows(
        await sql`SELECT status, row_count, last_error FROM auction_sync_runs WHERE region_id = ${TEST_REGION} ORDER BY id DESC`,
      );
      expect(refreshError).toBeInstanceOf(Error);
      expect((refreshError as Error).message).toBe("fixture feed unavailable");
      expect(after).toEqual(before);
      expect(runs.map((run) => run.status)).toEqual(["failed", "succeeded"]);
      expect(runs[0]?.last_error).toBe("fixture feed unavailable");
      expect(runs[1]?.row_count).toBe(1);
    } finally {
      await cleanAuctionRefreshTestMarket();
    }
  });

  test("a successful empty feed atomically represents an empty current market", async () => {
    await prepareTestMarket();
    try {
      await seedTestItems([TEST_ITEM_MIN + 1]);
      let auctions: CommodityAuctionInput[] = [{ item: { id: TEST_ITEM_MIN + 1 }, quantity: 3, unit_price: 900 }];
      const refresh = createAuctionRefreshModule({
        source: sourceWith({ fetchCommodityAuctions: async () => auctions }),
        realmHistoryIntervalHours: 6,
      });

      await refresh.refreshCommodities(TEST_REGION);
      auctions = [];
      const result = await refresh.refreshCommodities(TEST_REGION);

      const current = rows(await sql`SELECT item_id FROM commodity_latest WHERE region_id = ${TEST_REGION}`);
      const runs = rows(
        await sql`SELECT status, row_count FROM auction_sync_runs WHERE region_id = ${TEST_REGION} ORDER BY id DESC LIMIT 1`,
      );
      expect(current).toHaveLength(0);
      expect(result.rowCount).toBe(0);
      expect(runs[0]).toEqual({ status: "succeeded", row_count: 0 });
    } finally {
      await cleanAuctionRefreshTestMarket();
    }
  });

  test("realm observations canonicalize variants and respect the history cadence", async () => {
    await prepareTestMarket();
    try {
      let currentTime = new Date("2026-08-09T00:00:00.000Z");
      const itemId = TEST_ITEM_MIN + 2;
      await seedTestItems([itemId]);
      const auctions: RealmAuctionInput[] = [
        {
          item: {
            id: itemId,
            context: 5,
            bonus_lists: [9, 3],
            modifiers: [
              { type: 2, value: 20 },
              { type: 1, value: 10 },
            ],
          },
          buyout: 2_000,
          quantity: 2,
        },
        {
          item: {
            id: itemId,
            context: 5,
            bonus_lists: [3, 9],
            modifiers: [
              { type: 1, value: 10 },
              { type: 2, value: 20 },
            ],
          },
          buyout: 900,
          quantity: 1,
        },
      ];
      const refresh = createAuctionRefreshModule({
        source: sourceWith({ fetchRealmAuctions: async () => auctions }),
        realmHistoryIntervalHours: 6,
        now: () => new Date(currentTime),
      });

      const first = await refresh.refreshRealm(TEST_REGION, 2_147_483_001, new Set([itemId]));
      currentTime = new Date("2026-08-09T01:00:00.000Z");
      const second = await refresh.refreshRealm(TEST_REGION, 2_147_483_001, new Set([itemId]));
      currentTime = new Date("2026-08-09T07:00:00.000Z");
      const third = await refresh.refreshRealm(TEST_REGION, 2_147_483_001, new Set([itemId]));

      const current = rows(
        await sql`SELECT variant_key, bonus_lists, modifiers, min_buyout, num_auctions, total_value::text FROM realm_latest WHERE region_id = ${TEST_REGION}`,
      );
      const history = rows(await sql`SELECT snapshot_time FROM realm_snapshots WHERE region_id = ${TEST_REGION} ORDER BY snapshot_time`);
      expect(current).toHaveLength(1);
      expect(current[0]?.bonus_lists).toEqual([3, 9]);
      expect(current[0]?.modifiers).toEqual([
        { type: 1, value: 10 },
        { type: 2, value: 20 },
      ]);
      expect(Number(current[0]?.min_buyout)).toBe(900);
      expect(current[0]?.num_auctions).toBe(2);
      expect(current[0]?.total_value).toBe("2900");
      expect(history).toHaveLength(2);
      expect([first.historyRowCount, second.historyRowCount, third.historyRowCount]).toEqual([1, 0, 1]);
    } finally {
      await cleanAuctionRefreshTestMarket();
    }
  });

  test("the next UTC hour records history even when a refresh finishes earlier", async () => {
    await prepareTestMarket();
    try {
      const itemId = TEST_ITEM_MIN + 3;
      await seedTestItems([itemId]);
      let now = new Date("2026-08-09T00:59:00Z");
      const refresh = createAuctionRefreshModule({
        source: sourceWith({ fetchRealmAuctions: async () => [{ item: { id: itemId }, buyout: 100, quantity: 3 }] }),
        realmHistoryIntervalHours: 1,
        now: () => now,
      });
      await refresh.refreshRealm(TEST_REGION, 2_147_483_001, new Set([itemId]));
      now = new Date("2026-08-09T01:00:00Z");
      await refresh.refreshRealm(TEST_REGION, 2_147_483_001, new Set([itemId]));
      const history = rows(await sql`SELECT total_value::text FROM realm_snapshots WHERE region_id = ${TEST_REGION}`);
      expect(history).toEqual([{ total_value: "100" }, { total_value: "100" }]);
    } finally {
      await cleanAuctionRefreshTestMarket();
    }
  });

  test(
    "overlapping realm refreshes acquire shared catalog rows without deadlocking",
    async () => {
      await prepareTestMarket();
      try {
        const itemIds = Array.from({ length: 520 }, (_, index) => TEST_ITEM_MIN + 100 + index);
        await seedTestItems(itemIds);
        let arrivals = 0;
        let release!: () => void;
        const bothReady = new Promise<void>((resolve) => {
          release = resolve;
        });
        const source = sourceWith({
          async fetchRealmAuctions(_regionId, connectedRealmId) {
            arrivals++;
            if (arrivals === 2) release();
            await bothReady;
            const orderedIds = connectedRealmId === 2_147_483_001 ? itemIds : [...itemIds].reverse();
            return orderedIds.map((itemId, index) => ({ item: { id: itemId }, buyout: 1_000 + index, quantity: 1 }));
          },
        });
        const refresh = createAuctionRefreshModule({ source, realmHistoryIntervalHours: 6 });
        let timeout: ReturnType<typeof setTimeout> | undefined;

        try {
          const results = await Promise.race([
            Promise.all([
              refresh.refreshRealm(TEST_REGION, 2_147_483_001, new Set()),
              refresh.refreshRealm(TEST_REGION, 2_147_483_002, new Set()),
            ]),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error("concurrent refresh timed out")), 15_000);
            }),
          ]);

          const counts = rows(
            await sql`
              SELECT count(*)::int AS row_count, count(DISTINCT item_id)::int AS item_count
              FROM realm_latest
              WHERE region_id = ${TEST_REGION}
            `,
          )[0];
          expect(results.map((result) => result.rowCount)).toEqual([520, 520]);
          expect(counts).toEqual({ row_count: 1040, item_count: 520 });
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      } finally {
        await cleanAuctionRefreshTestMarket();
      }
    },
    20_000,
  );
});
