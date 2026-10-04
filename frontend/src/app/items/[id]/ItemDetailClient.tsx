"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Item } from "@/lib/api";
import { updateHistoryQuery, useLinkedHistoryRealm } from "@/lib/history-view";
import ItemHistory from "./ItemHistory";
import GearMarket from "./GearMarket";
import styles from "./ItemMarket.module.css";

export default function ItemDetailClient({ item, backHref = "/items" }: { item: Item; backHref?: string }) {
  const hasRealmListings = item.marketType === "realm";
  const query = useSearchParams();
  const view = query?.get("view") === "history" ? "history" : "offers";
  const linked = useLinkedHistoryRealm(hasRealmListings);
  const backLabel = backHref.startsWith("/craft-plan") ? "craft plan"
    : backHref.startsWith("/recipes/") ? "recipe"
      : backHref === "/flipping" || backHref.startsWith("/flipping?") ? "realm comparison" : "market";
  function setView(next: "offers" | "history") {
    updateHistoryQuery({ view: next === "history" ? next : null,
      ...(linked.realm.status === "ready" ? { realm: String(linked.realm.selectedId) } : {}) });
  }

  return <div className={styles.page}>
    <Link href={backHref} className={styles.breadcrumb}>← Back to {backLabel}</Link>
    <header className={styles.itemHeader}>
      <div><h1>{item.name}</h1><div className={styles.itemMeta}>
        <span>{[item.itemSubclass ?? item.itemClass, item.inventoryType].filter(Boolean).join(" · ") || "Auction item"}</span>
        {item.qualityRank != null && <span>Rank {item.qualityRank}</span>}
        {item.isReagent && <span>Reagent</span>}{item.isCraftedOutput && <span>Crafted</span>}
        <span>Item {item.id}</span>
      </div></div>
      <a className={styles.itemLink} href={`https://www.wowhead.com/item=${item.id}`} data-wowhead={`item=${item.id}`} target="_blank" rel="noopener noreferrer">View on Wowhead ↗</a>
    </header>
    {hasRealmListings && <nav className={styles.viewTabs} aria-label="Item view">
      <button aria-pressed={view === "offers"} onClick={() => setView("offers")}>Buyout listings</button>
      <button aria-pressed={view === "history"} onClick={() => setView("history")}>Price history</button>
    </nav>}
    {linked.pending ? <p role="status" className={styles.empty}>Loading the linked realm…</p>
      : linked.invalid ? <div className={styles.empty}><p>The realm in this link is unavailable. Choose a realm in the navigation to continue.</p>
        {linked.realm.status === "ready" && <button type="button" onClick={() => updateHistoryQuery({ realm: null })} className="min-h-11 px-2 text-accent underline">Use selected realm</button>}
      </div>
      : <>
        {hasRealmListings && <div hidden={view !== "offers"}><GearMarket key={item.id} item={item} /></div>}
        {(!hasRealmListings || view === "history") && <ItemHistory key={item.id} item={item} />}
      </>}
  </div>;
}
