import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { connectedRealms, realms } from "../db/schema";

const realmRoutes = new Hono();

// ─── GET / — List all realms grouped by connected realm ─────────────

realmRoutes.get("/", async (c) => {
  const region = c.req.query("region") || "eu";

  try {
    const crRows = await db.select({ id: connectedRealms.id }).from(connectedRealms).where(eq(connectedRealms.regionId, region));

    const realmRows = await db.select().from(realms).where(eq(realms.regionId, region));

    const realmsByGroup = new Map<number, typeof realmRows>();
    for (const realm of realmRows) {
      const group = realmsByGroup.get(realm.connectedRealmId) ?? [];
      group.push(realm);
      realmsByGroup.set(realm.connectedRealmId, group);
    }
    const grouped = crRows.map((cr) => ({ connected_realm_id: cr.id, realms: realmsByGroup.get(cr.id) ?? [] }));

    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return c.json(grouped);
  } catch (err) {
    console.error("[Realms] Error listing realms:", err);
    return c.json({ error: "Failed to fetch realms" }, 500);
  }
});

export default realmRoutes;
