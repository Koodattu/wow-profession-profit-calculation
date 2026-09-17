import { and, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { db } from "../db";
import { commodityLatest, marketObservations, realmLatest } from "../db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CurrentTable = typeof commodityLatest | typeof realmLatest;

// Staging is transaction-local and unlogged. Only changed market content reaches
// the persistent tables; freshness advances even when every listing is unchanged.
export async function writeCurrentMarket(
  tx: Transaction,
  table: CurrentTable,
  rows: (typeof commodityLatest.$inferInsert | typeof realmLatest.$inferInsert)[],
  regionId: string,
  connectedRealmId: number,
  syncRunId: number,
  observedAt: Date,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`current-market:${regionId}:${connectedRealmId}`}, 0))`);
  const [previous] = await tx.select({ observedAt: marketObservations.observedAt }).from(marketObservations)
    .where(and(eq(marketObservations.regionId, regionId), eq(marketObservations.connectedRealmId, connectedRealmId)));
  if (previous && previous.observedAt > observedAt) throw new Error("A newer auction observation is already published");
  const name = getTableName(table);
  const stage = sql.identifier(`incoming_${name}`);
  const columns = Object.entries(getTableColumns(table));
  const keys = table === realmLatest ? ["region_id", "connected_realm_id", "item_id", "variant_key"] : ["region_id", "item_id"];
  const values = columns.map(([, column]) => column.name).filter((column) => !keys.includes(column));
  const content = values.filter((column) => column !== "sync_run_id" && column !== "observed_at");
  const field = (alias: string, column: string) => sql`${sql.identifier(alias)}.${sql.identifier(column)}`;
  const match = sql.join(keys.map((column) => sql`${field("current", column)} = ${field("incoming", column)}`), sql` AND `);
  const scope = table === realmLatest
    ? sql`current.region_id = ${regionId} AND current.connected_realm_id = ${connectedRealmId}`
    : sql`current.region_id = ${regionId}`;

  await tx.execute(sql`CREATE TEMP TABLE ${stage} (LIKE ${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
  for (let offset = 0; offset < rows.length; offset += 500) {
    const payload = rows.slice(offset, offset + 500).map((row) => {
      const record = row as unknown as Record<string, unknown>;
      return Object.fromEntries(columns.map(([property, column]) => [column.name, record[property] ?? null]));
    });
    await tx.execute(sql`INSERT INTO ${stage} SELECT * FROM jsonb_populate_recordset(NULL::${table}, ${JSON.stringify(payload)}::jsonb)`);
  }
  await tx.execute(sql`CREATE UNIQUE INDEX ON ${stage} (${sql.join(keys.map((column) => sql.identifier(column)), sql`, `)})`);
  await tx.execute(sql`ANALYZE ${stage}`);
  await tx.execute(sql`
    UPDATE ${table} AS current SET
      ${sql.join(values.map((column) => sql`${sql.identifier(column)} = ${field("incoming", column)}`), sql`, `)}
    FROM ${stage} AS incoming
    WHERE ${scope} AND ${match}
      AND ROW(${sql.join(content.map((column) => field("current", column)), sql`, `)})
          IS DISTINCT FROM ROW(${sql.join(content.map((column) => field("incoming", column)), sql`, `)})
  `);
  await tx.execute(sql`
    INSERT INTO ${table} SELECT incoming.* FROM ${stage} AS incoming
    WHERE NOT EXISTS (SELECT 1 FROM ${table} AS current WHERE ${scope} AND ${match})
  `);
  await tx.execute(sql`
    DELETE FROM ${table} AS current WHERE ${scope}
      AND NOT EXISTS (SELECT 1 FROM ${stage} AS incoming WHERE ${match})
  `);
  await tx.insert(marketObservations).values({ regionId, connectedRealmId, syncRunId, observedAt })
    .onConflictDoUpdate({ target: [marketObservations.regionId, marketObservations.connectedRealmId], set: { syncRunId, observedAt } });
}
