"use client";

import { useMemo, type ReactNode } from "react";
import { formatHistoryTime, isDailyHistoryRange, type HistoryRange } from "@/lib/time-ranges";
import { ComposedChart, Line, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

interface ChartPoint {
  time: string;
  [key: string]: number | string | null;
}

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  type?: "line" | "bar";
  formatValue?: (value: number) => string;
  dash?: string;
}

interface Props {
  range: HistoryRange;
  data: ChartPoint[];
  series: ChartSeries[];
  formatValue: (value: number) => string;
  title?: string;
  compact?: boolean;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatAxisDate(value: unknown, range: HistoryRange): string {
  const date = new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  if (range === "24h") return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: range === "all" || range === "1y" ? "numeric" : undefined,
    timeZone: isDailyHistoryRange(range) ? "UTC" : undefined,
  }).replaceAll("/", ".");
}

function CustomTooltipContent({
  active,
  payload,
  label,
  formatValue,
  series,
  range,
}: {
  active?: boolean;
  payload?: Array<{ value?: unknown; name?: unknown; color?: string; dataKey?: unknown; payload?: { missingObservation?: number } }>;
  label?: unknown;
  formatValue: (value: number) => string;
  series: ChartSeries[];
  range: HistoryRange;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        color: "var(--foreground)",
        padding: "8px 10px",
      }}
    >
      <p style={{ color: "var(--muted)", marginBottom: 6 }}>{formatHistoryTime(typeof label === "number" ? label : String(label ?? ""), range)}</p>
      {payload[0]?.payload?.missingObservation ? <p>No observation recorded</p> :
      payload.map((entry, index) => {
        const parsed = parseNumericValue(entry.value);
        const dataKey = typeof entry.dataKey === "string" ? entry.dataKey : "";
        const matchingSeries = series.find((item) => item.key === dataKey);
        const valueFormatter = matchingSeries?.formatValue ?? formatValue;
        const valueLabel = parsed === null ? "—" : valueFormatter(parsed);
        const nameLabel = entry.name ? String(entry.name) : "Value";

        return (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: index === 0 ? 0 : 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: entry.color ?? "var(--muted)", display: "inline-block" }} />
            <span style={{ color: "var(--foreground)", minWidth: 90 }}>{nameLabel}</span>
            <span style={{ color: "var(--foreground)" }}>{valueLabel}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function HistoryLineChart({ data, series, formatValue, title, range, compact = false }: Props) {
  const plot = useMemo(() => {
    const observations = data.map((point) => ({ ...point, timestamp: new Date(point.time).getTime() }))
      .filter((point) => Number.isFinite(point.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
    const interval = (isDailyHistoryRange(range) ? 24 : 1) * 3_600_000;
    const points: Array<ChartPoint & { timestamp: number }> = [];
    for (const point of observations) {
      const previous = points.at(-1);
      if (previous && point.timestamp - previous.timestamp > interval * 1.5) {
        // One explicit empty point breaks the line without manufacturing observations.
        points.push({ ...Object.fromEntries(series.map((item) => [item.key, null])),
          time: "", timestamp: previous.timestamp + interval, missingObservation: 1 });
      }
      points.push(point);
    }
    const first = observations[0]?.timestamp ?? 0;
    const last = observations.at(-1)?.timestamp ?? first;
    const count = Math.min(5, observations.length);
    const ticks = count < 2 ? [first] : Array.from({ length: count }, (_, index) => first + (last - first) * index / (count - 1));
    return { points, ticks };
  }, [data, range, series]);
  const legend: ReactNode = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((line) => (
        <div key={line.key} className="flex items-center gap-1.5">
          <svg width="20" height="10" aria-hidden="true"><line x1="0" y1="5" x2="20" y2="5" stroke={line.color} strokeWidth={line.type === "bar" ? 6 : 2} strokeDasharray={line.dash} /></svg>
          <span>{line.label}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        {title ? <h3 className="text-sm text-muted mb-0">{title}</h3> : <div />}
        {legend}
      </div>
      <div className={compact ? "h-36" : "h-64 sm:h-72"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={plot.points} title={title ?? "Historical observations"} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={plot.ticks}
              tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(value) => formatAxisDate(value, range)} minTickGap={24} />
            <YAxis
              yAxisId="left"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickFormatter={(value) => {
                const parsed = parseNumericValue(value);
                if (parsed === null) return "—";
                return formatValue(parsed);
              }}
              width={68} tickCount={compact ? 3 : 5}
            />
            <Tooltip filterNull={false} content={<CustomTooltipContent formatValue={formatValue} series={series} range={range} />} />
            {series.map((item) => {
              if (item.type === "bar") {
                return <Bar key={item.key} yAxisId="left" dataKey={item.key} name={item.label} fill={item.color} fillOpacity={0.55} isAnimationActive={false} />;
              }

              return <Line key={item.key} yAxisId="left" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2}
                strokeDasharray={item.dash} dot={{ r: 1.5, fill: item.color, strokeWidth: 0 }} type="linear" isAnimationActive={false} />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
