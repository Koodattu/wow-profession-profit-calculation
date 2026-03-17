"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { fetchItemPrices, formatPrice, type Item, type PricePoint } from "@/lib/api";
import { getSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";

interface Props {
  item: Item;
}

export default function ItemDetailClient({ item }: Props) {
  const connectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const hasLoadedDataRef = useRef(false);
  const [, startTransition] = useTransition();

  const usesRealmByDefault = item.isCraftedOutput && !item.isReagent;

  useEffect(() => {
    if (usesRealmByDefault && connectedRealmId === null) return;

    let cancelled = false;

    startTransition(async () => {
      try {
        const nextPrices = await fetchItemPrices(item.id, "eu", "24h", usesRealmByDefault ? { type: "realm", connectedRealmId: connectedRealmId ?? undefined } : { type: "auto" });
        if (!cancelled) {
          setPrices(nextPrices);
          hasLoadedDataRef.current = true;
        }
      } catch {
        if (!cancelled && !hasLoadedDataRef.current) setPrices([]);
      } finally {
        if (!cancelled) setInitialLoad(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [connectedRealmId, item.id, usesRealmByDefault]);

  const latestPrice = prices.length > 0 ? prices[0] : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent transition-colors">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          <a href={`https://www.wowhead.com/item=${item.id}`} data-wowhead={`item=${item.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {item.name}
          </a>
        </h1>
        <div className="flex gap-3 text-sm text-muted mt-1">
          {item.qualityRank && <span>Rank {item.qualityRank}</span>}
          {item.isReagent && <span>Reagent</span>}
          {item.isCraftedOutput && <span>Crafted</span>}
          <span>ID: {item.id}</span>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card p-4 mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm text-muted">Current Price (EU)</h2>
          <span className="text-sm text-muted" />
        </div>
        {initialLoad ? (
          <p className="text-muted">Loading price data...</p>
        ) : latestPrice ? (
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
              {prices.slice(0, 24).map((point, index) => (
                <tr key={index} className="border-b border-border/30">
                  <td className="py-1 text-muted">{new Date(point.time).toLocaleTimeString()}</td>
                  <td className="py-1 text-right">{point.min_price != null ? formatPrice(point.min_price) : "—"}</td>
                  <td className="py-1 text-right">{point.median_price != null ? formatPrice(point.median_price) : "—"}</td>
                  <td className="py-1 text-right text-muted">{point.total_quantity?.toLocaleString() ?? "—"}</td>
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
