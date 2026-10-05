// Explicit opt-in config; not part of the ordinary frontend test discovery.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, expect, test } from "vitest";
import HistoryRecords from "../../src/app/HistoryRecords";

const directory = resolve(process.env.COMMODITY_PACKING_RESULTS ?? "../backups/commodity-packing-20261005");
const dataset = process.env.COMMODITY_PACKING_DATASET ?? "synthetic";
type Point = { time: string; [key: string]: string | number | boolean | null };
const fields = ["min_price","avg_price","median_price","max_price","total_quantity"];

const timings: Record<string, number[]> = { baseline: [],candidate: [] };
afterEach(cleanup);
afterAll(() => writeFileSync(resolve(directory,`${dataset}-csv-timing.json`),JSON.stringify(timings,null,2)));

// Separate iterations keep correctness checks within the normal test timeout;
// the benchmark still has two warmups and seven measured, alternating pairs.
test.each(Array.from({length: 9},(_,run) => run))("full-record CSV matches in benchmark round %i", (run) => {
  const results: Record<string, string> = {};
  for (const kind of run%2 ? ["candidate","baseline"] : ["baseline","candidate"]) {
      const rows: Point[] = JSON.parse(readFileSync(resolve(directory,`${dataset}-packing_${kind}-chart.json`),"utf8"));
      const started = performance.now();
      render(createElement(HistoryRecords,{ rows,columns: fields.map(key => ({key,label: key,csvLabel: key})),
        range: "30d",filename: "packing-check",context: { region: "eu" } }));
      fireEvent.click(screen.getByRole("button",{name: /View observations/}));
      const href = screen.getByRole("link",{name: "Download CSV"}).getAttribute("href")!;
      results[kind] = decodeURIComponent(href.slice(href.indexOf(",")+1));
      if (run>=2) timings[kind]!.push(performance.now()-started);
      expect(results[kind]!.split("\r\n")).toHaveLength(rows.length+1);
      cleanup();
  }
  expect(results.baseline === results.candidate).toBe(true);
});
