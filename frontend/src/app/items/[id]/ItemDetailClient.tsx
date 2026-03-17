"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { fetchItemPrices, fetchItemRealmPrices, formatPrice, type Item, type PricePoint, type RealmPrice } from "@/lib/api";
import { getSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";
import TimeRangeTabs from "@/app/TimeRangeTabs";
import HistoryLineChart from "@/app/HistoryLineChart";
import type { HistoryRange } from "@/lib/time-ranges";

interface Props {
  item: Item;
}

export default function ItemDetailClient({ item }: Props) {
  const connectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [realmPrices, setRealmPrices] = useState<RealmPrice[]>([]);
  const [range, setRange] = useState<HistoryRange>("24h");
  const [initialLoad, setInitialLoad] = useState(true);
  const [realmPricesLoading, setRealmPricesLoading] = useState(true);
  const hasLoadedDataRef = useRef(false);
  const [, startTransition] = useTransition();

  const usesRealmByDefault = item.isCraftedOutput && !item.isReagent;

  useEffect(() => {
    if (usesRealmByDefault && connectedRealmId === null) return;

    let cancelled = false;

    startTransition(async () => {
      try {
        const nextPrices = await fetchItemPrices(item.id, "eu", range, usesRealmByDefault ? { type: "realm", connectedRealmId: connectedRealmId ?? undefined } : { type: "auto" });
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
  }, [connectedRealmId, item.id, range, usesRealmByDefault]);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      setRealmPricesLoading(true);
      try {
        const nextRealmPrices = await fetchItemRealmPrices(item.id, "eu");
        if (!cancelled) {
          setRealmPrices(nextRealmPrices);
        }
      } catch {
        if (!cancelled) {
          setRealmPrices([]);
        }
      } finally {
        if (!cancelled) {
          setRealmPricesLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const latestPrice = prices.length > 0 ? prices[0] : null;
  const chartData = [...prices].reverse().map((point) => ({
    time: point.time,
    median: point.median_price,
    min: point.min_price,
    quantity: point.total_quantity,
  }));

  return (
    <div className="w-full">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="lg:col-span-1">
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

          <div className="border border-border rounded-lg bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm text-muted">Price History</h2>
              <TimeRangeTabs value={range} onChange={setRange} />
            </div>
            {chartData.length > 1 ? (
              <HistoryLineChart
                data={chartData}
                series={[
                  { key: "median", label: "Median", color: "var(--accent)" },
                  { key: "min", label: "Min", color: "var(--positive)" },
                  {
                    key: "quantity",
                    label: "Quantity",
                    color: "#3da3d4",
                    axis: "right",
                    type: "bar",
                    formatValue: (value) => Math.round(value).toLocaleString(),
                  },
                ]}
                formatValue={formatPrice}
              />
            ) : (
              <p className="text-muted">Not enough data points for chart</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          {prices.length > 1 && range === "24h" && (
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
                  {prices.slice(0, 24).map((point) => (
                    <tr key={point.time} className="border-b border-border/30">
                      <td className="py-1 text-muted">{new Date(point.time).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</td>
                      <td className="py-1 text-right">{point.min_price != null ? formatPrice(point.min_price) : "—"}</td>
                      <td className="py-1 text-right">{point.median_price != null ? formatPrice(point.median_price) : "—"}</td>
                      <td className="py-1 text-right text-muted">{point.total_quantity?.toLocaleString() ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {usesRealmByDefault && (
            <div className="border border-border rounded-lg bg-card p-4 mt-6">
              <h2 className="text-sm text-muted mb-3">All Realm Current Prices (EU)</h2>
              {realmPricesLoading ? (
                <p className="text-muted">Loading realm prices...</p>
              ) : realmPrices.length === 0 ? (
                <p className="text-muted">No realm price data available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted">
                        <th className="py-2 pr-4 font-medium">Realm</th>
                        <th className="py-2 pr-4 font-medium text-right">Min</th>
                        <th className="py-2 pr-4 font-medium text-right">Average</th>
                        <th className="py-2 pr-4 font-medium text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...realmPrices]
                        .sort((a, b) => b.min_buyout - a.min_buyout)
                        .map((realm) => {
                          const isSelected = connectedRealmId !== null && realm.realm_id === connectedRealmId;
                          return (
                            <tr key={realm.realm_id} className={`border-b border-border/30 ${isSelected ? "bg-accent/10" : ""}`}>
                              <td className={`py-1 ${isSelected ? "text-accent font-medium" : "text-foreground"}`}>
                                {realm.realm_name ?? `Realm ${realm.realm_id}`}
                                {isSelected ? " (Selected)" : ""}
                              </td>
                              <td className="py-1 text-right">{formatPrice(realm.min_buyout)}</td>
                              <td className="py-1 text-right">{formatPrice(realm.avg_buyout)}</td>
                              <td className="py-1 text-right text-muted">{realm.total_quantity.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
