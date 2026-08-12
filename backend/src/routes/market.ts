import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { items, realms } from "../db/schema";
import { getMarketStatus } from "../services/market-refresh-cycle";

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

    const marketStatus = await getMarketStatus(region);
    const realmDates = marketStatus.realms.flatMap((scope) => (scope.latestAt ? [scope.latestAt] : []));

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
      commodityObservedAt: marketStatus.commodity.latestAt,
      realmOldestObservedAt: realmDates.length > 0 ? new Date(Math.min(...realmDates.map((date) => date.getTime()))) : null,
      realmNewestObservedAt: realmDates.length > 0 ? new Date(Math.max(...realmDates.map((date) => date.getTime()))) : null,
      connectedRealmCount: marketStatus.realms.length,
      marketStatus,
      selectedRealm,
    });
  } catch (error) {
    console.error("[Market] Failed to build summary:", error);
    return c.json({ error: "Failed to load market summary" }, 500);
  }
});

export default marketRoutes;
