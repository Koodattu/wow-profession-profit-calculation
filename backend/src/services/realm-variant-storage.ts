import { getTableColumns, sql } from "drizzle-orm";
import type { db } from "../db";
import { realmLatest, realmVariants, type RealmListing, type StoredRealmListing } from "../db/schema";
import type { NormalizedRealmVariant } from "./auction-aggregation";

export type RealmMarketInput = Omit<typeof realmLatest.$inferInsert, "variantId" | "listings"> &
  Omit<NormalizedRealmVariant, "key"> & { variantKey: string; listings: RealmListing[] | null };

export function unpackRealmListings(listings: StoredRealmListing[]): RealmListing[] {
  return listings.map(([id, buyout, quantity, bid, timeLeft]) => ({ id, buyout, quantity, bid, timeLeft }));
}

export async function storeRealmVariants(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0], rows: RealmMarketInput[],
): Promise<(typeof realmLatest.$inferInsert)[]> {
  const columns = Object.entries(getTableColumns(realmVariants)).filter(([property]) => property !== "id");
  const definitions = [...new Map(rows.map((row) => [row.variantKey, row])).values()];
  await tx.execute(sql`CREATE TEMP TABLE incoming_realm_variants (LIKE realm_variants) ON COMMIT DROP`);
  await tx.execute(sql`ALTER TABLE incoming_realm_variants ALTER COLUMN id DROP NOT NULL`);
  for (let offset = 0; offset < definitions.length; offset += 500) {
    const payload = definitions.slice(offset, offset + 500).map((row) => Object.fromEntries(
      columns.map(([property, column]) => [column.name, row[property as keyof RealmMarketInput]]),
    ));
    // The stage has no sequence default: existing identities never consume IDs.
    await tx.execute(sql`INSERT INTO incoming_realm_variants SELECT * FROM jsonb_populate_recordset(NULL::realm_variants, ${JSON.stringify(payload)}::jsonb)`);
  }
  await tx.execute(sql`CREATE UNIQUE INDEX ON incoming_realm_variants (variant_key)`);
  await tx.execute(sql`ANALYZE incoming_realm_variants`);
  const names = sql.join(columns.map(([, column]) => sql.identifier(column.name)), sql`, `);
  await tx.execute(sql`
    INSERT INTO realm_variants (${names}) SELECT ${names} FROM incoming_realm_variants i
    WHERE NOT EXISTS (SELECT 1 FROM realm_variants v WHERE v.variant_key = i.variant_key)
    ORDER BY variant_key ON CONFLICT (variant_key) DO NOTHING
  `);
  const content = columns.filter(([property]) => property !== "variantKey");
  const differing = await tx.execute(sql`
    SELECT i.variant_key FROM incoming_realm_variants i JOIN realm_variants v USING (variant_key)
    WHERE ROW(${sql.join(content.map(([, c]) => sql`i.${sql.identifier(c.name)}`), sql`, `)})
      IS DISTINCT FROM ROW(${sql.join(content.map(([, c]) => sql`v.${sql.identifier(c.name)}`), sql`, `)}) LIMIT 1
  `);
  if (differing.length) throw new Error("Conflicting realm variant definition");
  const identities = await tx.execute(sql`SELECT v.id, v.variant_key FROM realm_variants v JOIN incoming_realm_variants i USING (variant_key)`);
  const ids = new Map(identities.map((row) => [String(row.variant_key), Number(row.id)]));
  return rows.map((row) => ({ ...row, variantId: ids.get(row.variantKey)!,
    listings: row.listings?.map((l): StoredRealmListing => [l.id, l.buyout, l.quantity, l.bid, l.timeLeft]) ?? null }));
}
