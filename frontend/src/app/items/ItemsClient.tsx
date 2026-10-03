"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import WowheadLink from "@/app/WowheadLink";
import { formatPrice, type ItemWithPrice } from "@/lib/api";
import { getItemQualityClass } from "@/lib/item-quality";
import { useItemBrowser } from "@/features/item-browser";
import { FILTER_KEYS, readMarketFilters } from "@/lib/market-filters";
import { useLinkedHistoryRealm } from "@/lib/history-view";
import MarketFilters from "./MarketFilters";
import styles from "./Items.module.css";

const FILTERS = ["all", "commodity", "realm"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = { all: "All", commodity: "Commodities", realm: "Realm items" };
const PAGE_SIZE = 50;

function writeLocation(changes: Record<string, string | null>, replace = false) {
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  window.history[replace ? "replaceState" : "pushState"](null, "", `/items${next.size ? `?${next}` : ""}`);
}

export default function ItemsClient() {
  const params = useSearchParams();
  const query = params.toString();
  const parsed = useMemo(() => readMarketFilters(new URLSearchParams(query)), [query]);
  const committedSearch = (params.get("search") ?? "").slice(0, 100);
  const filter: Filter = params.get("type") === "commodity" ? "commodity" : params.get("type") === "realm" ? "realm" : "all";
  const linkedRealm = useLinkedHistoryRealm(filter !== "commodity");
  const requestedPage = Number(params.get("page") ?? 1);
  const page = Number.isInteger(requestedPage) ? Math.min(5_000, Math.max(1, requestedPage)) : 1;
  const [draft, setDraft] = useState<{ source: string; value: string } | null>(null);
  const search = draft?.source === committedSearch ? draft.value : committedSearch;
  const marketHref = `/items${params.size ? `?${params}` : ""}`;

  function updateLocation(changes: Record<string, string | null>) {
    const nextType = Object.hasOwn(changes, "type") ? changes.type : filter;
    writeLocation({ page: null, search: search.trim() || null, ...changes,
      ...(nextType === "commodity" ? { realm: null } : linkedRealm.realm.status === "ready" ? { realm: String(linkedRealm.realm.selectedId) } : {}) });
  }
  function clearFilters() {
    setDraft(null);
    updateLocation(Object.fromEntries(FILTER_KEYS.map(key => [key, null])));
  }

  useEffect(() => {
    if (search.trim() === committedSearch) return;
    const timer = setTimeout(() => {
      writeLocation({ search: search.trim() || null, page: null }, true);
    }, 250);
    return () => clearTimeout(timer);
  }, [committedSearch, search]);

  const request = useMemo(
    () => ({
      ...parsed.filters,
      type: filter === "all" ? undefined : filter,
      search: committedSearch || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [committedSearch, filter, page, parsed.filters],
  );
  const market = useItemBrowser(request, undefined, !parsed.invalid && !linkedRealm.pending && !linkedRealm.invalid);
  const data = market.data;
  const loading = market.status === "loading";

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Market</h1>
        <p className="mt-2 text-sm text-muted">EU Retail prices and supply{filter !== "commodity" && linkedRealm.realm.status === "ready" ? ` · ${linkedRealm.realm.options.find(option => option.id === linkedRealm.realm.selectedId)?.label ?? "Selected realm"}` : " · Region-wide commodities"}.</p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search items</span>
          <input
            type="search"
            maxLength={100}
            placeholder="Search by item name or ID"
            value={search}
            onChange={(event) => setDraft({ source: committedSearch, value: event.target.value })}
            className="h-11 w-full rounded-xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-[border-color,background-color] duration-150 ease-out placeholder:text-muted focus:border-accent focus:bg-card-hover"
          />
        </label>
        <div className="flex flex-wrap gap-1 rounded-xl bg-card p-1 shadow-[var(--shadow-surface)] sm:shrink-0" role="group" aria-label="Market type">
          {FILTERS.map((current) => (
            <button
              key={current}
              type="button"
              aria-pressed={filter === current}
              onClick={() => updateLocation({ type: current === "all" ? null : current, page: null })}
              className={`min-h-11 flex-1 rounded-lg px-3 text-sm transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] sm:flex-none ${
                filter === current ? "bg-foreground text-background" : "text-muted hover:bg-card-hover hover:text-foreground"
              }`}
            >
              {FILTER_LABELS[current]}
            </button>
          ))}
        </div>
      </div>

      <MarketFilters params={new URLSearchParams(query)} onChange={updateLocation} onClear={clearFilters} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted" aria-live="polite" aria-atomic="true">
        <p>{!parsed.invalid && !linkedRealm.invalid && !linkedRealm.pending && data ? `${data.total.toLocaleString()} matching ${data.total === 1 ? "item" : "items"}` : loading ? "Updating results…" : ""}</p>
        <p className="text-xs">Prices and stock use EU commodities and your selected realm. Unlisted prices stay unavailable.</p>
      </div>

      {market.status === "refresh-error" && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 text-sm text-muted" role="alert">
          <p>Couldn’t refresh the market. Showing the last loaded prices.</p>
          <button type="button" className="min-h-11 px-2 text-accent underline" onClick={market.retry}>Retry market</button>
        </div>
      )}

      {parsed.invalid ? (
        <StateMessage><p role="alert">Some filters in this link are invalid. Correct them above or clear the filters.</p></StateMessage>
      ) : linkedRealm.invalid ? (
        <StateMessage><p role="alert">This link refers to an unavailable realm. Choose a realm above or use your current selection.</p><button type="button" className="mt-3 min-h-11 px-4 text-accent underline" onClick={() => writeLocation({ realm: null, page: null })}>Use selected realm</button></StateMessage>
      ) : linkedRealm.pending ? (
        <StateMessage>Loading the linked realm…</StateMessage>
      ) : market.status === "selection-required" ? (
        <StateMessage>Select a realm above for local prices, or <button type="button" className="text-accent underline" onClick={() => updateLocation({ type: "commodity", page: null })}>browse EU commodities</button>.</StateMessage>
      ) : market.status === "error" ? (
        <StateMessage><p role="alert">Couldn’t load the market. Your filters are saved.</p><button type="button" className="mt-3 min-h-11 rounded-lg border border-border px-4 text-accent" onClick={market.retry}>Retry market</button></StateMessage>
      ) : loading && !data ? (
        <StateMessage>Loading market…</StateMessage>
      ) : !data || data.items.length === 0 ? (
        <StateMessage><p>No items match these filters.</p><p className="mt-2">Try a wider price range, another category, or remove a filter above.</p></StateMessage>
      ) : (
        <>
          <div className={`surface overflow-hidden transition-opacity duration-150 ease-out ${loading ? "opacity-60" : "opacity-100"}`}>
            <div className="overflow-x-auto">
              <table className={`${styles.table} w-full border-collapse text-sm`} aria-label="Market prices">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted">
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Market</th>
                    <th className="px-4 py-3 text-right font-medium">Current</th>
                    <th className="px-4 py-3 text-right font-medium">Available</th>
                    <th className="px-4 py-3 text-right font-medium">EU realm benchmark</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <ItemRow key={item.id} item={item} marketHref={marketHref} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => updateLocation({ page: String(Math.max(1, data.page - 1)) })}
              disabled={data.page <= 1}
              className="h-11 rounded-lg bg-card px-4 text-sm text-muted shadow-[var(--shadow-surface)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-card-hover hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
            >
              Previous
            </button>
            <span className="order-first w-full text-center text-sm tabular-nums text-muted sm:order-none sm:w-auto" role="status">
              {data.page} / {Math.max(1, data.totalPages)} · {data.total.toLocaleString()} items
            </span>
            <button
              type="button"
              onClick={() => updateLocation({ page: String(Math.min(data.totalPages, data.page + 1)) })}
              disabled={data.page >= data.totalPages}
              className="h-11 rounded-lg bg-card px-4 text-sm text-muted shadow-[var(--shadow-surface)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-card-hover hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ItemRow({ item, marketHref }: { item: ItemWithPrice; marketHref: string }) {
  const quantity = item.latestPrice?.totalQuantity;
  const isRealm = item.marketType === "realm";

  return (
    <tr className="border-b border-border/70 last:border-0 hover:bg-card-hover">
      <td className="px-4 py-3">
        <WowheadLink href={`/items/${item.id}?from=${encodeURIComponent(marketHref)}`} type="item" id={item.id} className={`${getItemQualityClass(item.itemQuality)} hover:underline`}>
          {item.name}
        </WowheadLink>
        {item.qualityRank && <span className="ml-2 text-xs text-muted">R{item.qualityRank}</span>}
        {item.itemClass && <p className="mt-1 text-xs text-muted">{[item.itemClass, item.itemSubclass, item.inventoryType].filter(value => value && !["Non-equippable", "NON_EQUIP"].includes(value)).join(" · ")}</p>}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-md px-2 py-1 text-xs ${isRealm ? "bg-amber-400/10 text-amber-300" : "bg-positive/10 text-positive"}`}>
          {isRealm ? "Realm" : item.marketType === "commodity" ? "EU" : "—"}
        </span>
      </td>
      <td data-label="Current" className="px-4 py-3 text-right font-medium tabular-nums">{item.latestPrice ? formatPrice(item.latestPrice.minPrice) : "Not listed"}</td>
      <td data-label="Available" className="px-4 py-3 text-right tabular-nums text-muted">
        {quantity == null ? "—" : `${quantity.toLocaleString()} ${quantity === 1 ? "unit" : "units"}`}
      </td>
      <td data-label="EU realm benchmark" className="px-4 py-3 text-right tabular-nums text-muted">
        {isRealm && item.regionLatestPrice ? formatPrice(item.regionLatestPrice.avgPrice) : "—"}
      </td>
    </tr>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div className="surface px-4 py-12 text-center text-sm text-muted">{children}</div>;
}
