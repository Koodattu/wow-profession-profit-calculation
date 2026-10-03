import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Item } from "@/lib/api";
import { selectedRealm } from "@/lib/selected-realm";
import NavSettings from "@/app/NavSettings";
import ItemDetailClient from "./ItemDetailClient";
import ItemDetailPage from "./page";

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (notify) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); },
    () => window.location.search,
  )) };
});

const item: Item = { id: 100, name: "Test ore", itemQuality: 1, qualityRank: 1,
  isReagent: true, isCraftedOutput: false, marketType: "commodity",
  itemClass: null, itemSubclass: null, inventoryType: null };
const prices = [{ time: "2026-10-03T10:00:00Z", min_price: 10000, avg_price: 20000,
  median_price: null, max_price: 30000, total_quantity: 17 }];
const historyRequest = vi.fn<(url: URL) => Promise<Response>>();

beforeEach(async () => {
  window.history.replaceState(null, "", "/items/100");
  const pushState = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => { pushState(...args); window.dispatchEvent(new PopStateEvent("popstate")); });
  historyRequest.mockReset().mockImplementation(async () => Response.json(prices));
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/items/100") return Response.json(item);
    if (url.pathname === "/api/items/100/variants") return Response.json({ variants: [] });
    if (url.pathname === "/api/realms") return Response.json([1, 2].map((id) => ({
      connected_realm_id: id, realms: [{ id, name: `Realm ${id}`, slug: `realm-${id}` }],
    })));
    if (url.pathname.endsWith("/prices")) return historyRequest(url);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }));
  await selectedRealm.retry();
  selectedRealm.select(1);
});

