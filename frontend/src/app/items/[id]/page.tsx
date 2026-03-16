import Link from "next/link";
import { fetchItem, fetchItemPrices, formatPrice } from "@/lib/api";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);

  const [item, prices] = await Promise.all([fetchItem(itemId), fetchItemPrices(itemId, "eu", "24h")]);

  const latestPrice = prices.length > 0 ? prices[0] : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">{item.name}</h1>
        <div className="flex gap-3 text-sm text-muted mt-1">
          {item.qualityRank && <span>Rank {item.qualityRank}</span>}
          {item.isReagent && <span>Reagent</span>}
          {item.isCraftedOutput && <span>Crafted</span>}
          <span>ID: {item.id}</span>
        </div>
      </div>

      {/* Current Price */}
      <div className="border border-border rounded-lg bg-card p-4 mb-6">
        <h2 className="text-sm text-muted mb-3">Current Price (EU)</h2>
        {latestPrice ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <PriceStat label="Min" value={latestPrice.min_price} />
            <PriceStat label="Median" value={latestPrice.median_price} />
            <PriceStat label="Average" value={latestPrice.avg_price} />
            <PriceStat label="Max" value={latestPrice.max_price} />
          </div>
        ) : (
          <p className="text-muted">No price data available</p>
        )}
        {latestPrice?.total_quantity != null && <p className="text-sm text-muted mt-3">Total quantity on AH: {latestPrice.total_quantity.toLocaleString()}</p>}
      </div>

      {/* Price History */}
      {prices.length > 1 && (
        <div className="border border-border rounded-lg bg-card p-4">
          <h2 className="text-sm text-muted mb-3">Price History (last 24h)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium text-right">Min</th>
                <th className="py-2 pr-4 font-medium text-right">Median</th>
                <th className="py-2 pr-4 font-medium text-right">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {prices.slice(0, 24).map((p, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-1 text-muted">{new Date(p.time).toLocaleTimeString()}</td>
                  <td className="py-1 text-right">{p.min_price != null ? formatPrice(p.min_price) : "—"}</td>
                  <td className="py-1 text-right">{p.median_price != null ? formatPrice(p.median_price) : "—"}</td>
                  <td className="py-1 text-right text-muted">{p.total_quantity?.toLocaleString() ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PriceStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold">{value != null ? formatPrice(value) : "—"}</p>
    </div>
  );
}
