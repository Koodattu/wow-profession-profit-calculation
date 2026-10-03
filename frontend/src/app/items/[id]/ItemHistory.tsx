"use client";

import { useSearchParams } from "next/navigation";
import { formatPrice, type Item } from "@/lib/api";
import TimeRangeTabs from "@/app/TimeRangeTabs";
import HistoryLineChart from "@/app/HistoryLineChart";
import HistoryRecords, { type HistoryColumn } from "@/app/HistoryRecords";
import HistoryLink from "@/app/HistoryLink";
import { formatHistoryTime, isDailyHistoryRange } from "@/lib/time-ranges";
import { updateHistoryQuery, useHistoryRange } from "@/lib/history-view";
import { useItemDetail } from "@/features/item-detail";
import { useSelectedRealm } from "@/lib/selected-realm";
import styles from "./ItemMarket.module.css";

const measures = {
  lowest: { key: "min_price", label: "Lowest listing", color: "var(--accent)" },
  average: { key: "avg_price", label: "Quantity-weighted average", color: "var(--chart-secondary)", dash: "2 3" },
  median: { key: "median_price", label: "Median listing", color: "var(--foreground)", dash: "5 4" },
} as const;
type Measure = keyof typeof measures;
const money = (value: string | number | boolean) => formatPrice(Number(value));

