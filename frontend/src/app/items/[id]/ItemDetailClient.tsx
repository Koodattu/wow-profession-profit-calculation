"use client";

import Link from "next/link";
import { useState } from "react";
import { formatPrice, type Item } from "@/lib/api";
import TimeRangeTabs from "@/app/TimeRangeTabs";
import HistoryLineChart from "@/app/HistoryLineChart";
import type { HistoryRange } from "@/lib/time-ranges";
import { useItemDetail } from "@/features/item-detail";
import { useSelectedRealm } from "@/lib/selected-realm";
import GearMarket from "./GearMarket";
import styles from "./ItemMarket.module.css";

export default function ItemDetailClient({ item }: { item: Item }) {
  const [view, setView] = useState<"offers" | "history">("offers");
  const hasRealmListings = item.marketType === "realm";

  return <div className={styles.page}>
    <Link href="/items" className={styles.breadcrumb}>← Back to market</Link>
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
    {hasRealmListings && <div hidden={view !== "offers"}><GearMarket key={item.id} item={item} /></div>}
    {(!hasRealmListings || view === "history") && <ItemHistory key={item.id} item={item} />}
  </div>;
}

function ItemHistory({ item }: { item: Item }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const dailyHistory = range === "6m" || range === "1y" || range === "all";
  const detail = useItemDetail(item, range);
  const realm = useSelectedRealm();
  const realmName = realm.options.find((option) => option.id === detail.connectedRealmId)?.label;
  const realmHistory = item.marketType === "realm";
  const { prices } = detail;
  const latestPrice = prices[0];
  const chartData = [...prices].reverse().map((point) => ({ time: point.time, median: point.median_price, average: point.avg_price, min: point.min_price, quantity: point.total_quantity }));

  return <section className={styles.history} aria-label="Price history">
    <div className={styles.historyHeader}><h2>Price history · {realmHistory ? realmName ?? "Select a realm" : "EU commodities"}</h2><TimeRangeTabs value={range} onChange={setRange} /></div>
    {realmHistory && <p className={styles.footnote}>History combines all item versions on this realm. The filters in Buyout listings don’t apply here.</p>}
    {detail.status === "selection-required" ? <div className={styles.empty}>Choose a realm in the navigation to view its price history.</div>
      : detail.status === "error" ? <div className={styles.empty} role="alert">Couldn’t load price history. Try another time range or reload the page.</div>
      : detail.status === "loading" ? <div className={styles.empty} role="status">Loading price history…</div>
      : <>
        {latestPrice && (!realmHistory || chartData.length > 1) && <>
          <div className={styles.historyStats}>
            <PriceStat label={dailyHistory ? "Latest daily low" : "Latest low"} value={latestPrice.min_price} />
            <PriceStat label={dailyHistory ? "Latest daily average" : "Latest average"} value={latestPrice.avg_price} />
            {!dailyHistory && latestPrice.median_price !== null ? <PriceStat label="Latest median" value={latestPrice.median_price} /> : <PriceStat label={dailyHistory ? "Latest daily high" : "Latest high"} value={latestPrice.max_price} />}
            <div><span>{dailyHistory ? "Average units available" : "Units available"}</span><strong>{latestPrice.total_quantity?.toLocaleString() ?? "—"}</strong></div>
          </div>
        </>}{chartData.length > 1 ? <>
          <HistoryLineChart data={chartData} series={[
            ...(!dailyHistory && prices.some((point) => point.median_price !== null) ? [{ key: "median", label: "Median", color: "var(--accent)" }] : []),
            { key: "average", label: "Average", color: "#f59e0b" },
            { key: "min", label: "Min", color: "var(--positive)" },
            { key: "quantity", label: "Quantity", color: "#3da3d4", axis: "right", type: "bar", formatValue: (value) => Math.round(value).toLocaleString() },
          ]} formatValue={formatPrice} />
          <p className={styles.footnote}>Averages are weighted by listed quantity. Six-month and longer ranges use daily summaries.</p>
          {range === "24h" && <details className={styles.historyRecords}><summary>View hourly observations</summary><table><thead><tr><th>Time</th><th>Lowest</th><th>Average</th><th>Quantity</th></tr></thead><tbody>{prices.slice(0, 24).map((point) => <tr key={point.time}>
            <td>{new Date(point.time).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</td><td>{point.min_price !== null ? formatPrice(point.min_price) : "—"}</td><td>{point.avg_price !== null ? formatPrice(point.avg_price) : "—"}</td><td>{point.total_quantity?.toLocaleString() ?? "—"}</td>
          </tr>)}</tbody></table></details>}
        </> : <div className={styles.empty}><h3>No price history to chart yet</h3><p>{realmHistory && !item.isReagent && !item.isCraftedOutput ? "We currently keep price history for profession items. This item’s current offers are available in Buyout listings." : "There aren’t enough observations in this time range. Try a longer range or check back after the next refresh."}</p></div>}
      </>}
  </section>;
}

function PriceStat({ label, value }: { label: string; value: number | null }) {
  return <div><span>{label}</span><strong>{value !== null ? formatPrice(value) : "—"}</strong></div>;
}
