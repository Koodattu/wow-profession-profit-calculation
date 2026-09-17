import { afterAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db, sql as connection } from "../src/db";
import { BlizzardHttpError, type BlizzardClient } from "../src/services/blizzard-client";
import { syncPendingItemMetadata } from "../src/services/item-metadata-sync";

const item = 2_100_003_000;
afterAll(async () => { await connection.end(); });

test("404s retain metadata and retry weekly; transient failures retry hourly and both can recover", async () => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE TEMP TABLE items (LIKE public.items INCLUDING ALL) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO items(id,name,metadata_status) VALUES (${item},'Known item name','pending'),(${item + 1},'Temporary failure','pending'),(${item + 2},'Auth failure','pending')`);
    let now = new Date("2026-09-10T12:00:00Z");
    let recover = false;
    const requested: number[] = [];
    const client: Pick<BlizzardClient, "get"> = { async get<T>(_region: string, endpoint: string) {
      const id = Number(endpoint.split("/").pop());
      requested.push(id);
      if (!recover) throw new BlizzardHttpError(id === item ? 404 : id === item + 1 ? 503 : 401, `GET ${endpoint}`, "Fixture error");
      return { id, name: `Recovered ${id}`, quality: { type: "EPIC" } } as T;
    } };
    const run = () => syncPendingItemMetadata("eu", { client, now: () => now, store: tx });
    expect(await run()).toMatchObject({ attempted: 3, unavailable: 1, failed: 2 });
    expect([...await tx.execute(sql`SELECT name,metadata_status FROM items WHERE id=${item}`)]).toEqual([{ name: "Known item name", metadata_status: "unavailable" }]);
    requested.length = 0;
    now = new Date("2026-09-10T12:30:00Z");
    expect((await run()).attempted).toBe(0);
    recover = true;
    now = new Date("2026-09-10T13:01:00Z");
    expect(await run()).toMatchObject({ attempted: 2, succeeded: 2 });
    expect(requested).not.toContain(item);
    now = new Date("2026-09-17T12:01:00Z");
    expect(await run()).toMatchObject({ attempted: 1, succeeded: 1 });
    expect([...await tx.execute(sql`SELECT name,metadata_status,item_quality FROM items WHERE id=${item}`)]).toEqual([{ name: `Recovered ${item}`, metadata_status: "complete", item_quality: 4 }]);
  });
});
