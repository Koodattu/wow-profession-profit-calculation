"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchGearListings, fetchGearVariants, formatPrice, type GearListingsResponse, type GearVariant, type GearVariantsResponse, type Item } from "@/lib/api";
import { useSelectedRealm, type RealmOption } from "@/lib/selected-realm";
import styles from "./ItemMarket.module.css";

const emptyFilters = { level: "", track: "", stat: "", secondStat: "", tag: "", socket: "" };
const primaryStats = new Set([3, 4, 5, 7, 71, 72, 73, 74]);
const pageSize = 12;

export function versionName(variant: GearVariant): string {
  return [variant.itemLevel === null ? "Item level unavailable" : `ilvl ${variant.itemLevel}`,
    variant.upgrade ? variant.upgrade.fullName ?? `${variant.upgrade.name ?? "Upgrade"} ${variant.upgrade.level}/${variant.upgrade.max}` : null,
  ].filter(Boolean).join(" · ");
}

function statNames(variant: GearVariant): string {
  return variant.stats.filter((stat) => !primaryStats.has(stat.id)).map((stat) => stat.name).join(" / ");
}

export default function GearMarket({ item }: { item: Item }) {
  const realmState = useSelectedRealm();
  const realmId = realmState.status === "ready" ? realmState.selectedId : null;
  const localRealm = realmState.options.find((realm) => realm.id === realmId);
  const [data, setData] = useState<GearVariantsResponse | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filters, setFilters] = useState(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scope, setScope] = useState<"realm" | "eu">("realm");
  const allRealms = scope === "eu" || realmId === null;
  const [sort, setSort] = useState("price");
  const [pagination, setPagination] = useState({ key: "", page: 0 });
  const [selection, setSelection] = useState<{ variant: GearVariant; realmId: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetchGearVariants(item.id).then((result) => { if (active) setData(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [item.id, retry]);

  const variants = data?.variants ?? [];
  const filtered = variants.filter((variant) => (!filters.level || String(variant.itemLevel) === filters.level)
    && (!filters.track || (filters.track === "none" ? !variant.upgrade : String(variant.upgrade?.group) === filters.track))
    && (!filters.stat || variant.stats.some((value) => String(value.id) === filters.stat))
    && (!filters.secondStat || variant.stats.some((value) => String(value.id) === filters.secondStat))
    && (!filters.tag || variant.tags.includes(filters.tag))
    && (!filters.socket || (filters.socket === "yes" ? variant.sockets > 0 : variant.sockets === 0)));
  const offers = filtered.flatMap((variant) => {
    const realms = variant.realms.filter((realm) => allRealms || realm.connectedRealmId === realmId)
      .toSorted((a, b) => a.minBuyout - b.minBuyout || a.connectedRealmId - b.connectedRealmId);
    return realms.length ? [{ variant, cheapest: realms[0], listings: realms.reduce((sum, realm) => sum + realm.numAuctions, 0) }] : [];
  }).sort((a, b) => (sort === "level" ? (b.variant.itemLevel ?? -1) - (a.variant.itemLevel ?? -1)
    : sort === "listings" ? b.listings - a.listings : 0)
    || a.cheapest.minBuyout - b.cheapest.minBuyout || a.variant.key.localeCompare(b.variant.key));

  const levels = [...new Set(variants.flatMap((variant) => variant.itemLevel === null ? [] : [variant.itemLevel]))].sort((a, b) => b - a);
  const tracks = [...new Map(variants.flatMap((variant) => variant.upgrade ? [[variant.upgrade.group, variant.upgrade] as const] : [])).values()];
  const stats = [...new Map(variants.flatMap((variant) => variant.stats.filter((stat) => !primaryStats.has(stat.id)).map((stat) => [stat.id, stat] as const))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const tags = [...new Set(variants.flatMap((variant) => variant.tags))].sort();
  const matchingRealms = new Set(filtered.flatMap((variant) => variant.realms.map((realm) => realm.connectedRealmId))).size;
  const lowestPrice = offers.length ? Math.min(...offers.map((offer) => offer.cheapest.minBuyout)) : null;
  const listingCount = offers.reduce((sum, offer) => sum + offer.listings, 0);
  const filterCount = Object.values(filters).filter(Boolean).length;
  const pageKey = JSON.stringify([filters, allRealms, realmId, sort]);
  const pageCount = Math.ceil(offers.length / pageSize);
  const page = pagination.key === pageKey ? Math.min(pagination.page, Math.max(0, pageCount - 1)) : 0;
  const changeFilter = (key: keyof typeof filters, value: string) => setFilters({ ...filters, [key]: value });

  if (error) return <div className={styles.empty} role="alert"><h2>Couldn’t load listings</h2><p>Please try again.</p><button className={styles.action} onClick={() => { setError(false); setRetry(retry + 1); }}>Try again</button></div>;
  if (!data) return <div className={styles.empty} role="status">Loading current offers…</div>;
  if (!variants.length) return <div className={styles.empty}><h2>No buyout listings right now</h2><p>This item isn’t listed in the latest EU auction snapshots. Check back after the next hourly refresh.</p></div>;

  return <section className={styles.market} aria-label="Item versions and listings">
    <div className={styles.marketToolbar}>
      <div className={styles.segmented} aria-label="Listing scope">
        <button aria-pressed={!allRealms} disabled={!localRealm} title={localRealm?.fullLabel} onClick={() => setScope("realm")}>{localRealm?.label ?? "Your realm"}</button>
        <button aria-pressed={allRealms} onClick={() => setScope("eu")}>All EU realms</button>
      </div>
      <p className={styles.quiet}>Prices per item · hourly snapshots</p>
      {variants.length > 1 && <button className={styles.mobileFilterToggle} aria-expanded={filtersOpen} aria-controls={`item-filters-${item.id}`} onClick={() => setFiltersOpen(!filtersOpen)}>Filters{filterCount > 0 && ` (${filterCount})`} {filtersOpen ? "−" : "+"}</button>}
    </div>
    <div className={styles.marketSummary}>
      <div><span>Lowest matching buyout</span><strong className={styles.gold}>{lowestPrice === null ? "—" : formatPrice(lowestPrice)}</strong><small>{allRealms ? "Across EU realms" : `On ${localRealm?.label}`}</small></div>
      <div><span>Matching listings</span><strong>{listingCount.toLocaleString()}</strong><small>{offers.length.toLocaleString()} {offers.length === 1 ? "version" : "versions"}</small></div>
      <div><span>Realm availability</span><strong>{matchingRealms}<small> / {realmState.options.length || "—"}</small></strong><small>Realm groups with matching versions</small></div>
    </div>
    <div className={styles.offerSurface}>
      {variants.length > 1 && <div id={`item-filters-${item.id}`} className={styles.filters} data-open={filtersOpen}>
        {tracks.length > 0 && <Filter label="Upgrade track" value={filters.track} onChange={(value) => changeFilter("track", value)}><option value="">Any track</option>{tracks.map((track) => <option key={track.group} value={track.group}>{track.name ?? "Upgrade"} · {track.max} ranks</option>)}{variants.some((v) => !v.upgrade) && <option value="none">No upgrade track</option>}</Filter>}
        {(levels.length + Number(variants.some((v) => v.itemLevel === null))) > 1 && <Filter label="Item level" value={filters.level} onChange={(value) => changeFilter("level", value)}><option value="">Any item level</option>{levels.map((level) => <option key={level} value={level}>{level}</option>)}{variants.some((v) => v.itemLevel === null) && <option value="null">Unknown item level</option>}</Filter>}
        {stats.length > 1 && <>
          <Filter label="Stat" value={filters.stat} onChange={(value) => setFilters({ ...filters, stat: value, secondStat: value === filters.secondStat ? "" : filters.secondStat })}><option value="">Any stat</option>{stats.map((stat) => <option key={stat.id} value={stat.id}>{stat.name}</option>)}</Filter>
          <Filter label="Additional stat" value={filters.secondStat} onChange={(value) => changeFilter("secondStat", value)}><option value="">Any second stat</option>{stats.filter((stat) => String(stat.id) !== filters.stat).map((stat) => <option key={stat.id} value={stat.id}>{stat.name}</option>)}</Filter>
        </>}
        {(tags.length > 1 || variants.some((v) => v.sockets > 0)) && <details className={styles.moreFilters}><summary>More filters{(filters.tag || filters.socket) && " •"}</summary><div>
          {tags.length > 1 && <Filter label="Source" value={filters.tag} onChange={(value) => changeFilter("tag", value)}><option value="">Any source</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</Filter>}
          {variants.some((v) => v.sockets > 0) && <Filter label="Sockets" value={filters.socket} onChange={(value) => changeFilter("socket", value)}><option value="">Any sockets</option><option value="yes">With sockets</option><option value="no">Without sockets</option></Filter>}
        </div></details>}
        {filterCount > 0 && <button className={styles.textButton} onClick={() => setFilters(emptyFilters)}>Reset ({filterCount})</button>}
      </div>}
      <div className={styles.resultsToolbar}>
        <h2 aria-live="polite">{offers.length.toLocaleString()} {offers.length === 1 ? "version" : "versions"}{" "}<span>{allRealms ? " across EU realms" : ` on ${localRealm?.label}`}</span></h2>
        <label className={styles.sort}>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="price">Lowest price</option><option value="level">Highest item level</option><option value="listings">Most listings</option></select></label>
      </div>
      {offers.length === 0 ? <div className={styles.empty}><h3>No matching offers{!allRealms && ` on ${localRealm?.label}`}</h3><p>{matchingRealms > 0 ? `Matching versions are available on ${matchingRealms} other realm groups.` : "Try a different item level, upgrade track, or stat combination."}</p><div className={styles.emptyActions}>{!allRealms && <button className={styles.action} onClick={() => setScope("eu")}>Search all EU realms</button>}{filterCount > 0 && <button className={styles.textButton} onClick={() => setFilters(emptyFilters)}>Reset filters</button>}</div></div>
        : <>
          <div className={`${styles.offerGrid} ${styles.columnHead}`} aria-hidden="true"><span>Item version</span><span>Stats</span><span>Lowest buyout</span><span>Listings</span><span /></div>
          <div className={styles.offerList}>{offers.slice(page * pageSize, (page + 1) * pageSize).map(({ variant, cheapest, listings }) => {
            const realm = realmState.options.find((option) => option.id === cheapest.connectedRealmId);
            return <button key={variant.key} className={`${styles.offerGrid} ${styles.offerRow}`} aria-label={`View listings for ${versionName(variant)}, ${statNames(variant) || "no secondary stats"}, from ${formatPrice(cheapest.minBuyout)}`} onClick={() => setSelection({ variant, realmId: cheapest.connectedRealmId })}>
              <span className={styles.versionCell}><span className={styles.levelBadge}>{variant.itemLevel ?? "?"}<small>ilvl</small></span><span><strong>{variant.upgrade ? variant.upgrade.fullName ?? `${variant.upgrade.name ?? "Upgrade"} ${variant.upgrade.level}/${variant.upgrade.max}` : variant.tags.join(" · ") || (variant.detailsIncomplete ? "Version details unavailable" : "Standard")}</strong><small>{variant.upgrade ? variant.tags.join(" · ") || "Upgradeable" : variant.detailsIncomplete ? "Track unavailable" : "No upgrade track"}{variant.sockets > 0 && ` · ${variant.sockets} ${variant.sockets === 1 ? "socket" : "sockets"}`}</small><span className={styles.mobileStats}>{statNames(variant) || (variant.detailsIncomplete ? "Stats unavailable" : "No secondary stats")}</span></span></span>
              <span className={styles.statCell}>{statNames(variant) || "—"}</span>
              <span className={styles.priceCell}><strong>{formatPrice(cheapest.minBuyout)}</strong><small title={allRealms ? realm?.fullLabel : undefined}>{allRealms ? realm?.label ?? `Realm ${cheapest.connectedRealmId}` : variant.realms.length > 1 ? `On ${variant.realms.length} realm groups` : "Only on this realm"}</small><span className={styles.mobileStats}>{listings.toLocaleString()} {listings === 1 ? "listing" : "listings"}</span></span>
              <span className={styles.countCell}>{listings.toLocaleString()}</span><span className={styles.rowArrow} aria-hidden="true">↗</span>
            </button>;
          })}</div>
          <Pagination page={page + 1} pages={pageCount} label="versions" onChange={(next) => setPagination({ key: pageKey, page: next - 1 })} />
        </>}
    </div>
    <p className={styles.footnote}>Each row is an exact item version. Open an offer to compare its realm prices and view individual auctions.</p>
    {selection && <OfferDetails key={`${selection.variant.key}:${selection.realmId}`} item={item} variant={selection.variant} initialRealmId={selection.realmId} realms={realmState.options} dataVersion={data.dataVersion} onClose={() => setSelection(null)} />}
  </section>;
}

function Filter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className={styles.filter}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function Pagination({ page, pages, label, onChange }: { page: number; pages: number; label: string; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className={styles.pagination} aria-label={`${label} pages`}><button disabled={page === 1} onClick={() => onChange(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button disabled={page === pages} onClick={() => onChange(page + 1)}>Next →</button></nav>;
}

function OfferDetails({ item, variant, initialRealmId, realms, dataVersion, onClose }: {
  item: Item; variant: GearVariant; initialRealmId: number; realms: RealmOption[]; dataVersion: GearVariantsResponse["dataVersion"]; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [realmId, setRealmId] = useState(initialRealmId);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: GearListingsResponse } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = `${realmId}:${page}:${retry}`;
  const quotes = variant.realms.toSorted((a, b) => a.minBuyout - b.minBuyout || a.connectedRealmId - b.connectedRealmId);
  const quote = quotes.find((quote) => quote.connectedRealmId === realmId)!;
  const realm = realms.find((realm) => realm.id === realmId);
  const data = result?.key === key ? result.data : null;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => { document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    let active = true;
    fetchGearListings(item.id, realmId, variant.key, page).then((data) => { if (active) setResult({ key, data }); })
      .catch(() => { if (active) setFailedKey(key); });
    return () => { active = false; };
  }, [item.id, realmId, variant.key, page, key]);

  return <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="offer-title" tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select:not(:disabled), summary')].filter((element) => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    }}>
      <header className={styles.drawerHeader}><span>Offer details</span><button onClick={onClose} aria-label="Close offer details">✕</button></header>
      <div className={styles.drawerBody}>
        <p className={styles.eyebrow}>{item.itemSubclass ?? item.itemClass}{item.inventoryType && ` · ${item.inventoryType}`}</p>
        <h2 id="offer-title">{item.name}</h2>
        <p className={styles.drawerVersion}>{versionName(variant)}</p>
        <p className={styles.drawerStats}>{statNames(variant) || (variant.detailsIncomplete ? "Stats unavailable" : "No secondary stats")}{variant.sockets > 0 && ` · ${variant.sockets} ${variant.sockets === 1 ? "socket" : "sockets"}`}</p>
        <a className={styles.wowhead} href={variant.wowhead.url} data-wowhead={variant.wowhead.tooltip} target="_blank" rel="noopener noreferrer">View exact item on Wowhead ↗</a>
        {variant.detailsIncomplete && <p className={styles.footnote}>Some item details are unavailable. Check the Wowhead tooltip for supported stats and effects.</p>}
        <div className={styles.realmChoice}><Filter label="Compare this version on other realms" value={String(realmId)} onChange={(value) => { setRealmId(Number(value)); setPage(1); }}>{quotes.map((quote) => {
          const option = realms.find((realm) => realm.id === quote.connectedRealmId);
          return <option key={quote.connectedRealmId} value={quote.connectedRealmId}>{option?.label ?? `Realm ${quote.connectedRealmId}`} — {formatPrice(quote.minBuyout)}</option>;
        })}</Filter><p title={realm?.fullLabel}>{realm?.fullLabel ?? `Realm ${realmId}`}</p></div>
        <div className={styles.drawerPrice}><span>Lowest buyout per item on {realm?.label ?? `Realm ${realmId}`}</span><strong>{formatPrice(quote.minBuyout)}</strong><small>{quote.minBuyout === quotes[0].minBuyout ? "Lowest price across EU realms for this version" : `EU lowest: ${formatPrice(quotes[0].minBuyout)}`}</small></div>
        <section aria-label="Buyout listings" className={styles.listings}>
          <h3>Buyout listings <span>{data?.total ?? quote.numAuctions}</span></h3>
          {failedKey === key ? <div role="alert" className={styles.empty}><p>Couldn’t load these listings.</p><button className={styles.action} onClick={() => setRetry(retry + 1)}>Try again</button></div>
            : !data ? <p className={styles.empty} role="status">Loading listings…</p>
            : !data.detailsAvailable ? <p className={styles.empty}>Listing details will appear after this realm’s next refresh.</p>
            : data.listings.length === 0 ? <p className={styles.empty}>These listings are no longer in the latest snapshot. Reopen the item page for current offers.</p>
            : <><table><thead><tr><th>Buyout total</th><th>Quantity</th><th>Time left</th></tr></thead><tbody>{data.listings.map((listing) => <tr key={listing.id}>
              <td><strong>{formatPrice(listing.buyout)}</strong>{listing.quantity > 1 && <small>{formatPrice(Math.round(listing.buyout / listing.quantity))} each</small>}<small><a href={variant.wowhead.url} data-wowhead={variant.wowhead.tooltip} target="_blank" rel="noopener noreferrer" aria-label={`View item tooltip for auction ${listing.id}`}>#{listing.id}</a></small></td>
              <td>{listing.quantity.toLocaleString()}</td><td>{({ SHORT: "< 30 min", MEDIUM: "30 min–2 hr", LONG: "2–12 hr", VERY_LONG: "> 12 hr" } as Record<string, string>)[listing.timeLeft ?? ""] ?? "—"}</td>
            </tr>)}</tbody></table><Pagination page={page} pages={data.totalPages} label="listings" onChange={setPage} /></>}
          <p className={styles.footnote}>Snapshot from {new Date(data?.observedAt ?? quote.observedAt).toLocaleString()}. Listings may have sold since the last refresh.</p>
        </section>
        <details className={styles.technicalDetails}><summary>Item version details</summary><p>Bonus IDs: {variant.bonusLists.join(", ") || "None"}</p><p>Modifiers: {variant.modifiers.map((value) => `${value.type}: ${value.value}`).join(", ") || "None"}</p><p>Context: {variant.context ?? "None"}</p><p>Game data: {dataVersion.wowBuild} · Raidbots / SimulationCraft</p></details>
      </div>
    </section>
  </div>;
}
