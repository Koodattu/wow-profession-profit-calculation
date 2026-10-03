export type HistoryRange = "24h" | "7d" | "14d" | "30d" | "6m" | "1y" | "all";

export function isDailyHistoryRange(range: HistoryRange): boolean {
  return range === "6m" || range === "1y" || range === "all";
}

export function formatHistoryTime(input: string | number, range: HistoryRange): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  const daily = isDailyHistoryRange(range);
  const label = date.toLocaleDateString("en-GB", { timeZone: daily ? "UTC" : undefined }).replaceAll("/", ".");
  return daily ? label : `${label} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export const HISTORY_RANGES: Array<{ value: HistoryRange; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "6m", label: "6m" },
  { value: "1y", label: "1y" },
  { value: "all", label: "All" },
];
