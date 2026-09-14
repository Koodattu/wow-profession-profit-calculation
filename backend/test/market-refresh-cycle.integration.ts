import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db";
import { auctionSyncRuns, connectedRealms, regions } from "../src/db/schema";
import { createMarketRefreshCycleModule } from "../src/services/market-refresh-cycle";

const TEST_REGION = "cycletest";
const REALM_ONE = 2_147_482_901;
const REALM_TWO = 2_147_482_902;

async function clean(): Promise<void> {
  await sql`DELETE FROM auction_sync_runs WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM market_refresh_cycles WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM connected_realms WHERE region_id = ${TEST_REGION}`;
  await sql`DELETE FROM regions WHERE id = ${TEST_REGION}`;
}

async function prepare(realms: number[] = [REALM_ONE, REALM_TWO]): Promise<void> {
  await clean();
  await db.insert(regions).values({
    id: TEST_REGION,
    name: "Cycle Test",
    apiHost: "invalid.local",
    oauthHost: "invalid.local",
  });
  if (realms.length > 0) {
    await db.insert(connectedRealms).values(realms.map((id) => ({ id, regionId: TEST_REGION })));
  }
}

function moduleWith(overrides: {
  refreshCommodities?: (regionId: string, cycleId: number) => Promise<never> | Promise<{ runId: number; observedAt: Date; rowCount: number; historyRowCount: number }>;
  refreshRealm?: (regionId: string, connectedRealmId: number, tracked: ReadonlySet<number>, cycleId: number) => Promise<never> | Promise<{ runId: number; observedAt: Date; rowCount: number; historyRowCount: number }>;
} = {}) {
  const recordSuccess = async (scope: "commodity" | "realm", connectedRealmId: number | null, cycleId: number) => {
    const observedAt = new Date();
    const [run] = await db
      .insert(auctionSyncRuns)
      .values({
        cycleId,
        regionId: TEST_REGION,
        scope,
        connectedRealmId,
        status: "succeeded",
        observedAt,
        finishedAt: observedAt,
        rowCount: 0,
      })
      .returning({ id: auctionSyncRuns.id });
    return { runId: run!.id, observedAt, rowCount: 0, historyRowCount: 0 };
  };

  return createMarketRefreshCycleModule({
    ensureRegion: async () => undefined,
    refreshRealmCatalog: async () => undefined,
    refreshCommodities:
      overrides.refreshCommodities ?? ((_, cycleId) => recordSuccess("commodity", null, cycleId)),
    refreshRealm:
      overrides.refreshRealm ?? ((_, connectedRealmId, __, cycleId) => recordSuccess("realm", connectedRealmId, cycleId)),
    realmConcurrency: 2,
  });
}

afterAll(async () => {
  await clean();
  await sql.end();
});

