"use client";

import { HISTORY_RANGES, type HistoryRange } from "@/lib/time-ranges";

interface Props {
  value: HistoryRange;
  onChange: (next: HistoryRange) => void;
}

export default function TimeRangeTabs({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {HISTORY_RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`px-2.5 py-1 rounded-md text-xs transition-colors border ${
            range.value === value ? "bg-accent text-background border-accent" : "bg-card text-muted border-border hover:text-foreground hover:bg-card-hover"
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
