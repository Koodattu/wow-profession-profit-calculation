import { desc, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { commoditySnapshots, realmSnapshots } from "../db/schema";
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
    .select({ snapshotTime: commoditySnapshots.snapshotTime })
    .from(commoditySnapshots)
    .where(eq(commoditySnapshots.regionId, regionId))
    .orderBy(desc(commoditySnapshots.snapshotTime))
    .limit(1);

  const [latestRealm] = await db
    .select({ snapshotTime: realmSnapshots.snapshotTime })
    .from(realmSnapshots)
    .where(eq(realmSnapshots.regionId, regionId))
    .orderBy(desc(realmSnapshots.snapshotTime))
    .limit(1);

  const commodityLatestAt = latestCommodity?.snapshotTime ?? null;
  const realmLatestAt = latestRealm?.snapshotTime ?? null;

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
