import "./support/local-env";
import { sql } from "../src/db";

// Optional bounded visual fixtures after test:setup. Existing samples are preserved.
// Covers Silvermoon Health Potion and its materials; never fetches live auctions.
const commodities = [236761, 236767, 240990, 240991, 246447, 241304];
try {
  await sql.begin(async (tx) => {
    for (const itemId of [...commodities, 241305]) {
      const realm = itemId === 241305;
      const hourlyTable = realm ? "realm_snapshots" : "commodity_snapshots";
      const dailyTable = realm ? "realm_daily" : "commodity_daily";
      const lowKey = realm ? "min_buyout" : "min_price";
      const averageKey = realm ? "avg_buyout" : "avg_price";
      const medianKey = realm ? "median_buyout" : "median_price";
      const highKey = realm ? "max_buyout" : "max_price";
      for (const realmId of realm ? [1, 2] : [null]) {
        const scope = { region_id: "eu", item_id: itemId, ...(realmId ? { connected_realm_id: realmId } : {}) };
        const base = itemId === 241304 || realm ? 120000 * (realmId ?? 1) : 18000;
        // Leave a four-hour interruption and a few absent days visible on the timeline.
        for (let hoursAgo = 3; hoursAgo < 168; hoursAgo++) {
          if (hoursAgo >= 12 && hoursAgo <= 15) continue;
          const time = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - hoursAgo * 3_600_000).toISOString();
          const exists = await tx`SELECT 1 FROM ${tx(hourlyTable)} WHERE item_id = ${itemId}
            AND snapshot_time = ${time} ${realmId ? tx`AND connected_realm_id = ${realmId}` : tx``} LIMIT 1`;
          if (exists.length) continue;
          const low = Math.round(base * (1 + .25 * Math.sin(hoursAgo / 8)));
          const average = hoursAgo === 8 ? low * 60 : Math.round(low * 1.5);
          await tx`INSERT INTO ${tx(hourlyTable)} ${tx({ ...scope, snapshot_time: time,
            [lowKey]: low, [averageKey]: average, [medianKey]: hoursAgo % 11 === 0 ? null : Math.round(low * 1.2),
            [highKey]: average * 2, total_quantity: 40000 + hoursAgo * 500 })}`;
        }
        for (let daysAgo = 1; daysAgo <= 180; daysAgo++) {
          if (daysAgo >= 45 && daysAgo <= 50) continue;
          const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
          const low = daysAgo === 17 ? null : Math.round(base * (1 + .3 * Math.sin(daysAgo / 12)));
          const average = low === null ? null : low * 2;
          const quantity = low === null ? 0 : 50000 + daysAgo * 100;
          const samples = daysAgo % 7 === 0 ? 6 : 24;
          await tx`INSERT INTO ${tx(dailyTable)} ${tx({ ...scope, date: day,
            [lowKey]: low, [averageKey]: average, [highKey]: low === null ? null : low * 4,
            avg_quantity: quantity, sample_count: samples, observed_quantity: quantity * samples,
            total_value: average === null ? null : average * quantity * samples,
            average_is_exact: daysAgo <= 60 })} ON CONFLICT DO NOTHING`;
        }
      }
    }
  });
  console.log("Synthetic history ready: 7 items, up to 168 hourly and 180 daily observations per scope.");
} finally {
  await sql.end();
}
