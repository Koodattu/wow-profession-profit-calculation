"use client";

import { useState, useEffect, useTransition } from "react";
import WowheadLink from "@/app/WowheadLink";
import { fetchFlippingOpportunities, formatPrice, type FlippingOpportunity } from "@/lib/api";
import { getItemQualityClass } from "@/lib/item-quality";

const LIMIT_OPTIONS = [25, 50, 100] as const;

export default function FlippingClient() {
  const [minSpreadGold, setMinSpreadGold] = useState(0);
  const [limit, setLimit] = useState<number>(25);
  const [data, setData] = useState<FlippingOpportunity[]>([]);
  const [isPending, startTransition] = useTransition();
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const minSpreadCopper = minSpreadGold > 0 ? minSpreadGold * 10000 : undefined;
        const result = await fetchFlippingOpportunities("eu", minSpreadCopper, limit);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setInitialLoad(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [minSpreadGold, limit]);

  const loading = initialLoad || isPending;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Flipping Tool</h1>
      <p className="text-muted mb-6">Find crafted items with large price differences across realms</p>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label htmlFor="minSpread" className="text-sm text-muted whitespace-nowrap">
            Min spread
          </label>
          <div className="relative">
            <input
              id="minSpread"
              type="number"
              min={0}
              value={minSpreadGold}
              onChange={(e) => setMinSpreadGold(Math.max(0, Number(e.target.value)))}
              className="w-28 px-3 py-2 pr-8 rounded-md bg-card border border-border text-foreground placeholder:text-muted focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">g</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="limit" className="text-sm text-muted">
            Show
          </label>
          <select
            id="limit"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-3 py-2 rounded-md bg-card border border-border text-foreground focus:outline-none focus:border-accent"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-muted py-8 text-center">Loading…</p>
      ) : data.length === 0 ? (
        <p className="text-muted py-8 text-center">No flipping opportunities found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Rank</th>
                <th className="py-2 pr-4 font-medium text-right">Region Avg</th>
                <th className="py-2 pr-4 font-medium">Cheapest Realm</th>
                <th className="py-2 pr-4 font-medium">Most Expensive Realm</th>
                <th className="py-2 pr-4 font-medium text-right">Spread</th>
                <th className="py-2 pr-4 font-medium text-right">Spread %</th>
                <th className="py-2 pr-4 font-medium text-right">Realms</th>
              </tr>
            </thead>
            <tbody>
              {data.map((opp) => (
                <FlipRow key={`${opp.itemId}-${opp.qualityRank ?? 0}`} opp={opp} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FlipRow({ opp }: { opp: FlippingOpportunity }) {
  return (
    <tr className="border-b border-border/50 hover:bg-card-hover transition-colors">
      <td className="py-2 pr-4">
        <WowheadLink href={`/items/${opp.itemId}`} type="item" id={opp.itemId} className={`${getItemQualityClass(opp.qualityRank)} hover:underline`}>
          {opp.itemName}
        </WowheadLink>
      </td>
      <td className="py-2 pr-4 text-muted">{opp.qualityRank ? `R${opp.qualityRank}` : "—"}</td>
      <td className="py-2 pr-4 text-right">{formatPrice(opp.regionAvgPrice)}</td>
      <td className="py-2 pr-4">
        <span className="text-muted">{opp.cheapestRealm.realmName}</span> <span className="text-positive">{formatPrice(opp.cheapestRealm.minBuyout)}</span>
      </td>
      <td className="py-2 pr-4">
        <span className="text-muted">{opp.mostExpensiveRealm.realmName}</span> <span className="text-amber-400">{formatPrice(opp.mostExpensiveRealm.minBuyout)}</span>
      </td>
      <td className="py-2 pr-4 text-right">{formatPrice(opp.spread)}</td>
      <td className={`py-2 pr-4 text-right ${opp.spreadPercent > 100 ? "text-positive" : ""}`}>{opp.spreadPercent.toFixed(1)}%</td>
      <td className="py-2 pr-4 text-right text-muted">{opp.realmCount}</td>
    </tr>
  );
}
