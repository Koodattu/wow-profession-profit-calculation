import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auctionSyncRuns, items, realms } from "../db/schema";

const marketRoutes = new Hono();

marketRoutes.get("/summary", async (c) => {
  const region = c.req.query("region") || "eu";
  if (region !== "eu") return c.json({ error: "Only the EU region is available" }, 400);

  const connectedRealmIdValue = c.req.query("connectedRealmId");
  const connectedRealmId = connectedRealmIdValue ? Number(connectedRealmIdValue) : undefined;
  if (connectedRealmIdValue && (!Number.isInteger(connectedRealmId) || connectedRealmId! <= 0)) {
    return c.json({ error: "Invalid connected realm ID" }, 400);
  }

  try {
    const [counts] = await db
      .select({
        total: sql<number>`count(*) filter (where ${items.marketType} is not null)::int`,
        commodities: sql<number>`count(*) filter (where ${items.marketType} = 'commodity')::int`,
        realmItems: sql<number>`count(*) filter (where ${items.marketType} = 'realm')::int`,
        pendingMetadata: sql<number>`count(*) filter (where ${items.metadataStatus} = 'pending')::int`,
      })
      .from(items);

    const [commodity] = await db
      .select({ observedAt: sql<Date | null>`max(${auctionSyncRuns.observedAt})` })
      .from(auctionSyncRuns)
      .where(and(eq(auctionSyncRuns.regionId, region), eq(auctionSyncRuns.scope, "commodity"), eq(auctionSyncRuns.status, "succeeded")));

    const realmFreshness = await db.execute(sql`
      SELECT
        min(observed_at) AS oldest_observed_at,
        max(observed_at) AS newest_observed_at,
        count(*)::int AS realm_count
      FROM (
        SELECT connected_realm_id, max(observed_at) AS observed_at
        FROM auction_sync_runs
        WHERE region_id = ${region}
          AND scope = 'realm'
          AND status = 'succeeded'
        GROUP BY connected_realm_id
      ) latest_realm_runs
    `);
    const freshnessRow = Array.from(realmFreshness as Iterable<Record<string, unknown>>)[0];

    let selectedRealm: { id: number; name: string } | null = null;
    if (connectedRealmId !== undefined) {
      const names = await db
        .select({ name: realms.name })
        .from(realms)
        .where(and(eq(realms.regionId, region), eq(realms.connectedRealmId, connectedRealmId)))
        .orderBy(realms.name);
      if (names.length > 0) selectedRealm = { id: connectedRealmId, name: names.map((row) => row.name).join(" / ") };
    }

    c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    return c.json({
      region,
      itemCount: counts?.total ?? 0,
      commodityCount: counts?.commodities ?? 0,
      realmItemCount: counts?.realmItems ?? 0,
      pendingMetadataCount: counts?.pendingMetadata ?? 0,
      commodityObservedAt: commodity?.observedAt ?? null,
      realmOldestObservedAt: (freshnessRow?.oldest_observed_at as Date | null) ?? null,
      realmNewestObservedAt: (freshnessRow?.newest_observed_at as Date | null) ?? null,
      connectedRealmCount: Number(freshnessRow?.realm_count ?? 0),
      selectedRealm,
    });
  } catch (error) {
    console.error("[Market] Failed to build summary:", error);
    return c.json({ error: "Failed to load market summary" }, 500);
  }
});

export default marketRoutes;
