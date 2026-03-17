import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { connectedRealms, realms } from "../db/schema";
import { BlizzardApi } from "./blizzard-api";
import { ensureRegionExists } from "./region-sync";

interface ConnectedRealmIndex {
  connected_realms: { href: string }[];
}

interface RealmDetail {
  id: number;
  region: { name: string; id: number };
  connected_realm: { href: string };
  name: string;
  category: string;
  locale: string;
  timezone: string;
  type: { type: string; name: string };
  is_tournament: boolean;
  slug: string;
}

interface ConnectedRealmDetail {
  id: number;
  population: { type: string; name: string };
  realms: RealmDetail[];
}

export async function syncConnectedRealms(regionId: string): Promise<void> {
  await ensureRegionExists(regionId);

  const api = BlizzardApi.getInstance();

  console.log(`[RealmSync] Fetching connected realms index for ${regionId}...`);
  const index = await api.get<ConnectedRealmIndex>(regionId, "/data/wow/connected-realm/index", "dynamic");

  const realmHrefs = index.connected_realms;
  console.log(`[RealmSync] Found ${realmHrefs.length} connected realms, fetching details...`);

  for (let i = 0; i < realmHrefs.length; i++) {
    const entry = realmHrefs[i];
    if (!entry) continue;
    const href = entry.href;
    // Extract connected realm ID from URL
    const idMatch = href.match(/connected-realm\/(\d+)/);
    if (!idMatch) continue;
    const crId = Number(idMatch[1]);

    const detail = await api.get<ConnectedRealmDetail>(regionId, `/data/wow/connected-realm/${crId}`, "dynamic");

    // Upsert connected realm
    await db
      .insert(connectedRealms)
      .values({ id: detail.id, regionId })
      .onConflictDoUpdate({
        target: [connectedRealms.id, connectedRealms.regionId],
        set: { id: detail.id },
      });

    // Upsert each realm within the connected realm
    for (const realm of detail.realms) {
      await db
        .insert(realms)
        .values({
          id: realm.id,
          regionId,
          connectedRealmId: detail.id,
          name: realm.name,
          slug: realm.slug,
          locale: realm.locale,
          timezone: realm.timezone,
          realmType: realm.type.type,
          population: detail.population.type,
        })
        .onConflictDoUpdate({
          target: [realms.id, realms.regionId],
          set: {
            connectedRealmId: detail.id,
            name: realm.name,
            slug: realm.slug,
            locale: realm.locale,
            timezone: realm.timezone,
            realmType: realm.type.type,
            population: detail.population.type,
          },
        });
    }

    if ((i + 1) % 10 === 0) {
      console.log(`[RealmSync] Progress: ${i + 1}/${realmHrefs.length} connected realms`);
    }
  }

  console.log(`[RealmSync] Completed syncing ${realmHrefs.length} connected realms for ${regionId}`);
}
