import { db } from "../db";
import { REGIONS } from "../config/regions";
import { regions } from "../db/schema";

export async function ensureRegionExists(regionId: string): Promise<void> {
  const region = REGIONS[regionId];

  if (!region) {
    throw new Error(`[RegionSync] Unknown region: ${regionId}`);
  }

  await db
    .insert(regions)
    .values({
      id: region.id,
      name: region.name,
      apiHost: region.apiHost,
      oauthHost: "oauth.battle.net",
    })
    .onConflictDoUpdate({
      target: regions.id,
      set: {
        name: region.name,
        apiHost: region.apiHost,
        oauthHost: "oauth.battle.net",
      },
    });
}