describe.serial("Market Refresh Cycle interface", () => {
  test("a fresh startup cycle skips every market scope", async () => {
    await prepare();
    const observedAt = new Date();
    await db.insert(auctionSyncRuns).values([
      { regionId: TEST_REGION, scope: "commodity", status: "succeeded", observedAt, finishedAt: observedAt, rowCount: 0 },
      { regionId: TEST_REGION, scope: "realm", connectedRealmId: REALM_ONE, status: "succeeded", observedAt, finishedAt: observedAt, rowCount: 0 },
      { regionId: TEST_REGION, scope: "realm", connectedRealmId: REALM_TWO, status: "succeeded", observedAt, finishedAt: observedAt, rowCount: 0 },
    ]);
    const cycle = moduleWith({
      refreshCommodities: async () => {
        throw new Error("unexpected commodity refresh");
      },
      refreshRealm: async () => {
        throw new Error("unexpected realm refresh");
      },
    });

    const result = await cycle.run(TEST_REGION, "startup");

    expect(result.status).toBe("skipped");
    expect(result.skippedScopes).toBe(3);
    expect(result.statusReason).toBe("all market scopes are fresh");
  });

  test("a scheduled cycle records partial success and links Auction Refreshes", async () => {
    await prepare();
    const cycle = moduleWith({
      refreshRealm: async (regionId, connectedRealmId, _tracked, cycleId) => {
        if (connectedRealmId === REALM_TWO) throw new Error("fixture realm unavailable");
        const observedAt = new Date();
        const [run] = await db
          .insert(auctionSyncRuns)
          .values({ cycleId, regionId, scope: "realm", connectedRealmId, status: "succeeded", observedAt, finishedAt: observedAt, rowCount: 0 })
          .returning({ id: auctionSyncRuns.id });
        return { runId: run!.id, observedAt, rowCount: 0, historyRowCount: 0 };
      },
    });

    const result = await cycle.run(TEST_REGION, "scheduled");
    const linked = await db
      .select({ cycleId: auctionSyncRuns.cycleId })
      .from(auctionSyncRuns)
      .where(eq(auctionSyncRuns.regionId, TEST_REGION));

    expect(result.status).toBe("partial");
    expect([result.totalScopes, result.succeededScopes, result.failedScopes]).toEqual([3, 2, 1]);
    expect(result.lastError).toContain(`connected realm ${REALM_TWO}`);
    expect(linked).toHaveLength(2);
    expect(linked.every((run) => run.cycleId === result.id)).toBe(true);
  });

  test("a successful empty Auction Refresh remains fresh", async () => {
    await prepare([REALM_ONE]);
    const cycle = moduleWith();

    await cycle.run(TEST_REGION, "scheduled");
    const status = await cycle.getStatus(TEST_REGION, 60);

    expect(status.commodity.fresh).toBe(true);
    expect(status.realms).toEqual([expect.objectContaining({ connectedRealmId: REALM_ONE, fresh: true })]);
    expect(status.scopeCounts).toEqual({ total: 2, fresh: 2, stale: 0, missing: 0 });
  });

  test("a manual cycle refreshes its realm prerequisite before market scopes", async () => {
    await prepare([]);
    const calls: string[] = [];
    const cycle = createMarketRefreshCycleModule({
      ensureRegion: async () => undefined,
      refreshRealmCatalog: async () => {
        calls.push("catalog");
        await db.insert(connectedRealms).values({ id: REALM_ONE, regionId: TEST_REGION });
      },
      refreshCommodities: async (_regionId, cycleId) => {
        calls.push("commodity");
        const observedAt = new Date();
        const [run] = await db
          .insert(auctionSyncRuns)
          .values({ cycleId, regionId: TEST_REGION, scope: "commodity", status: "succeeded", observedAt, finishedAt: observedAt, rowCount: 0 })
          .returning({ id: auctionSyncRuns.id });
        return { runId: run!.id, observedAt, rowCount: 0, historyRowCount: 0 };
      },
      refreshRealm: async (_regionId, connectedRealmId, _tracked, cycleId) => {
        calls.push(`realm:${connectedRealmId}`);
        const observedAt = new Date();
        const [run] = await db
          .insert(auctionSyncRuns)
          .values({ cycleId, regionId: TEST_REGION, scope: "realm", connectedRealmId, status: "succeeded", observedAt, finishedAt: observedAt, rowCount: 0 })
          .returning({ id: auctionSyncRuns.id });
        return { runId: run!.id, observedAt, rowCount: 0, historyRowCount: 0 };
      },
      realmConcurrency: 1,
    });

    const result = await cycle.run(TEST_REGION, "manual");

    expect(result.status).toBe("succeeded");
    expect(calls).toEqual(["catalog", "commodity", `realm:${REALM_ONE}`]);
  });

  test("a competing cycle is persisted as skipped", async () => {
    await prepare([REALM_ONE]);
    const connection = await sql.reserve();
    try {
      await connection`SELECT pg_advisory_lock(hashtextextended(${`copper:market-refresh-cycle:${TEST_REGION}`}, 0))`;
      const result = await moduleWith().run(TEST_REGION, "manual");
      expect(result.status).toBe("skipped");
      expect(result.statusReason).toBe("already running");
    } finally {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${`copper:market-refresh-cycle:${TEST_REGION}`}, 0))`;
      connection.release();
    }
  });
});
