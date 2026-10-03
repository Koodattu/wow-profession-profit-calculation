import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Item } from "@/lib/api";
import { selectedRealm } from "@/lib/selected-realm";
import NavSettings from "@/app/NavSettings";
import ItemDetailClient from "./ItemDetailClient";
import ItemDetailPage from "./page";

const item: Item = { id: 100, name: "Test ore", itemQuality: 1, qualityRank: 1,
  isReagent: true, isCraftedOutput: false, marketType: "commodity",
  itemClass: null, itemSubclass: null, inventoryType: null };
const prices = [{ time: "2026-10-03T10:00:00Z", min_price: 10000, avg_price: 20000,
  median_price: null, max_price: 30000, total_quantity: 17 }];
const historyRequest = vi.fn<(url: URL) => Promise<Response>>();

beforeEach(async () => {
  historyRequest.mockReset().mockImplementation(async () => Response.json(prices));
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/items/100") return Response.json(item);
    if (url.pathname === "/api/realms") return Response.json([1, 2].map((id) => ({
      connected_realm_id: id, realms: [{ id, name: `Realm ${id}`, slug: `realm-${id}` }],
    })));
    if (url.pathname.endsWith("/prices")) return historyRequest(url);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }));
  await selectedRealm.retry();
  selectedRealm.select(1);
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
