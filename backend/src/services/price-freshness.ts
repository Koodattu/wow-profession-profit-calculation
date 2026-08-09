import { eq, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { commodityLatest, realmLatest, syncJobs } from "../db/schema";
import { isFresh } from "./freshness-policy";

export interface FeedFreshness {
  latestAt: Date | null;
  fresh: boolean;
}

export interface RegionPriceFreshness {
  commodity: FeedFreshness;
  realm: FeedFreshness;
}

export async function getRegionPriceFreshness(
  regionId: string,
  maxAgeMinutes = env.PRICE_STALE_AFTER_MINUTES,
): Promise<RegionPriceFreshness> {
  const [latestCommodity] = await db
    .select({ snapshotTime: sql<Date | null>`max(${commodityLatest.observedAt})` })
    .from(commodityLatest)
    .where(eq(commodityLatest.regionId, regionId));

  const [latestRealm] = await db
    .select({ snapshotTime: sql<Date | null>`max(${realmLatest.observedAt})` })
    .from(realmLatest)
    .where(eq(realmLatest.regionId, regionId));

  const [commodityJob] = await db.select({ lastSuccessAt: syncJobs.lastSuccessAt }).from(syncJobs).where(eq(syncJobs.name, `commodity-prices:${regionId}`)).limit(1);
  const [realmJob] = await db.select({ lastSuccessAt: syncJobs.lastSuccessAt }).from(syncJobs).where(eq(syncJobs.name, `realm-prices:${regionId}`)).limit(1);

  const commodityLatestAt = latestCommodity?.snapshotTime ? (commodityJob?.lastSuccessAt ?? latestCommodity.snapshotTime) : null;
  const realmLatestAt = latestRealm?.snapshotTime ? (realmJob?.lastSuccessAt ?? null) : null;

  return {
    commodity: {
      latestAt: commodityLatestAt,
      fresh: isFresh(commodityLatestAt, maxAgeMinutes),
    },
    realm: {
      latestAt: realmLatestAt,
      fresh: isFresh(realmLatestAt, maxAgeMinutes),
    },
  };
}
