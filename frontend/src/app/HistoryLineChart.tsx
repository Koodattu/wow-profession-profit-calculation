"use client";

import type { ReactNode } from "react";
import { isDailyHistoryRange, type HistoryRange } from "@/lib/time-ranges";
import { ComposedChart, Line, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

interface ChartPoint {
  time: string;
  [key: string]: number | string | null;
}

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  axis?: "left" | "right";
  type?: "line" | "bar";
  formatValue?: (value: number) => string;
}

interface Props {
  range: HistoryRange;
  data: ChartPoint[];
  series: ChartSeries[];
  formatValue: (value: number) => string;
  title?: string;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatTimeLabel(input: string, range: HistoryRange): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const daily = isDailyHistoryRange(range);
  const label = date.toLocaleDateString("en-GB", { timeZone: daily ? "UTC" : undefined }).replaceAll("/", ".");
  return daily ? label : `${label} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatAxisDate(value: unknown, range: HistoryRange): string {
  const date = new Date(String(value));
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
  payload?: Array<{ value?: unknown; name?: unknown; color?: string; dataKey?: unknown }>;
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
      <p style={{ color: "var(--muted)", marginBottom: 6 }}>{formatTimeLabel(String(label ?? ""), range)}</p>
      {payload.map((entry, index) => {
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

export default function HistoryLineChart({ data, series, formatValue, title, range }: Props) {
  const hasRightAxis = series.some((item) => (item.axis ?? "left") === "right");
  const legend: ReactNode = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((line) => (
        <div key={line.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
          <span>{line.label}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="w-full">
      <div className="mb-2 flex items-start justify-between gap-3">
        {title ? <h3 className="text-sm text-muted mb-0">{title}</h3> : <div />}
        {legend}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: hasRightAxis ? 28 : 16, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="time" tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(value) => formatAxisDate(value, range)} minTickGap={24} />
            <YAxis
              yAxisId="left"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickFormatter={(value) => {
                const parsed = parseNumericValue(value);
                if (parsed === null) return "—";
                return formatValue(parsed);
              }}
              width={84}
            />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickFormatter={(value) => {
                  const parsed = parseNumericValue(value);
                  if (parsed === null) return "—";
                  return parsed.toLocaleString();
                }}
                width={66}
              />
            )}
            <Tooltip content={<CustomTooltipContent formatValue={formatValue} series={series} range={range} />} />
            {series.map((item) => {
              const yAxisId = item.axis ?? "left";

              if (item.type === "bar") {
                return <Bar key={item.key} yAxisId={yAxisId} dataKey={item.key} name={item.label} fill={item.color} fillOpacity={0.35} />;
              }

              return <Line key={item.key} yAxisId={yAxisId} dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2} dot={false} type="monotone" />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
