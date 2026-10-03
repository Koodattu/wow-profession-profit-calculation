"use client";

import { useId, useState } from "react";
import { formatHistoryTime, type HistoryRange } from "@/lib/time-ranges";

type Cell = number | string | boolean | null | undefined;
interface RecordRow { time: string; [key: string]: Cell }
export interface HistoryColumn {
  key: string;
  label: string;
  csvLabel: string;
  format?: (value: NonNullable<Cell>) => string;
}

function csvCell(value: Cell): string {
  let text = value == null ? "" : String(value);
  // Item and realm names are external text, never spreadsheet formulas.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function HistoryRecords({ rows, columns, range, filename, context, label = "Price observations" }: {
  rows: RecordRow[];
  columns: HistoryColumn[];
  range: HistoryRange;
  filename: string;
  context: Record<string, string | number>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const id = useId();
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const pages = Math.ceil(ordered.length / 25);
  const currentPage = Math.min(page, pages - 1);
  const contextKeys = Object.keys(context);
  const csv = open ? [
    [...contextKeys, "time_utc", ...columns.map((column) => column.csvLabel)],
    ...ordered.map((row) => [...contextKeys.map((key) => context[key]), row.time, ...columns.map((column) => row[column.key])]),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n") : "";

  return <div className="mt-5 border-t border-border pt-2 text-sm">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
      className="min-h-11 text-accent hover:underline">{open ? "Hide" : "View"} observations ({rows.length.toLocaleString()})</button>
    {open && <div id={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <p>Exact values in the CSV use copper. Blank cells mean unavailable.</p>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download={`${filename}.csv`}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-accent hover:bg-card-hover">Download CSV</a>
      </div>
      <div className="max-w-full overflow-x-auto" role="region" aria-label={`${label}, scroll to compare columns`} tabIndex={0}>
        <table className="w-full text-right text-xs" aria-label={label}>
          <thead><tr className="border-b border-border text-muted"><th scope="col" className="whitespace-nowrap px-3 py-3 text-left">Time</th>
            {columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{column.label}</th>)}
          </tr></thead>
          <tbody>{ordered.slice(currentPage * 25, (currentPage + 1) * 25).map((row) => <tr key={row.time} className="border-b border-border/60">
            <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-normal">{formatHistoryTime(row.time, row.resolution === "current" ? "24h" : range)}</th>
            {columns.map((column) => { const value = row[column.key]; return <td key={column.key} className="whitespace-nowrap px-3 py-3">
              {value == null ? <span className="text-muted">Unavailable</span> : column.format ? column.format(value) : typeof value === "number" ? value.toLocaleString() : String(value)}
            </td>; })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <button type="button" aria-label="Previous observations" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}
          className="min-h-11 px-3 text-foreground disabled:opacity-40">Previous</button>
        <span>Page {currentPage + 1} of {pages} · newest first</span>
        <button type="button" aria-label="Next observations" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}
          className="min-h-11 px-3 text-foreground disabled:opacity-40">Next</button>
      </div>
    </div>}
  </div>;
}
