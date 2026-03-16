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

    const grouped = crRows.map((cr) => ({
      connected_realm_id: cr.id,
      realms: realmRows.filter((r) => r.connectedRealmId === cr.id),
    }));

    return c.json(grouped);
  } catch (err) {
    console.error("[Realms] Error listing realms:", err);
    return c.json({ error: "Failed to fetch realms" }, 500);
  }
});

export default realmRoutes;
