import { and, desc, eq, or, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { withAdvisoryLock } from "../db/advisory-lock";
import { auctionSyncRuns, connectedRealms, items, marketRefreshCycles } from "../db/schema";
import { runTrackedJob } from "../jobs/tracked-job";
import type { AuctionRefreshResult } from "./auction-refresh";
import { syncCommodities, syncRealmAuctions } from "./auction-sync";
import { isFresh } from "./freshness-policy";
import { syncConnectedRealms } from "./realm-sync";
import { ensureRegionExists } from "./region-sync";

export type MarketRefreshTrigger = "startup" | "scheduled" | "manual";
export type MarketRefreshCycleStatus = "running" | "succeeded" | "partial" | "failed" | "skipped";

export interface MarketScopeFreshness {
  latestAt: Date | null;
  fresh: boolean;
}

export interface RealmMarketScopeFreshness extends MarketScopeFreshness {
  connectedRealmId: number;
}

export interface MarketRefreshCycleSummary {
  id: number;
  trigger: MarketRefreshTrigger;
  status: MarketRefreshCycleStatus;
  startedAt: Date;
  finishedAt: Date | null;
  totalScopes: number;
  succeededScopes: number;
  failedScopes: number;
  skippedScopes: number;
  statusReason: string | null;
  lastError: string | null;
}

export interface RegionMarketStatus {
  regionId: string;
  commodity: MarketScopeFreshness;
  realms: RealmMarketScopeFreshness[];
  scopeCounts: {
    total: number;
    fresh: number;
    stale: number;
    missing: number;
  };
  latestCycle: MarketRefreshCycleSummary | null;
}

export interface MarketRefreshCycleResult extends MarketRefreshCycleSummary {
  regionId: string;
}

interface MarketRefreshCycleDependencies {
  refreshCommodities(regionId: string, cycleId: number): Promise<AuctionRefreshResult>;
  refreshRealm(
    regionId: string,
    connectedRealmId: number,
    trackedHistoryItemIds: ReadonlySet<number>,
    cycleId: number,
  ): Promise<AuctionRefreshResult>;
  refreshRealmCatalog(regionId: string): Promise<void>;
  ensureRegion?: (regionId: string) => Promise<void>;
  now?: () => Date;
  maxAgeMinutes?: number;
  realmConcurrency?: number;
}

export interface MarketRefreshCycleModule {
  run(regionId: string, trigger: MarketRefreshTrigger): Promise<MarketRefreshCycleResult>;
  getStatus(regionId: string, maxAgeMinutes?: number): Promise<RegionMarketStatus>;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function cycleSummary(row: typeof marketRefreshCycles.$inferSelect): MarketRefreshCycleSummary {
  return {
    id: row.id,
    trigger: row.trigger as MarketRefreshTrigger,
    status: row.status as MarketRefreshCycleStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    totalScopes: row.totalScopes,
    succeededScopes: row.succeededScopes,
    failedScopes: row.failedScopes,
    skippedScopes: row.skippedScopes,
    statusReason: row.statusReason,
    lastError: row.lastError,
  };
}

export async function getRegionMarketStatus(
  regionId: string,
  maxAgeMinutes = env.PRICE_STALE_AFTER_MINUTES,
): Promise<RegionMarketStatus> {
  const [realmRows, successfulRuns, latestCycles] = await Promise.all([
    db
      .select({ id: connectedRealms.id })
      .from(connectedRealms)
      .where(eq(connectedRealms.regionId, regionId))
      .orderBy(connectedRealms.id),
    db
      .select({
        scope: auctionSyncRuns.scope,
        connectedRealmId: auctionSyncRuns.connectedRealmId,
        observedAt: sql<Date | null>`max(${auctionSyncRuns.observedAt})`.mapWith(auctionSyncRuns.observedAt),
      })
      .from(auctionSyncRuns)
      .where(and(eq(auctionSyncRuns.regionId, regionId), eq(auctionSyncRuns.status, "succeeded")))
      .groupBy(auctionSyncRuns.scope, auctionSyncRuns.connectedRealmId),
    db
      .select()
      .from(marketRefreshCycles)
      .where(eq(marketRefreshCycles.regionId, regionId))
      .orderBy(desc(marketRefreshCycles.startedAt), desc(marketRefreshCycles.id))
      .limit(1),
  ]);

  let commodityLatestAt: Date | null = null;
  const realmLatestAt = new Map<number, Date>();
  for (const run of successfulRuns) {
    if (!run.observedAt) continue;
    if (run.scope === "commodity") {
      commodityLatestAt = run.observedAt;
    } else if (run.scope === "realm" && run.connectedRealmId !== null) {
      realmLatestAt.set(run.connectedRealmId, run.observedAt);
    }
  }

  const commodity = { latestAt: commodityLatestAt, fresh: isFresh(commodityLatestAt, maxAgeMinutes) };
  const realms = realmRows.map(({ id }) => {
    const latestAt = realmLatestAt.get(id) ?? null;
    return { connectedRealmId: id, latestAt, fresh: isFresh(latestAt, maxAgeMinutes) };
  });
  const scopes = [commodity, ...realms];

  return {
    regionId,
    commodity,
    realms,
    scopeCounts: {
      total: scopes.length,
      fresh: scopes.filter((scope) => scope.fresh).length,
      stale: scopes.filter((scope) => scope.latestAt !== null && !scope.fresh).length,
      missing: scopes.filter((scope) => scope.latestAt === null).length,
    },
    latestCycle: latestCycles[0] ? cycleSummary(latestCycles[0]) : null,
  };
}

export function createMarketRefreshCycleModule(dependencies: MarketRefreshCycleDependencies): MarketRefreshCycleModule {
  const {
    refreshCommodities,
    refreshRealm,
    refreshRealmCatalog,
    ensureRegion = ensureRegionExists,
    now = () => new Date(),
    maxAgeMinutes = env.PRICE_STALE_AFTER_MINUTES,
    realmConcurrency = env.REALM_SYNC_CONCURRENCY,
  } = dependencies;

  if (!Number.isInteger(realmConcurrency) || realmConcurrency <= 0) {
    throw new Error("realmConcurrency must be a positive integer");
  }

  async function finishCycle(
    cycleId: number,
    values: Pick<
      typeof marketRefreshCycles.$inferInsert,
      "status" | "totalScopes" | "succeededScopes" | "failedScopes" | "skippedScopes" | "statusReason" | "lastError"
    >,
  ): Promise<MarketRefreshCycleResult> {
    const [row] = await db
      .update(marketRefreshCycles)
      .set({ ...values, finishedAt: now() })
      .where(eq(marketRefreshCycles.id, cycleId))
      .returning();
    if (!row) throw new Error(`Market Refresh Cycle ${cycleId} disappeared`);
    return { regionId: row.regionId, ...cycleSummary(row) };
  }

  async function execute(regionId: string, trigger: MarketRefreshTrigger): Promise<MarketRefreshCycleResult> {
    const [cycle] = await db.insert(marketRefreshCycles).values({ regionId, trigger }).returning();
    if (!cycle) throw new Error("Failed to start Market Refresh Cycle");
    const cycleId = cycle.id;

    try {
      let realmRows = await db
        .select({ id: connectedRealms.id })
        .from(connectedRealms)
        .where(eq(connectedRealms.regionId, regionId))
        .orderBy(connectedRealms.id);

      if (trigger === "manual" || realmRows.length === 0) {
        await refreshRealmCatalog(regionId);
        realmRows = await db
          .select({ id: connectedRealms.id })
          .from(connectedRealms)
          .where(eq(connectedRealms.regionId, regionId))
          .orderBy(connectedRealms.id);
      }
      if (realmRows.length === 0) throw new Error(`No connected realms are available for ${regionId}`);

      const statusBefore = trigger === "startup" ? await getRegionMarketStatus(regionId, maxAgeMinutes) : null;
      const refreshCommodity = trigger !== "startup" || !statusBefore!.commodity.fresh;
      const realmIdsToRefresh = realmRows
        .map((row) => row.id)
        .filter((id) => trigger !== "startup" || !statusBefore!.realms.find((scope) => scope.connectedRealmId === id)?.fresh);
      const totalScopes = 1 + realmRows.length;
      const skippedScopes = totalScopes - Number(refreshCommodity) - realmIdsToRefresh.length;

      if (!refreshCommodity && realmIdsToRefresh.length === 0) {
        return finishCycle(cycleId, {
          status: "skipped",
          totalScopes,
          succeededScopes: 0,
          failedScopes: 0,
          skippedScopes,
          statusReason: "all market scopes are fresh",
          lastError: null,
        });
      }

      const failures: string[] = [];
      let succeededScopes = 0;
      if (refreshCommodity) {
        try {
          await refreshCommodities(regionId, cycleId);
          succeededScopes++;
        } catch (error) {
          failures.push(`commodities: ${errorMessage(error)}`);
        }
      }

      const trackedRows = await db
        .select({ id: items.id })
        .from(items)
        .where(or(eq(items.isReagent, true), eq(items.isCraftedOutput, true)));
      const trackedHistoryItemIds = new Set(trackedRows.map((row) => row.id));
      let nextIndex = 0;
      let completed = 0;

      async function worker(): Promise<void> {
        while (nextIndex < realmIdsToRefresh.length) {
          const connectedRealmId = realmIdsToRefresh[nextIndex++]!;
          try {
            await refreshRealm(regionId, connectedRealmId, trackedHistoryItemIds, cycleId);
            succeededScopes++;
          } catch (error) {
            failures.push(`connected realm ${connectedRealmId}: ${errorMessage(error)}`);
          } finally {
            completed++;
            console.log(`[MarketRefreshCycle] Realm progress: ${completed}/${realmIdsToRefresh.length}`);
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(realmConcurrency, realmIdsToRefresh.length) }, () => worker()),
      );

      const failedScopes = failures.length;
      const cycleStatus: MarketRefreshCycleStatus =
        failedScopes === 0 ? "succeeded" : succeededScopes + skippedScopes > 0 ? "partial" : "failed";
      return finishCycle(cycleId, {
        status: cycleStatus,
        totalScopes,
        succeededScopes,
        failedScopes,
        skippedScopes,
        statusReason: null,
        lastError: failures.length > 0 ? failures.join("; ").slice(0, 2_000) : null,
      });
    } catch (error) {
      return finishCycle(cycleId, {
        status: "failed",
        totalScopes: 0,
        succeededScopes: 0,
        failedScopes: 0,
        skippedScopes: 0,
        statusReason: null,
        lastError: errorMessage(error),
      });
    }
  }

  return {
    async run(regionId, trigger) {
      await ensureRegion(regionId);
      const lock = await withAdvisoryLock(`copper:market-refresh-cycle:${regionId}`, () => execute(regionId, trigger));
      if (lock.acquired) return lock.value;

      const [skipped] = await db
        .insert(marketRefreshCycles)
        .values({
          regionId,
          trigger,
          status: "skipped",
          finishedAt: now(),
          statusReason: "already running",
        })
        .returning();
      if (!skipped) throw new Error("Failed to record skipped Market Refresh Cycle");
      return { regionId, ...cycleSummary(skipped) };
    },

    getStatus: getRegionMarketStatus,
  };
}

const productionModule = createMarketRefreshCycleModule({
  refreshCommodities: syncCommodities,
  refreshRealm: syncRealmAuctions,
  refreshRealmCatalog: async (regionId) => {
    await runTrackedJob(`realm-catalog:${regionId}`, () => syncConnectedRealms(regionId));
  },
});

export const runMarketRefreshCycle = productionModule.run;
export const getMarketStatus = productionModule.getStatus;
