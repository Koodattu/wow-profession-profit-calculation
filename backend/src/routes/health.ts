import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { ACTIVE_REGIONS } from "../config/regions";
import { env } from "../config/env";
import { db } from "../db";
import { professions, syncJobs } from "../db/schema";
import { getRegionPriceFreshness } from "../services/price-freshness";

const health = new Hono();

health.get("/", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

health.get("/ready", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    const [catalog] = await db.select({ count: sql<number>`count(*)::int` }).from(professions);
    const jobs = await db.select().from(syncJobs).orderBy(syncJobs.name);
    const prices = Object.fromEntries(
      await Promise.all(
        ACTIVE_REGIONS.map(async (regionId) => [
          regionId,
          await getRegionPriceFreshness(regionId, env.PRICE_READINESS_MAX_AGE_MINUTES),
        ] as const),
      ),
    );

    const ready = (catalog?.count ?? 0) > 0;
    const payload = {
      status: ready ? "ready" : "not_ready",
      database: "ok",
      catalogLoaded: ready,
      prices,
      jobs,
      timestamp: new Date().toISOString(),
    };

    if (!ready) return c.json(payload, 503);
    return c.json(payload);
  } catch (error) {
    console.error("[Health] Readiness check failed:", error);
    return c.json(
      {
        status: "not_ready",
        database: "unavailable",
        catalogLoaded: false,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
});

export default health;
