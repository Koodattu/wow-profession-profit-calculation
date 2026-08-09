export type HistoryRange = "24h" | "7d" | "14d" | "30d" | "6m" | "1y" | "all";

export const HISTORY_RANGES: Array<{ value: HistoryRange; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "6m", label: "6m" },
  { value: "1y", label: "1y" },
  { value: "all", label: "All" },
];