test("a six-month current fallback remains a current quote, while daily records disclose precision", async () => {
  window.history.replaceState(null, "", "/items/100?range=6m");
  historyRequest.mockResolvedValueOnce(Response.json([{ ...prices[0], resolution: "current", total_quantity: 0 }]));
  render(<ItemDetailClient item={item} />);
  expect(await screen.findByText(/Current quote · lowest listing/)).toBeVisible();
  expect(screen.getByText(/No historical observations in this range/)).toBeVisible();
  expect(screen.getByRole("region", { name: "History summary" })).toHaveTextContent("Latest units available0");
  expect(screen.queryByText(/Latest daily value/)).toBeNull();
  historyRequest.mockResolvedValueOnce(Response.json([2, 1].map((day) => ({ ...prices[0],
    time: `2026-10-0${day}`, resolution: "daily", sample_count: 3, average_is_exact: false,
  }))));
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  await screen.findByText(/Some daily averages are approximate/);
  expect(screen.getByText(/Daily dates are UTC/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View observations (2)" }));
  expect(screen.getAllByText("Approximate")).toHaveLength(2);
  expect(screen.getByRole("columnheader", { name: "Samples" })).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Price measure" }), { target: { value: "median" } });
  expect(screen.getByText(/Median prices are unavailable/)).toBeVisible();
});

test("linked realm history applies scope before loading and keeps navigation, back and copied links consistent", async () => {
  window.history.replaceState(null, "", "/items/100?view=history&realm=2&range=7d&from=%2Fitems");
  render(<><NavSettings /><ItemDetailClient item={{ ...item, marketType: "realm" }} /></>);
  await screen.findByRole("heading", { name: "Price history · Realm 2" });
  await screen.findByText("1g 0s");
  expect(historyRequest.mock.calls.map(([url]) => url.searchParams.get("connectedRealmId"))).toEqual(["2"]);
  expect(screen.getByRole("combobox", { name: "Connected realm" })).toHaveValue("2");
  fireEvent.change(screen.getByRole("combobox", { name: "Connected realm" }), { target: { value: "1" } });
  await screen.findByRole("heading", { name: "Price history · Realm 1" });
  await screen.findByText("1g 0s");
  expect(new URLSearchParams(window.location.search).get("realm")).toBe("1");
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  fireEvent.click(screen.getByRole("button", { name: "Copy history link" }));
  await screen.findByText("Link copied");
  const link = new URL(copy.mock.calls[0][0]);
  expect(link.searchParams.get("realm")).toBe("1");
  expect(link.searchParams.get("range")).toBe("7d");
  expect(link.searchParams.has("from")).toBe(false);
  await act(async () => { window.history.back(); });
  await screen.findByRole("heading", { name: "Price history · Realm 2" });
  await screen.findByText("1g 0s");
  expect(screen.queryByText("Link copied")).toBeNull();
  copy.mockRejectedValueOnce(new Error("Clipboard denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy history link" }));
  expect(await screen.findByRole("textbox", { name: "History link" })).toHaveValue(`${window.location.origin}/items/100?view=history&realm=2&range=7d`);
});

test("an unavailable linked realm can reuse the selected realm without selecting a different one first", async () => {
  window.history.replaceState(null, "", "/items/100?view=history&realm=999");
  render(<><NavSettings /><ItemDetailClient item={{ ...item, marketType: "realm" }} /></>);
  expect(screen.getByText(/The realm in this link is unavailable/)).toBeVisible();
  expect(historyRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use selected realm" }));
  await screen.findByRole("heading", { name: "Price history · Realm 1" });
  await screen.findByText("1g 0s");
  expect(historyRequest.mock.calls[0][0].searchParams.get("connectedRealmId")).toBe("1");
});

test.each([
  ["/flipping?category=name%3APowerful+Peridots&limit=50", "Back to realm comparison", "/flipping?category=name%3APowerful+Peridots&limit=50"],
  ["/items?search=ore", "Back to market", "/items?search=ore"],
  ["https://example.com/flipping", "Back to market", "/items"],
  ["//example.com/flipping", "Back to market", "/items"],
  ["/flipping-other", "Back to market", "/items"],
])("item return navigation validates %s", async (from, label, href) => {
  render(await ItemDetailPage({ params: Promise.resolve({ id: "100" }), searchParams: Promise.resolve({ from }) }));
  await screen.findByText("1g 0s");
  expect(screen.getByRole("link", { name: `← ${label}` })).toHaveAttribute("href", href);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a failed history range retries in place and preserves the selected range", async () => {
  render(<ItemDetailClient item={item} />);
  await screen.findByText("1g 0s");
  historyRequest.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "7d" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  await screen.findByText("1g 0s");
  expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  expect(historyRequest.mock.calls.map(([url]) => url.searchParams.get("range"))).toEqual(["24h", "7d", "7d"]);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("EU commodity history stays loaded when the connected realm changes", async () => {
  render(<><NavSettings /><ItemDetailClient item={item} /></>);
  await screen.findByText("1g 0s");
  for (const realmId of [2, 1]) {
    fireEvent.change(screen.getByRole("combobox", { name: "Connected realm" }), { target: { value: String(realmId) } });
    await waitFor(() => expect(screen.getByText("1g 0s")).toBeVisible());
  }
  expect(historyRequest).toHaveBeenCalledTimes(1);
  expect(historyRequest.mock.calls[0][0].searchParams.get("type")).toBe("commodity");
  expect(historyRequest.mock.calls[0][0].searchParams.has("connectedRealmId")).toBe(false);
});

test("a failed refresh discloses retained history and ignores a late response for another range", async () => {
  render(<ItemDetailClient item={item} />);
  await screen.findByText("1g 0s");
  let finishOlderRequest!: (response: Response) => void;
  historyRequest.mockImplementationOnce(() => new Promise((resolve) => { finishOlderRequest = resolve; }))
    .mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "7d" }));
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "24h" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Showing previously loaded history");
  expect(screen.getByText("1g 0s")).toBeVisible();
  await act(async () => finishOlderRequest(Response.json([{ ...prices[0], min_price: 990000 }])));
  expect(screen.queryByText("99g 0s")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(historyRequest.mock.calls.at(-1)![0].searchParams.get("range")).toBe("24h");
});

test("a focused seven-day history preserves its settings and exposes every exact observation for reuse", async () => {
  historyRequest.mockImplementation(async () => Response.json(Array.from({ length: 26 }, (_, index) => ({
    ...prices[0], time: new Date(Date.UTC(2026, 9, 3, 12 - index)).toISOString(),
    min_price: 30000 - index * 1000, avg_price: 300000 - index * 10000, total_quantity: index * 3,
    resolution: "hourly",
  }))));
  const view = render(<ItemDetailClient item={item} />);
  await screen.findAllByText("3g 0s");
  fireEvent.click(screen.getByRole("button", { name: "7d" }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get("range")).toBe("7d"));
  fireEvent.change(screen.getByRole("combobox", { name: "Price measure" }), { target: { value: "average" } });
  expect(screen.getByRole("region", { name: "History summary" })).toHaveTextContent("30g 0s");
  expect(screen.getByRole("region", { name: "History summary" })).toHaveTextContent("+500%");
  fireEvent.click(screen.getByText("View observations (26)"));
  const table = screen.getByRole("table", { name: "Price observations" });
  expect(within(table).getAllByRole("row")).toHaveLength(26); // header + 25 records
  fireEvent.click(screen.getByRole("button", { name: "Next observations" }));
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  expect(within(table).getByText("0g 50s")).toBeVisible();
  const csv = decodeURIComponent(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")!.split(",").slice(1).join(","));
  expect(csv).toContain("lowest_copper");
  expect(csv).toContain("2026-10-03T12:00:00.000Z");
  expect(csv.split("\r\n")).toHaveLength(27); // All records, not just the last page.
  view.unmount(); render(<ItemDetailClient item={item} />);
  await screen.findByRole("region", { name: "History summary" });
  expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("combobox", { name: "Price measure" })).toHaveValue("average");
});
