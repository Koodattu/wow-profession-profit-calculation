"use client";

import { useEffect, useState } from "react";
import { fetchGearListings, fetchGearVariants, formatPrice, type GearListingsResponse, type GearVariant, type GearVariantsResponse, type Item } from "@/lib/api";
import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";

const controlClass = "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm";

export function versionName(variant: GearVariant): string {
  return [variant.itemLevel === null ? "Item level unavailable" : `ilvl ${variant.itemLevel}`,
    variant.upgrade ? variant.upgrade.fullName ?? `${variant.upgrade.name ?? "Upgrade"} ${variant.upgrade.level}/${variant.upgrade.max}` : null,
  ].filter(Boolean).join(" · ");
}

export default function GearMarket({ item }: { item: Item }) {
  const realmState = useSelectedRealm();
  const realmId = realmState.status === "ready" ? realmState.selectedId : null;
  const [data, setData] = useState<GearVariantsResponse | null>(null);
  const [error, setError] = useState(false);
  const [level, setLevel] = useState("");
  const [track, setTrack] = useState("");
  const [stat, setStat] = useState("");
  const [secondStat, setSecondStat] = useState("");
  const [tag, setTag] = useState("");
  const [socket, setSocket] = useState("");
  const [versionKey, setVersionKey] = useState<string | null>(null);
  const [versionPage, setVersionPage] = useState(0);
  const [listingPagination, setListingPagination] = useState({ realmId, page: 1 });
  const listingPage = listingPagination.realmId === realmId ? listingPagination.page : 1;
  const setListingPage = (page: number) => setListingPagination({ realmId, page });
  const [listingResult, setListingResult] = useState<{ key: string; data: GearListingsResponse } | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchGearVariants(item.id).then((result) => { if (active) setData(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [item.id]);

  const variants = data?.variants ?? [];
  const filtered = variants.filter((variant) => (!level || String(variant.itemLevel) === level)
    && (!track || (track === "none" ? !variant.upgrade : String(variant.upgrade?.group) === track))
    && (!stat || variant.stats.some((value) => String(value.id) === stat))
    && (!secondStat || variant.stats.some((value) => String(value.id) === secondStat))
    && (!tag || variant.tags.includes(tag))
    && (!socket || (socket === "yes" ? variant.sockets > 0 : variant.sockets === 0)));
  const localVariants = filtered.filter((variant) => variant.realms.some((realm) => realm.connectedRealmId === realmId));
  const activeVariant = localVariants.find((variant) => variant.key === versionKey) ?? (localVariants.length === 1 ? localVariants[0] : undefined);
  const listingKey = activeVariant && realmId ? `${item.id}:${realmId}:${activeVariant.key}:${listingPage}` : null;
  useEffect(() => {
    if (!listingKey || !activeVariant || !realmId) return;
    let active = true;
    fetchGearListings(item.id, realmId, activeVariant.key, listingPage).then((result) => {
      if (active) { setListingResult({ key: listingKey, data: result }); setListingError(null); }
    }).catch(() => { if (active) setListingError(listingKey); });
    return () => { active = false; };
  }, [activeVariant, item.id, listingKey, listingPage, realmId]);

  const levels = [...new Set(variants.flatMap((variant) => variant.itemLevel === null ? [] : [variant.itemLevel]))].sort((a, b) => b - a);
  const tracks = [...new Map(variants.flatMap((variant) => variant.upgrade ? [[variant.upgrade.group, variant.upgrade] as const] : [])).values()];
  const stats = [...new Map(variants.flatMap((variant) => variant.stats.map((value) => [value.id, value] as const))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const tags = [...new Set(variants.flatMap((variant) => variant.tags))].sort();
  const realmQuotes = new Map<number, { minimum: number; quantity: number; listings: number; versions: number }>();
  for (const variant of filtered) for (const realm of variant.realms) {
    const quote = realmQuotes.get(realm.connectedRealmId) ?? { minimum: Infinity, quantity: 0, listings: 0, versions: 0 };
    quote.minimum = Math.min(quote.minimum, realm.minBuyout);
    quote.quantity += realm.totalQuantity; quote.listings += realm.numAuctions; quote.versions++;
    realmQuotes.set(realm.connectedRealmId, quote);
  }
  const sortedRealms = [...realmQuotes.entries()].sort((a, b) => a[1].minimum - b[1].minimum || a[0] - b[0]);
  const localRealm = realmState.options.find((realm) => realm.id === realmId);
  const pageCount = Math.ceil(localVariants.length / 20);
  const safePage = Math.min(versionPage, Math.max(0, pageCount - 1));
  const listingData = listingResult?.key === listingKey ? listingResult.data : null;
  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value); setVersionKey(null); setVersionPage(0); setListingPage(1);
  }
  function chooseRealm(id: number) {
    selectedRealm.select(id); setVersionKey(null); setVersionPage(0); setListingPage(1);
  }

  if (error) return <p role="alert" className="surface p-4 mb-6">Couldn’t load item versions. Reload the page to try again.</p>;
  if (!data) return <p className="surface p-4 mb-6 text-muted">Loading item versions…</p>;
  if (!variants.length) return <p className="surface p-4 mb-6 text-muted">No current buyout listings for this item.</p>;

  return <section className="mb-8 space-y-5" aria-label="Item versions and listings">
    <div className="surface p-4 space-y-3">
      <h2 className="font-semibold">Item versions</h2>
      <p className="text-sm text-muted">Filter the versions currently listed, compare realms, then open a version to see its buyout listings. Hover an item link for its Wowhead tooltip.</p>
      {variants.some((variant) => variant.detailsIncomplete) && <p className="text-xs text-muted">Some versions have incomplete reference data. Check their Wowhead tooltips for additional details.</p>}
      {variants.length > 1 && <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {levels.length > 1 && <label className="text-sm">Item level<select className={controlClass} value={level} onChange={(e) => changeFilter(setLevel, e.target.value)}><option value="">All item levels</option>{levels.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
        {tracks.length > 0 && <label className="text-sm">Upgrade track<select className={controlClass} value={track} onChange={(e) => changeFilter(setTrack, e.target.value)}><option value="">All tracks</option>{tracks.map((value) => <option key={value.group} value={value.group}>{value.name ?? "Upgrade"} · {value.max} ranks</option>)}{variants.some((v) => !v.upgrade) && <option value="none">No upgrade track</option>}</select></label>}
        {stats.length > 0 && <>
          <label className="text-sm">Stat<select className={controlClass} value={stat} onChange={(e) => changeFilter(setStat, e.target.value)}><option value="">Any stat</option>{stats.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
          <label className="text-sm">Additional stat<select className={controlClass} value={secondStat} onChange={(e) => changeFilter(setSecondStat, e.target.value)}><option value="">Any additional stat</option>{stats.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        </>}
        {tags.length > 0 && <label className="text-sm">Version tag<select className={controlClass} value={tag} onChange={(e) => changeFilter(setTag, e.target.value)}><option value="">All tags</option>{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
        {variants.some((v) => v.sockets > 0) && <label className="text-sm">Sockets<select className={controlClass} value={socket} onChange={(e) => changeFilter(setSocket, e.target.value)}><option value="">Any sockets</option><option value="yes">With sockets</option><option value="no">Without sockets</option></select></label>}
      </div>}
      <p className="text-sm text-muted">{filtered.length.toLocaleString()} versions · {realmQuotes.size} connected realms</p>
      {(level || track || stat || secondStat || tag || socket) && <button className="text-sm text-accent" onClick={() => { setLevel(""); setTrack(""); setStat(""); setSecondStat(""); setTag(""); setSocket(""); setVersionKey(null); setVersionPage(0); setListingPage(1); }}>Clear filters</button>}
    </div>

    <div className="grid gap-5 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
      <div className="surface p-4 self-start">
        <h3 className="font-semibold mb-3">Realms · matching versions</h3>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Realm</th><th className="pb-2 text-right font-medium">From</th><th className="pb-2 pl-3 text-right font-medium">Listings</th></tr></thead>
            <tbody>{sortedRealms.map(([id, quote]) => {
              const realm = realmState.options.find((option) => option.id === id);
              return <tr key={id} className={`border-t border-border/50 ${id === realmId ? "bg-accent/10" : ""}`}>
                <td className="py-2 pr-2"><button className="text-left hover:text-accent" aria-pressed={id === realmId} disabled={!realm} onClick={() => chooseRealm(id)} title={realm?.fullLabel}>{realm?.label ?? `Realm ${id}`}{id === realmId && <span className="sr-only"> (Selected)</span>}</button>
                  {realm && realm.fullLabel !== realm.label && <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Connected realms</summary><p className="py-1 max-w-56">{realm.fullLabel}</p></details>}
                </td><td className="py-2 text-right tabular-nums whitespace-nowrap">{formatPrice(quote.minimum)}</td><td className="py-2 pl-3 text-right tabular-nums">{quote.listings.toLocaleString()}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {sortedRealms.length === 0 && <p className="text-sm text-muted">No listings match these filters.</p>}
      </div>

      <div className="space-y-5 min-w-0">
        <div className="surface p-4">
          <h3 className="font-semibold mb-3" title={localRealm?.fullLabel}>{localRealm ? `Versions on ${localRealm.label}` : "Choose a realm"}</h3>
          {localVariants.length === 0 ? <p className="text-sm text-muted">{realmId ? "No matching versions on this realm. Choose another realm or change the filters." : "Select a realm to view its versions and listings."}</p> : <>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Version</th><th className="pb-2 font-medium">Stats</th><th className="pb-2 text-right font-medium">From</th><th className="pb-2 pl-3 text-right font-medium">Listings</th></tr></thead>
              <tbody>{localVariants.slice(safePage * 20, safePage * 20 + 20).map((variant) => {
                const quote = variant.realms.find((realm) => realm.connectedRealmId === realmId)!;
                return <tr key={variant.key} className={`border-t border-border/50 ${activeVariant?.key === variant.key ? "bg-accent/10" : ""}`}>
                  <td className="py-3 pr-3"><a href={variant.wowhead.url} data-wowhead={variant.wowhead.tooltip} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{versionName(variant)}</a>
                    {variant.tags.length > 0 && <p className="text-xs text-muted">{variant.tags.join(" · ")}</p>}
                    {variant.sockets > 0 && <p className="text-xs text-muted">{variant.sockets} {variant.sockets === 1 ? "socket" : "sockets"}</p>}
                  </td><td className="py-3 pr-3 text-xs">{variant.stats.filter((value) => ![3, 4, 5, 7, 71, 72, 73, 74].includes(value.id)).map((value) => value.name).join(" / ") || "—"}</td>
                  <td className="py-3 text-right whitespace-nowrap tabular-nums">{formatPrice(quote.minBuyout)}</td>
                  <td className="py-3 pl-3 text-right"><button className="rounded border border-border px-2 py-1 hover:border-accent" aria-label={`View ${quote.numAuctions} listings for ${versionName(variant)}`} aria-pressed={activeVariant?.key === variant.key} onClick={() => { setVersionKey(variant.key); setListingPage(1); }}>{quote.numAuctions.toLocaleString()} →</button></td>
                </tr>;
              })}</tbody></table></div>
            {pageCount > 1 && <div className="mt-3 flex justify-between text-sm"><button disabled={safePage === 0} onClick={() => setVersionPage(safePage - 1)}>Previous versions</button><span>{safePage + 1} / {pageCount}</span><button disabled={safePage + 1 >= pageCount} onClick={() => setVersionPage(safePage + 1)}>Next versions</button></div>}
          </>}
        </div>

        {activeVariant && <div className="surface p-4" role="region" aria-label="Buyout listings">
          <h3 className="font-semibold mb-2">Buyout listings · {versionName(activeVariant)}</h3>
          <a href={activeVariant.wowhead.url} data-wowhead={activeVariant.wowhead.tooltip} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">{item.name} · view tooltip</a>
          <p className="mt-2 text-xs text-muted">Listings are a snapshot, not a live availability guarantee. Stat amounts and effects are shown in the Wowhead tooltip.</p>
          {listingError === listingKey ? <p role="alert" className="mt-3 text-sm">Couldn’t load listings. Reload the page to try again.</p>
            : !listingData ? <p className="mt-3 text-sm text-muted">Loading listings…</p>
            : !listingData.detailsAvailable ? <p className="mt-3 text-sm text-muted">Listing details will be available after this realm’s next market refresh.</p>
            : <><div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Auction</th><th className="pb-2 text-right font-medium">Quantity</th><th className="pb-2 text-right font-medium">Buyout total</th><th className="pb-2 text-right font-medium">Per item</th><th className="pb-2 text-right font-medium">Time left</th></tr></thead>
              <tbody>{listingData.listings.map((listing) => <tr className="border-t border-border/50" key={listing.id}><td className="py-2 pr-2"><a href={activeVariant.wowhead.url} data-wowhead={activeVariant.wowhead.tooltip} target="_blank" rel="noopener noreferrer" className="text-accent">#{listing.id}</a></td><td className="py-2 text-right">{listing.quantity.toLocaleString()}</td><td className="py-2 text-right whitespace-nowrap">{formatPrice(listing.buyout)}</td><td className="py-2 text-right whitespace-nowrap">{formatPrice(Math.round(listing.buyout / listing.quantity))}</td><td className="py-2 text-right text-muted">{({ SHORT: "< 30 min", MEDIUM: "30 min–2 hr", LONG: "2–12 hr", VERY_LONG: "> 12 hr" } as Record<string, string>)[listing.timeLeft ?? ""] ?? "—"}</td></tr>)}</tbody>
            </table></div>{listingData.totalPages > 1 && <div className="mt-3 flex justify-between text-sm"><button disabled={listingPage === 1} onClick={() => setListingPage(listingPage - 1)}>Previous listings</button><span>{listingPage} / {listingData.totalPages}</span><button disabled={listingPage >= listingData.totalPages} onClick={() => setListingPage(listingPage + 1)}>Next listings</button></div>}
              <p className="mt-3 text-xs text-muted">{listingData.total.toLocaleString()} listings · Observed {listingData.observedAt ? new Date(listingData.observedAt).toLocaleString() : "—"}</p></>}
          <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Version details</summary><div className="space-y-1 py-2 break-words"><p>Bonus IDs: {activeVariant.bonusLists.join(", ") || "None"}</p><p>Modifiers: {activeVariant.modifiers.map((value) => `${value.type}: ${value.value}`).join(", ") || "None"}</p><p>Context: {activeVariant.context ?? "None"}</p>{activeVariant.detailsIncomplete && <p>Some details are unavailable in the reference data. Original auction modifiers are listed above; supported bonuses and crafted stats are passed to Wowhead.</p>}<p>Game data: {data.dataVersion.wowBuild} · Raidbots / SimulationCraft</p></div></details>
        </div>}
      </div>
    </div>
  </section>;
}
