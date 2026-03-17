"use client";

import { useState, useEffect, useRef, useTransition, useSyncExternalStore, useCallback } from "react";
import WowheadLink from "@/app/WowheadLink";
import { fetchItems, formatPrice, type ItemWithPrice, type ItemListResponse } from "@/lib/api";
import { getItemQualityClass } from "@/lib/item-quality";
import { getSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";

const TYPE_FILTERS = ["all", "commodity", "gear"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "All",
  commodity: "Commodities",
  gear: "Gear",
};

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000] as const;
const DEFAULT_PAGE_SIZE = 1000;

export default function ItemsClient() {
  const getRealmSnapshot = useCallback(() => getSelectedConnectedRealmId(), []);
  const connectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getRealmSnapshot, () => null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItemListResponse | null>(null);
  const [isPending, startTransition] = useTransition();
  const [initialLoad, setInitialLoad] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const result = await fetchItems({
          region: "eu",
          type: typeFilter === "all" ? undefined : typeFilter,
          search: debouncedSearch || undefined,
          page,
          limit: pageSize,
          connectedRealmId: connectedRealmId ?? undefined,
        });
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setInitialLoad(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [connectedRealmId, debouncedSearch, typeFilter, page, pageSize]);

  const loading = initialLoad || isPending;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Items</h1>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 rounded-md bg-card border border-border text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
        />
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="px-3 py-2 rounded-md bg-card border border-border text-foreground focus:outline-none focus:border-accent"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTypeFilter(t);
                setPage(1);
              }}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                typeFilter === t ? "bg-accent text-background" : "bg-card border border-border text-muted hover:text-foreground hover:bg-card-hover"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-muted py-8 text-center">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-muted py-8 text-center">No items found</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 font-medium">Rank</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium text-right">Realm Avg</th>
                  <th className="py-2 pr-4 font-medium text-right">Region Avg</th>
                  <th className="py-2 pr-4 font-medium text-right">Min</th>
                  <th className="py-2 pr-4 font-medium text-right">Avg</th>
                  <th className="py-2 pr-4 font-medium text-right">Median</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-md text-sm bg-card border border-border text-muted hover:text-foreground hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                &larr; Previous
              </button>
              <span className="text-sm text-muted">
                Page {data.page} of {data.totalPages} ({data.total} items)
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
                className="px-3 py-1.5 rounded-md text-sm bg-card border border-border text-muted hover:text-foreground hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next &rarr;
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: ItemWithPrice }) {
  return (
    <tr className="border-b border-border/50 hover:bg-card-hover transition-colors">
      <td className="py-2 pr-4">
        <WowheadLink href={`/items/${item.id}`} type="item" id={item.id} className={`${getItemQualityClass(item.itemQuality)} hover:underline`}>
          {item.name || <span className="text-muted italic">Unknown item #{item.id}</span>}
        </WowheadLink>
      </td>
      <td className="py-2 pr-4 text-muted">{item.qualityRank ? `R${item.qualityRank}` : "—"}</td>
      <td className="py-2 pr-4">
        <span className="flex gap-1.5">
          {item.isReagent && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">Reagent</span>}
          {item.isCraftedOutput && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">Crafted</span>}
          {!item.isReagent && !item.isCraftedOutput && <span className="text-muted">—</span>}
        </span>
      </td>
      <td className="py-2 pr-4">
        {item.priceSource === "commodity" && <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Commodity</span>}
        {item.priceSource === "realm" && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Realm</span>}
        {!item.priceSource && <span className="text-muted">—</span>}
      </td>
      <td className="py-2 pr-4 text-right">{item.realmLatestPrice ? formatPrice(item.realmLatestPrice.avgPrice) : "—"}</td>
      <td className="py-2 pr-4 text-right">{item.regionLatestPrice ? formatPrice(item.regionLatestPrice.avgPrice) : "—"}</td>
      <td className="py-2 pr-4 text-right">{item.latestPrice ? formatPrice(item.latestPrice.minPrice) : "—"}</td>
      <td className="py-2 pr-4 text-right">{item.latestPrice ? formatPrice(item.latestPrice.avgPrice) : "—"}</td>
      <td className="py-2 pr-4 text-right">{item.latestPrice ? formatPrice(item.latestPrice.medianPrice) : "—"}</td>
    </tr>
  );
}
