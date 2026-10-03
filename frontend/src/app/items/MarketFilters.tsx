"use client";

import { useState, type FormEvent } from "react";
import { useItemFilterOptions } from "@/features/item-browser";
import { copperToGold, FILTER_KEYS, goldToCopper, RARITY_OPTIONS, SORT_OPTIONS } from "@/lib/market-filters";
import styles from "./Items.module.css";

type Change = (values: Record<string, string | null>) => void;
const labels: Record<string, string> = {
  search: "Search", searchMode: "Match", type: "Market", category: "Category", subcategory: "Subcategory", slot: "Slot",
  rarity: "Rarity", rank: "Rank", usage: "Crafting use", profession: "Profession", availability: "Availability",
  minPrice: "Min price", maxPrice: "Max price", minQuantity: "Min quantity", maxQuantity: "Max quantity", sort: "Sort",
};
const valueLabels: Record<string, string> = {
  commodity: "Commodities", realm: "Realm items", exact: "Exact name", reagent: "Reagents", crafted: "Crafted outputs",
  listed: "In stock", unlisted: "Not listed", none: "Unranked", unknown: "Unknown",
};
const displayValue = (value: string) => Object.hasOwn(valueLabels, value) ? valueLabels[value] : value;

export default function MarketFilters({ params, onChange, onClear }: { params: URLSearchParams; onChange: Change; onClear: () => void }) {
  const options = useItemFilterOptions();
  const advancedKeys = ["subcategory", "slot", "rarity", "rank", "usage", "profession", "searchMode", "minPrice", "maxPrice", "minQuantity", "maxQuantity"];
  const [open, setOpen] = useState(advancedKeys.some(key => params.has(key)));
  const category = params.get("category") ?? "";
  const categories = options.data?.categories ?? [];
  const subcategories = categories.find(option => option.name === category)?.subcategories ?? [];
  const defaults: Record<string, string> = { type: "all", usage: "all", availability: "all", searchMode: "contains", sort: "name-asc" };
  const active = FILTER_KEYS.filter(key => params.has(key) && params.get(key) && params.get(key) !== defaults[key]);

  function choice(label: string, key: string, choices: ReadonlyArray<readonly [string, string]>, empty = "Any", disabled = false) {
    const value = params.get(key) ?? "";
    return <label className={styles.filterField}>
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={event => onChange({ [key]: event.target.value || null, ...(key === "category" ? { subcategory: null } : {}) })}>
        <option value="">{empty}</option>
        {value && !choices.some(([id]) => id === value) && <option value={value}>{displayValue(value)}</option>}
        {choices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>;
  }

  function describe(key: string) {
    const value = params.get(key)!;
    if (key === "minPrice" || key === "maxPrice") return `${copperToGold(value)}g`;
    if (key === "rarity") return RARITY_OPTIONS.find(([id]) => id === value)?.[1] ?? value;
    if (key === "sort") return SORT_OPTIONS.find(([id]) => id === value)?.[1] ?? value;
    if (key === "profession") return options.data?.professions?.find(option => String(option.id) === value)?.name ?? value;
    return ["type", "searchMode", "usage", "availability", "rank"].includes(key) ? displayValue(value) : value;
  }

  return <section className={styles.filters} aria-label="Market filters">
    <div className={styles.filterPrimary}>
      {choice("Category", "category", [...categories.map(option => [option.name, option.name] as const), ["unknown", "Uncategorized"]], "All categories")}
      {choice("Availability", "availability", [["listed", "In stock"], ["unlisted", "Not listed"]], "All items")}
      {choice("Sort by", "sort", SORT_OPTIONS.filter(([id]) => id !== "name-asc"), "Name: A–Z")}
      <button type="button" className={styles.filterToggle} aria-expanded={open} aria-controls="more-market-filters" onClick={() => setOpen(value => !value)}>
        More filters{advancedKeys.some(key => params.has(key)) ? ` (${advancedKeys.filter(key => params.has(key)).length})` : ""}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </div>
    {options.failed && <p className="mt-3 text-sm text-muted" role="alert">Category options couldn’t load. Other filters still work. <button type="button" className="min-h-11 px-2 text-accent underline" onClick={options.retry}>Retry filter options</button></p>}
    <div id="more-market-filters" hidden={!open}>
      <div className={styles.filterGrid}>
        {choice("Subcategory", "subcategory", subcategories.map(value => [value, value]), category && category !== "unknown" ? "All subcategories" : "Choose a category first", !category || category === "unknown")}
        {choice("Equipment slot", "slot", (options.data?.slots ?? []).map(value => [value, value]), "Any slot")}
        {choice("Rarity", "rarity", RARITY_OPTIONS, "Any rarity")}
        {choice("Crafting rank", "rank", [["1", "Rank 1"], ["2", "Rank 2"], ["3", "Rank 3"], ["4", "Rank 4"], ["5", "Rank 5"], ["none", "Unranked"]], "Any rank")}
        {choice("Crafting use", "usage", [["reagent", "Reagents"], ["crafted", "Crafted outputs"]], "Any use")}
        {choice("Profession catalog", "profession", (options.data?.professions ?? []).map(option => [String(option.id), option.name.startsWith(`${option.expansion} `) ? option.name : `${option.expansion} ${option.name}`]), "Any profession")}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">Profession filters cover known reagents and outputs in the imported catalog. Category and slot filters use available item metadata.</p>
      <label className="mt-3 flex min-h-11 w-fit items-center gap-2 text-sm">
        <input type="checkbox" checked={params.get("searchMode") === "exact"} onChange={event => onChange({ searchMode: event.target.checked ? "exact" : null })} className="size-4 accent-accent" />
        Match the exact item name
      </label>
      <RangeFilters key={["minPrice", "maxPrice", "minQuantity", "maxQuantity"].map(key => params.get(key)).join(":")} params={params} onChange={onChange} />
    </div>
    {active.length > 0 && <div className={styles.activeFilters} role="region" tabIndex={0} aria-label="Active filters">
      {active.map(key => <button type="button" key={key} aria-label={`Remove ${labels[key]}: ${describe(key)}`} onClick={() => onChange({ [key]: null, ...(key === "category" ? { subcategory: null } : {}) })}>
        <span>{labels[key]}: {describe(key)}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>)}
      <button type="button" onClick={onClear} className={styles.clearFilters}>Clear filters</button>
    </div>}
  </section>;
}

function RangeFilters({ params, onChange }: { params: URLSearchParams; onChange: Change }) {
  const [minPrice, setMinPrice] = useState(copperToGold(params.get("minPrice")));
  const [maxPrice, setMaxPrice] = useState(copperToGold(params.get("maxPrice")));
  const [minQuantity, setMinQuantity] = useState(params.get("minQuantity") ?? "");
  const [maxQuantity, setMaxQuantity] = useState(params.get("maxQuantity") ?? "");
  const [error, setError] = useState("");
  function apply(event: FormEvent) {
    event.preventDefault();
    try {
      const min = goldToCopper(minPrice);
      const max = goldToCopper(maxPrice);
      if (min !== null && max !== null && Number(min) > Number(max)) throw new Error("Minimum price must not exceed maximum price.");
      for (const quantity of [minQuantity, maxQuantity]) {
        if (quantity && (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)))) throw new Error("Quantities must be non-negative whole numbers.");
      }
      if (minQuantity && maxQuantity && Number(minQuantity) > Number(maxQuantity)) throw new Error("Minimum quantity must not exceed maximum quantity.");
      setError("");
      onChange({ minPrice: min, maxPrice: max, minQuantity: minQuantity || null, maxQuantity: maxQuantity || null });
    } catch (cause) { setError((cause as Error).message); }
  }
  return <form onSubmit={apply} className={styles.rangeFilters} aria-label="Price and quantity ranges">
    <div className={styles.filterGrid}>
      {([
        ["Minimum price (gold)", minPrice, setMinPrice, "decimal"], ["Maximum price (gold)", maxPrice, setMaxPrice, "decimal"],
        ["Minimum quantity", minQuantity, setMinQuantity, "numeric"], ["Maximum quantity", maxQuantity, setMaxQuantity, "numeric"],
      ] as const).map(([label, value, setValue, inputMode]) => <label key={label} className={styles.filterField}>
        <span>{label}</span><input value={value} onChange={event => setValue(event.target.value)} inputMode={inputMode} maxLength={24} placeholder="No limit" aria-describedby={error ? "market-range-error" : undefined} />
      </label>)}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-background hover:bg-accent-hover">Apply ranges</button>
      <p className="text-xs leading-5 text-muted">Price is the lowest listing per item, in gold. Quantity is the total listed supply.</p>
    </div>
    {error && <p id="market-range-error" role="alert" className="mt-3 text-sm text-negative">{error}</p>}
  </form>;
}