export default function ItemHistory({ item }: { item: Item }) {
  const realmHistory = item.marketType === "realm";
  const { range, setRange } = useHistoryRange(realmHistory);
  const query = useSearchParams();
  const selected = query?.get("measure");
  const compare = selected === "compare";
  const measure: Measure = selected === "average" || selected === "median" ? selected : "lowest";
  const detail = useItemDetail(item, range);
  const realm = useSelectedRealm();
  const scope = realmHistory ? realm.options.find((option) => option.id === detail.connectedRealmId)?.label ?? "Select a realm" : "EU commodities";
  const prices = [...detail.prices].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const latest = prices[0];
  const first = prices.at(-1);
  const currentOnly = latest?.resolution === "current";
  const daily = !currentOnly && isDailyHistoryRange(range);
  const selectedMeasure = measures[measure];
  const latestValue = latest?.[selectedMeasure.key] ?? null;
  const firstValue = first?.[selectedMeasure.key] ?? null;
  const change = prices.length > 1 && latestValue !== null && firstValue !== null ? latestValue - firstValue : null;
  const percent = change !== null && firstValue !== null && firstValue > 0 ? change / firstValue * 100 : null;
  const chartData = prices.map((point) => ({ time: point.time, min_price: point.min_price,
    avg_price: point.avg_price, median_price: point.median_price, quantity: point.total_quantity }));
  const selectedSeries = compare ? [measures.lowest, measures.average, ...(!daily && prices.some((point) => point.median_price !== null) ? [measures.median] : [])] : [selectedMeasure];
  const columns: HistoryColumn[] = [
    { key: "min_price", label: daily ? "Daily low" : "Lowest", csvLabel: "lowest_copper", format: money },
    { key: "avg_price", label: "Weighted average", csvLabel: "weighted_average_copper", format: money },
    ...(!daily ? [{ key: "median_price", label: "Median", csvLabel: "median_copper", format: money }] : []),
    { key: "max_price", label: daily ? "Daily high" : "Highest", csvLabel: "highest_copper", format: money },
    { key: "total_quantity", label: daily ? "Average units" : "Units available", csvLabel: daily ? "average_units_available" : "units_available" },
    ...(daily ? [
      { key: "sample_count", label: "Samples", csvLabel: "sample_count" },
      { key: "average_is_exact", label: "Average precision", csvLabel: "average_is_exact", format: (value: string | number | boolean) => value ? "Exact" : "Approximate" },
    ] : []),
  ];

  function setMeasure(value: string) {
    updateHistoryQuery({ measure: value === "lowest" ? null : value,
      ...(realmHistory && detail.connectedRealmId !== null ? { realm: String(detail.connectedRealmId) } : {}) });
  }

  return <section className={styles.history} aria-label="Price history">
    <div className={styles.historyHeader}>
      <h2>Price history · {scope}</h2><TimeRangeTabs value={range} onChange={setRange} />
    </div>
    {realmHistory && <p className={styles.footnote}>History combines all item versions on this realm. The filters in Buyout listings don’t apply here.</p>}
    {detail.status === "selection-required" ? <div className={styles.empty}>Choose a realm in the navigation to view its price history.</div>
      : detail.status === "error" ? <div className={styles.empty} role="alert"><p>Couldn’t load price history.</p><button type="button" className={`${styles.action} min-h-11`} onClick={detail.retry}>Retry history</button></div>
      : detail.status === "loading" ? <div className={styles.empty} role="status">Loading price history…</div>
      : <>
        {detail.status === "refresh-error" && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm" role="alert">
          <p className="text-negative">Couldn’t refresh. Showing previously loaded history.</p>
          <button type="button" className={`${styles.action} min-h-11`} onClick={detail.retry}>Retry history</button>
        </div>}
        {latest && <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <label className="flex flex-wrap items-center gap-3 text-sm text-muted">Price measure
              <select value={compare ? "compare" : measure} onChange={(event) => setMeasure(event.target.value)}
                className="min-h-11 max-w-full rounded-lg border border-border bg-background px-3 text-foreground">
                <option value="lowest">Lowest listing</option><option value="average">Weighted average</option>
                <option value="median">Median listing</option><option value="compare">Compare prices</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              <HistoryLink connectedRealmId={detail.connectedRealmId} />
              <button type="button" className="min-h-11 px-2 text-sm text-accent hover:underline" onClick={detail.retry}>Refresh history</button>
            </div>
          </div>
          <div className={styles.historyStats} role="region" aria-label="History summary">
            <div><span>{currentOnly ? "Current quote" : daily ? "Latest daily value" : "Latest observation"} · {selectedMeasure.label.toLowerCase()}</span><strong>{latestValue === null ? "Unavailable" : formatPrice(latestValue)}</strong></div>
            <div><span>First recorded in range</span><strong>{firstValue === null || prices.length < 2 ? "—" : formatPrice(firstValue)}</strong></div>
            <div><span>Change · first to latest</span><strong>{change === null ? "—" : `${change > 0 ? "+" : ""}${formatPrice(change)}`}</strong>
              {percent !== null && <small className="ml-2 text-muted">{percent > 0 ? "+" : ""}{percent.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%</small>}
            </div>
            <div><span>{daily ? "Latest average units available" : "Latest units available"}</span><strong>{latest.total_quantity?.toLocaleString() ?? "Unavailable"}</strong></div>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-muted">
            {currentOnly ? `Current quote observed ${formatHistoryTime(latest.time, "24h")}. No historical observations in this range.`
              : `${prices.length.toLocaleString()} ${daily ? "daily summaries" : "hourly observations"} · ${formatHistoryTime(first!.time, range)}${prices.length > 1 ? ` to ${formatHistoryTime(latest.time, range)}` : ""}.`}
            {daily ? " Daily dates are UTC." : ` Times: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}
          </p>
          {daily && prices.some((point) => point.average_is_exact === false) && <p className="mb-4 text-sm text-muted">Some daily averages are approximate because older observations lack exact value totals. See precision and sample counts in the observations.</p>}
        </>}
        {prices.length > 1 && !currentOnly ? <>
          {measure === "median" && !compare && prices.every((point) => point.median_price === null)
            ? <p className={styles.empty}>Median prices are unavailable in this range. Choose Lowest listing or Weighted average.</p>
            : <HistoryLineChart range={range} data={chartData} series={selectedSeries} formatValue={formatPrice} title={compare ? "Listing prices · per item" : `${selectedMeasure.label} · per item`} />}
          <div className="mt-5 border-t border-border pt-4">
            <HistoryLineChart range={range} data={chartData} series={[{ key: "quantity", label: daily ? "Average units available" : "Units available", color: "var(--chart-secondary)", type: "bar" }]}
              formatValue={(value) => Math.round(value).toLocaleString()} title={daily ? "Average listed supply · units" : "Listed supply · units"} compact />
          </div>
          <p className={styles.footnote}>Listed prices and supply, not completed sales. Averages are weighted by listed quantity. Gaps have no recorded observation.{daily ? " Each daily low and high can occur at different times; available units are averaged across that day’s samples." : " Each hour shows its last recorded observation."}</p>
        </> : <div className={styles.empty}><h3>No price history to chart yet</h3><p>{realmHistory && !item.isReagent && !item.isCraftedOutput ? "We currently keep price history for profession items. This item’s current offers are available in Buyout listings." : "There aren’t enough historical observations in this time range. Try a longer range or check back after the next refresh."}</p></div>}
        <HistoryRecords key={`${item.id}:${range}:${detail.connectedRealmId}`} rows={prices.map((point) => ({ ...point }))}
          columns={columns} range={range} filename={`copper-item-${item.id}-${realmHistory ? detail.connectedRealmId : "eu"}-${range}`}
          context={{ item_id: item.id, region: "eu", market: realmHistory ? "realm" : "commodity", connected_realm_id: detail.connectedRealmId ?? "", resolution: currentOnly ? "current" : daily ? "daily" : "hourly" }} />
      </>}
  </section>;
}
