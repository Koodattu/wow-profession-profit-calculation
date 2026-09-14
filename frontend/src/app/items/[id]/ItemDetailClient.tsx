"use client";

import Link from "next/link";
import { useState } from "react";
import { formatPrice, type Item } from "@/lib/api";
import TimeRangeTabs from "@/app/TimeRangeTabs";
import HistoryLineChart from "@/app/HistoryLineChart";
import type { HistoryRange } from "@/lib/time-ranges";
import { useItemDetail } from "@/features/item-detail";

interface Props {
  item: Item;
}

export default function ItemDetailClient({ item }: Props) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const dailyHistory = range === "6m" || range === "1y" || range === "all";
  const usesRealmByDefault = item.marketType === "realm";
  const detail = useItemDetail(item, range);
  const { connectedRealmId, prices, realmPrices, realmPricesLoading } = detail;

  const latestPrice = prices.length > 0 ? prices[0] : null;
  const chartData = [...prices].reverse().map((point) => ({
    time: point.time,
    median: point.median_price,
    average: point.avg_price,
    min: point.min_price,
    quantity: point.total_quantity,
  }));

  return (
    <div className="w-full">
      <div className="mb-6">
        <Link href="/items" className="inline-flex h-10 items-center text-sm text-muted transition-colors hover:text-accent">
          &larr; Market
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
          {item.itemClass && <span>{item.itemClass}</span>}
          <span>ID: {item.id}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="lg:col-span-1">
          <div className="surface p-4 mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm text-muted">Price summary · {usesRealmByDefault ? "selected realm" : "EU"}</h2>
              <span className="text-sm text-muted" />
            </div>
            {detail.status === "selection-required" ? (
              <p className="text-muted">Select a realm to view this item.</p>
            ) : detail.status === "error" ? (
              <p className="text-muted">Couldn’t load price data. Try again in a moment.</p>
            ) : detail.status === "loading" ? (
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
            {latestPrice?.total_quantity != null && (
              <p className="text-sm text-muted mt-3 tabular-nums">
                {dailyHistory ? "Average units available" : "Units available"}: {latestPrice.total_quantity.toLocaleString()}
              </p>
            )}
          </div>

          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm text-muted">Price History</h2>
              <TimeRangeTabs value={range} onChange={setRange} />
            </div>
            <p className="mb-3 text-xs text-muted">
              Averages are weighted by available quantity. Longer ranges show daily summaries; daily medians are unavailable.
            </p>
            {chartData.length > 1 ? (
              <HistoryLineChart
                data={chartData}
                series={[
                  { key: "median", label: "Median", color: "var(--accent)" },
                  { key: "average", label: "Average", color: "#f59e0b" },
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
            <div className="surface p-4">
              <h2 className="text-sm text-muted mb-3">History · 24h</h2>
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
            <div className="surface p-4 mt-6">
              <h2 className="text-sm text-muted mb-1">Connected realms</h2>
              <p className="mb-3 text-xs text-muted">Variants are kept separate when Blizzard provides bonus or modifier data.</p>
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
                        <th className="py-2 pr-4 font-medium text-right">Listings</th>
                        <th className="py-2 font-medium text-right">Variants</th>
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
                               <td className="py-1 text-right text-muted">{realm.variant_count.toLocaleString()}</td>
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
      <p className="text-lg font-semibold tabular-nums">{value != null ? formatPrice(value) : "—"}</p>
    </div>
  );
}
