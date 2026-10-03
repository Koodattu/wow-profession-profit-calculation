import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { formatPrice } from "@/lib/api";
import HistoryLineChart from "./HistoryLineChart";

beforeEach(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 288, width: 640, height: 288, toJSON() {} };
  // jsdom has no layout; text must measure smaller than the chart container.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "SPAN" ? { ...rect, width: (this.textContent?.length ?? 0) * 7, height: 12 } : rect;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("the keyboard tooltip uses the quantity formatter even when quantity is zero", async () => {
  render(<HistoryLineChart range="24h" data={[10, 11].map((hour) => ({
    time: new Date(2026, 9, 3, hour).toISOString(), price: 10000, quantity: 0,
  }))} series={[
    { key: "price", label: "Price", color: "gold" },
    { key: "quantity", label: "Quantity", color: "blue", axis: "right", formatValue: (value) => `${value} units` },
  ]} formatValue={formatPrice} />);
  fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowRight" });
  expect(screen.getAllByText("Quantity")).toHaveLength(2);
  expect(await screen.findByText("0 units")).toBeVisible();
});

test("hourly observations have distinct time labels and a dated tooltip", async () => {
  render(<HistoryLineChart range="24h" data={[10, 11].map((hour) => ({
    time: new Date(2026, 9, 3, hour).toISOString(), price: 10000,
  }))} series={[{ key: "price", label: "Price", color: "gold" }]} formatValue={formatPrice} />);
  expect(screen.getByText("10:00")).toBeVisible();
  expect(screen.getByText("11:00")).toBeVisible();
  fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowRight" });
  expect(await screen.findByText(/03\.10\.2026 (10|11):00/)).toBeVisible();
});

test("daily summaries keep their UTC calendar date and distinguish years", async () => {
  vi.stubEnv("TZ", "America/Los_Angeles");
  const { container } = render(<HistoryLineChart range="all" data={["2025-10-03", "2026-10-03"].map((time) => ({ time, price: 10000 }))}
    series={[{ key: "price", label: "Price", color: "gold" }]} formatValue={formatPrice} />);
  const chart = within(container);
  expect(chart.getByText("03.10.2025")).toBeVisible();
  expect(chart.getByText("03.10.2026")).toBeVisible();
  fireEvent.focus(screen.getByRole("application"));
  fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowRight" });
  expect(await chart.findByText("03.10.2026", { selector: "p" })).toBeVisible();
  expect(screen.queryByText(/00:00/)).toBeNull();
});

test("an unavailable quote leaves a gap between known prices", async () => {
  const { container } = render(<HistoryLineChart range="24h" data={[10000, 20000, null, 40000, 50000].map((price, hour) => ({
    time: new Date(2026, 9, 3, hour).toISOString(), price,
  }))} series={[{ key: "price", label: "Price", color: "gold" }]} formatValue={formatPrice} />);
  // Each SVG Move command starts a separate visible line segment.
  await waitFor(() => expect(container.querySelector(".recharts-line-curve")?.getAttribute("d")?.match(/M/g)).toHaveLength(2));
});
