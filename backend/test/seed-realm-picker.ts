import "./support/local-env";
import { sql } from "../src/db";

// Optional browser fixture: many markets, secondary names, accents and long
// connections. No external data or quotes; normal startup never loads these.
try {
  for (let id = 10_001; id <= 10_090; id++) {
    const names = id === 10_001 ? ["Dentarg (Test)", "Tarren Mill (Test)"]
      : id === 10_002 ? ["Confrérie du Thorium (Test)", "Conseil des Ombres (Test)", "Culte de la Rive noire (Test)", "Kirin Tor (Test)", "La Croisade écarlate (Test)", "Les Clairvoyants (Test)", "Les Sentinelles (Test)"]
        : [`Synthetic Realm ${id}`, `Synthetic Partner ${id}`];
    await sql`INSERT INTO connected_realms (id, region_id) VALUES (${id}, 'eu') ON CONFLICT DO NOTHING`;
    for (const [index, name] of names.entries()) {
      await sql`INSERT INTO realms (id, region_id, connected_realm_id, name, slug)
        VALUES (${id * 10 + index}, 'eu', ${id}, ${name}, ${`synthetic-${id}-${index}`}) ON CONFLICT DO NOTHING`;
    }
  }
  console.log("Added 90 synthetic connected markets for realm-picker browser checks.");
} finally {
  await sql.end();
}
