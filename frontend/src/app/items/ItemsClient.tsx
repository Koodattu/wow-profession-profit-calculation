"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import WowheadLink from "@/app/WowheadLink";
import { formatPrice, type ItemWithPrice } from "@/lib/api";
import { getItemQualityClass } from "@/lib/item-quality";
import { useItemBrowser } from "@/features/item-browser";

const FILTERS = ["all", "commodity", "realm"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = { all: "All", commodity: "Commodities", realm: "Realm items" };
const PAGE_SIZE = 50;

export default function ItemsClient({ initialSearch = "" }: { initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const request = useMemo(
    () => ({
      type: filter === "all" ? undefined : filter,
      search: debouncedSearch || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, filter, page],
  );
  const market = useItemBrowser(request);
  const data = market.data;
  const loading = market.status === "loading";

  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">Europe · Retail</p>
        <h1 className="text-3xl font-semibold tracking-tight">Market</h1>
        <p className="mt-2 text-sm text-muted">Current auction prices and available quantity.</p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search items</span>
          <input
            type="search"
            placeholder="Search items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-[border-color,background-color] duration-150 ease-out placeholder:text-muted focus:border-accent focus:bg-card-hover"
          />
        </label>
        <div className="flex gap-1 rounded-xl bg-card p-1 shadow-[var(--shadow-surface)]" aria-label="Market type">
          {FILTERS.map((current) => (
            <button
              key={current}
              type="button"
              onClick={() => {
                setFilter(current);
                setPage(1);
              }}
              className={`h-9 rounded-lg px-3 text-sm transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] ${
                filter === current ? "bg-foreground text-background" : "text-muted hover:bg-card-hover hover:text-foreground"
              }`}
            >
              {FILTER_LABELS[current]}
            </button>
          ))}
        </div>
      </div>

      {market.status === "selection-required" ? (
        <StateMessage>Select a realm to browse current market prices.</StateMessage>
      ) : market.status === "error" ? (
        <StateMessage>Couldn’t load the market. Try again in a moment.</StateMessage>
      ) : loading && !data ? (
        <StateMessage>Loading market…</StateMessage>
      ) : !data || data.items.length === 0 ? (
        <StateMessage>No matching items.</StateMessage>
      ) : (
        <>
          <div className={`surface overflow-hidden transition-opacity duration-150 ease-out ${loading ? "opacity-60" : "opacity-100"}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted">
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Market</th>
                    <th className="px-4 py-3 text-right font-medium">Current</th>
                    <th className="px-4 py-3 text-right font-medium">Available</th>
                    <th className="px-4 py-3 text-right font-medium">EU realm avg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1}
              className="h-10 rounded-lg bg-card px-4 text-sm text-muted shadow-[var(--shadow-surface)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-card-hover hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm tabular-nums text-muted">
              {data.page} / {Math.max(1, data.totalPages)} · {data.total.toLocaleString()} items
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))}
              disabled={page >= data.totalPages}
              className="h-10 rounded-lg bg-card px-4 text-sm text-muted shadow-[var(--shadow-surface)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-card-hover hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: ItemWithPrice }) {
  const quantity = item.latestPrice?.totalQuantity;
  const isRealm = item.marketType === "realm";

  return (
    <tr className="border-b border-border/70 last:border-0 hover:bg-card-hover">
      <td className="px-4 py-3">
        <WowheadLink href={`/items/${item.id}`} type="item" id={item.id} className={`${getItemQualityClass(item.itemQuality)} hover:underline`}>
          {item.name}
        </WowheadLink>
        {item.qualityRank && <span className="ml-2 text-xs text-muted">R{item.qualityRank}</span>}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-md px-2 py-1 text-xs ${isRealm ? "bg-amber-400/10 text-amber-300" : "bg-positive/10 text-positive"}`}>
          {isRealm ? "Realm" : item.marketType === "commodity" ? "EU" : "—"}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">{item.latestPrice ? formatPrice(item.latestPrice.minPrice) : "Not listed"}</td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">
        {quantity == null ? "—" : `${quantity.toLocaleString()}${isRealm ? " listings" : " units"}`}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">
        {isRealm && item.regionLatestPrice ? formatPrice(item.regionLatestPrice.avgPrice) : "—"}
      </td>
    </tr>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div className="surface py-16 text-center text-sm text-muted">{children}</div>;
}
