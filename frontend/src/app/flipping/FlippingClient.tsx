"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import WowheadLink from "@/app/WowheadLink";
import { fetchFlippingCategories, fetchFlippingOpportunities, formatPrice, type FlippingCategory, type FlippingOpportunity, type FlippingSortBy } from "@/lib/api";
import { getItemQualityClass } from "@/lib/item-quality";

const LIMIT_OPTIONS = [25, 50, 100] as const;

function updateLocation(changes: Record<string, string | null>) {
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  window.history.replaceState(null, "", `/flipping${next.size ? `?${next}` : ""}`);
}

export default function FlippingClient() {
  const params = useSearchParams();
  const requestedSpread = Number(params.get("minSpread") ?? 0);
  const minSpreadGold = Number.isFinite(requestedSpread * 10000) ? Math.max(0, requestedSpread) : 0;
  const limit = LIMIT_OPTIONS.find((value) => value === Number(params.get("limit"))) ?? 25;
  const requestedCategory = params.get("category") ?? "all";
  const categoryFilter = requestedCategory === "none" || (requestedCategory.startsWith("name:") && requestedCategory.length > 5) ? requestedCategory : "all";
  const sortBy: FlippingSortBy = params.get("sort") === "regionAvgPrice" ? "regionAvgPrice" : "spread";
  const comparisonHref = `/flipping${params.size ? `?${params}` : ""}`;
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categories, setCategories] = useState<FlippingCategory[]>([]);
  const [data, setData] = useState<FlippingOpportunity[]>([]);
  const [isPending, startTransition] = useTransition();
  const [initialLoad, setInitialLoad] = useState(true);
  const [failed, setFailed] = useState(false);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchFlippingCategories("eu");
        if (!cancelled) { setCategories(result); setCategoriesFailed(false); }
      } catch {
        if (!cancelled) setCategoriesFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const minSpreadCopper = minSpreadGold > 0 ? minSpreadGold * 10000 : undefined;
        const selectedCategoryName = categoryFilter.startsWith("name:") ? categoryFilter.slice(5) : undefined;
        const result = await fetchFlippingOpportunities("eu", minSpreadCopper, limit, selectedCategoryName, sortBy, categoryFilter === "none");
        if (!cancelled) { setData(result); setFailed(false); }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setInitialLoad(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [minSpreadGold, limit, categoryFilter, sortBy, attempt]);

  useEffect(() => {
    if (!categoryOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!categoryDropdownRef.current?.contains(event.target as Node)) {
        setCategoryOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [categoryOpen]);

  const loading = initialLoad || isPending;
  const hasUncategorized = categories.some((category) => category.categoryName === null);
  const uniqueNamedCategories = Array.from(new Set(categories.map((category) => category.categoryName).filter((categoryName): categoryName is string => categoryName !== null))).sort((a, b) =>
    a.localeCompare(b),
  );
  const categoryOptions = [
    { value: "all", label: "All categories" },
    ...(hasUncategorized ? [{ value: "none", label: "No category" }] : []),
    ...uniqueNamedCategories.map((categoryName) => ({ value: `name:${categoryName}`, label: categoryName })),
  ];
  const categorySearchLower = categorySearch.trim().toLowerCase();
  const visibleCategoryOptions = categorySearchLower.length === 0 ? categoryOptions : categoryOptions.filter((option) => option.label.toLowerCase().includes(categorySearchLower));
  const selectedCategoryLabel = categoryFilter === "all" ? "All categories" : categoryFilter === "none" ? "No category" : categoryFilter.slice(5);

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">Europe · Current listings</p>
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Realm comparison</h1>
      <p className="text-muted mb-2">Compare current crafted-item prices across connected realms.</p>
      <p className="text-xs text-muted mb-6">Price gaps are not guaranteed profit and exclude auction fees.</p>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 mb-6">
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
              onChange={(e) => updateLocation({ minSpread: String(Math.max(0, Number(e.target.value))) })}
              className="min-h-11 w-28 px-3 py-2 pr-8 rounded-md bg-card border border-border text-foreground placeholder:text-muted focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
            onChange={(e) => updateLocation({ limit: e.target.value })}
            className="min-h-11 px-3 py-2 rounded-md bg-card border border-border text-foreground focus:outline-none focus:border-accent"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="category-toggle" className="text-sm text-muted whitespace-nowrap">Category</label>
          <div className="w-52 relative" ref={categoryDropdownRef} onKeyDown={(event) => {
            if (event.key === "Escape") { setCategoryOpen(false); categoryButtonRef.current?.focus(); }
          }}>
            <button
              id="category-toggle"
              ref={categoryButtonRef}
              aria-expanded={categoryOpen}
              aria-controls="category-options"
              type="button"
              className="min-h-11 w-full px-3 py-2 rounded-md bg-card border border-border text-sm text-left text-foreground hover:bg-card-hover transition-colors"
              onClick={() => {
                setCategoryOpen((prev) => !prev);
                setCategorySearch("");
              }}
            >
              {selectedCategoryLabel}
            </button>

            {categoryOpen && (
              <div id="category-options" className="absolute left-0 right-0 top-full mt-2 bg-card border border-border rounded-lg z-50">
                <div className="p-2 border-b border-border/60">
                  <input
                    id="categorySearch"
                    aria-label="Search categories"
                    type="text"
                    autoFocus
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Search category..."
                    className="min-h-11 w-full bg-background border border-border rounded-md px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {visibleCategoryOptions.map((category) => (
                    <button
                      key={category.value}
                      type="button"
                      onClick={() => {
                        updateLocation({ category: category.value === "all" ? null : category.value });
                        setCategoryOpen(false);
                        setCategorySearch("");
                        categoryButtonRef.current?.focus();
                      }}
                      className={`min-h-11 w-full px-3 py-1.5 text-sm text-left hover:bg-card-hover transition-colors ${
                        categoryFilter === category.value ? "text-accent" : "text-foreground"
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                  {visibleCategoryOptions.length === 0 && <p className="px-3 py-2 text-xs text-muted">No categories found</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="sortBy" className="text-sm text-muted whitespace-nowrap">
            Sort by
          </label>
          <select
            id="sortBy"
            value={sortBy}
            onChange={(e) => updateLocation({ sort: e.target.value === "spread" ? null : e.target.value })}
            className="min-h-11 px-3 py-2 rounded-md bg-card border border-border text-foreground focus:outline-none focus:border-accent"
          >
            <option value="spread">Spread</option>
            <option value="regionAvgPrice">EU realm benchmark</option>
          </select>
        </div>
      </div>
      {categoriesFailed && <p className="mb-4 text-sm text-muted" role="alert">Categories are unavailable. <button type="button" className="min-h-11 px-2 text-accent underline" onClick={() => setAttempt((value) => value + 1)}>Retry categories</button></p>}

      {/* Table */}
      {loading ? (
        <p className="text-muted py-8 text-center" role="status">Loading realm comparisons…</p>
      ) : failed ? (
        <div className="surface p-6 text-center" role="alert"><p className="text-muted">Couldn’t load realm comparisons. Your filters are saved.</p><button type="button" className="mt-3 min-h-11 rounded-lg border border-border px-4 text-accent" onClick={() => setAttempt((value) => value + 1)}>Retry comparison</button></div>
      ) : data.length === 0 ? (
        <div className="py-8 text-center"><p className="text-muted">No items match these comparison filters.</p><button type="button" className="mt-2 min-h-11 px-3 text-accent underline" onClick={() => updateLocation({ minSpread: null, category: null })}>Clear comparison filters</button></div>
      ) : (
        <div>
          <p className="mb-2 text-xs text-muted lg:hidden">Scroll to compare all realm prices.</p>
          <div className="overflow-x-auto" role="region" aria-label="Realm price comparison" tabIndex={0}>
          <table className="w-full min-w-[960px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 font-medium">Rank</th>
                <th className="py-2 pr-4 font-medium text-right">EU realm benchmark</th>
                <th className="py-2 pr-4 font-medium">Cheapest Realm</th>
                <th className="py-2 pr-4 font-medium">Most Expensive Realm</th>
                <th className="py-2 pr-4 font-medium text-right">Spread</th>
                <th className="py-2 pr-4 font-medium text-right">Spread %</th>
                <th className="py-2 pr-4 font-medium text-right">Realms</th>
              </tr>
            </thead>
            <tbody>
              {data.map((opp) => (
                <FlipRow key={`${opp.itemId}-${opp.qualityRank ?? 0}`} opp={opp} comparisonHref={comparisonHref} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FlipRow({ opp, comparisonHref }: { opp: FlippingOpportunity; comparisonHref: string }) {
  return (
    <tr className="border-b border-border/50 hover:bg-card-hover transition-colors">
      <td className="py-2 pr-4">
        <WowheadLink href={`/items/${opp.itemId}?from=${encodeURIComponent(comparisonHref)}`} type="item" id={opp.itemId} className={`${getItemQualityClass(opp.itemQuality)} hover:underline`}>
          {opp.itemName}
        </WowheadLink>
      </td>
      <td className="py-2 pr-4 text-muted">{opp.categoryName ?? "No category"}</td>
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
