import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ItemsClient from "./ItemsClient";
import NavSettings from "../NavSettings";
import { selectedRealm } from "@/lib/selected-realm";

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (notify) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); },
    () => window.location.search,
  )) };
});

function mockFilterMarket() {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/realms")) return Response.json([]);
    if (url.includes("/items/filters")) return Response.json({ categories: [{ name: "Armor", subcategories: ["Cloth", "Plate"] }, { name: "Trade Goods", subcategories: ["Herb"] }], slots: ["Head"], professions: [{ id: 2906, name: "Alchemy", expansion: "Midnight" }] });
    requests.push(new URL(url, "http://localhost"));
    return Response.json({ items: [{ id: 1, name: "Fixture item", marketType: "commodity", latestPrice: { minPrice: 10000, totalQuantity: 50 } }], total: 1, page: 1, totalPages: 1 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { requests, fetcher };
}

test("expansion filters combine with stock, reset paging, survive a return, and can be removed", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&availability=listed&page=3");
  const { requests } = mockFilterMarket();
  const view = render(<ItemsClient />);
  await screen.findByRole("link", { name: "Fixture item" });
  fireEvent.change(screen.getByRole("combobox", { name: "Expansion" }), { target: { value: "12" } });
  await waitFor(() => expect(requests.at(-1)?.searchParams.get("expansion")).toBe("12"));
  expect(requests.at(-1)?.searchParams.get("availability")).toBe("listed");
  expect(window.location.search).not.toContain("page=");
  expect(screen.getByRole("link", { name: "Fixture item" }).getAttribute("href")).toContain("expansion%3D12");
  view.unmount();
  render(<ItemsClient />);
  expect(screen.getByRole("combobox", { name: "Expansion" })).toHaveValue("12");
  fireEvent.click(screen.getByRole("button", { name: "Remove Expansion: Midnight" }));
  await waitFor(() => expect(requests.at(-1)?.searchParams.has("expansion")).toBe(false));
  expect(window.location.search).toContain("availability=listed");
});

test("unknown expansion is bookmarkable and invalid expansion links can recover", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&expansion=13");
  const { requests } = mockFilterMarket();
  render(<ItemsClient />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Some filters in this link are invalid");
  expect(requests).toHaveLength(0);
  fireEvent.change(screen.getByRole("combobox", { name: "Expansion" }), { target: { value: "unknown" } });
  await screen.findByRole("link", { name: "Fixture item" });
  expect(requests.at(-1)?.searchParams.get("expansion")).toBe("unknown");
  expect(screen.getByRole("button", { name: "Remove Expansion: Unknown expansion" })).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Expansion" }), { target: { value: "11" } });
  await act(async () => { window.history.back(); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Expansion" })).toHaveValue("unknown"));
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(window.location.search).not.toContain("expansion");
});

test("filter options retry independently while market results remain usable", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&search=__proto__");
  let optionsOffline = true;
  const { fetcher } = mockFilterMarket();
  const online = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string) => {
    if (optionsOffline && url.includes("/items/filters")) throw new Error("offline");
    return online(url);
  });
  render(<ItemsClient />);
  await screen.findByRole("link", { name: "Fixture item" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Other filters still work");
  expect(screen.getByRole("button", { name: "Remove Search: __proto__" })).toBeVisible();
  optionsOffline = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry filter options" }));
  await screen.findByRole("option", { name: "Trade Goods" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("link", { name: "Fixture item" })).toBeVisible();
});

test("restores advanced filters from a URL and removes dependent subcategories when category changes", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&category=Armor&subcategory=Cloth&slot=Head&rarity=4&rank=2&usage=reagent&profession=2906&availability=listed&sort=quantity-desc&searchMode=exact&minPrice=12500");
  const { requests } = mockFilterMarket();
  const { unmount } = render(<ItemsClient />);
  await screen.findByRole("option", { name: "Midnight Alchemy" });
  await screen.findByRole("link", { name: "Fixture item" });
  expect(screen.getByLabelText("Minimum price (gold)")).toHaveValue("1.25");
  expect(screen.getByLabelText("Match the exact item name")).toBeChecked();
  for (const [name, value] of [["Subcategory", "Cloth"], ["Equipment slot", "Head"], ["Rarity", "4"], ["Crafting rank", "2"], ["Crafting use", "reagent"], ["Profession catalog", "2906"], ["Availability", "listed"], ["Sort by", "quantity-desc"]]) {
    expect(screen.getByRole("combobox", { name })).toHaveValue(value);
    fireEvent.change(screen.getByRole("combobox", { name }), { target: { value: "" } });
  }
  fireEvent.change(screen.getByRole("combobox", { name: "Subcategory" }), { target: { value: "Plate" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "Trade Goods" } });
  expect(window.location.search).not.toContain("subcategory");
  await waitFor(() => expect(requests.at(-1)?.searchParams.get("category")).toBe("Trade Goods"));
  unmount();
  render(<ItemsClient />);
  await screen.findByRole("link", { name: "Fixture item" });
  expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Trade Goods");
  expect(screen.getByLabelText("Minimum price (gold)")).toHaveValue("1.25");
});

test("invalid draft ranges keep results and URL intact, then recover with exact copper amounts", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&minPrice=10000");
  const { requests } = mockFilterMarket();
  render(<ItemsClient />);
  await screen.findByRole("link", { name: "Fixture item" });
  const initialRequests = requests.length;
  fireEvent.change(screen.getByLabelText("Maximum price (gold)"), { target: { value: "0.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply ranges" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Minimum price must not exceed maximum price");
  expect(window.location.search).not.toContain("maxPrice");
  expect(requests).toHaveLength(initialRequests);
  expect(screen.getByRole("link", { name: "Fixture item" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Maximum price (gold)"), { target: { value: "1.0001" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply ranges" }));
  await waitFor(() => expect(requests.at(-1)?.searchParams.get("maxPrice")).toBe("10001"));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("invalid linked filters never silently broaden results and can be removed", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&sort=constructor&minPrice=oops");
  const { requests } = mockFilterMarket();
  render(<ItemsClient />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Some filters in this link are invalid");
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Commodities" }));
  await screen.findByRole("link", { name: "Fixture item" });
});

test("filter changes honor browser history", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&rarity=4");
  mockFilterMarket();
  render(<ItemsClient />);
  await screen.findByRole("link", { name: "Fixture item" });
  fireEvent.change(screen.getByRole("combobox", { name: "Rarity" }), { target: { value: "3" } });
  expect(window.location.search).toContain("rarity=3");
  await act(async () => { window.history.back(); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Rarity" })).toHaveValue("4"));
});

beforeEach(() => {
  window.history.replaceState(null, "", "/items?type=realm");
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    vi.spyOn(window.history, method).mockImplementation((...args) => { original(...args); window.dispatchEvent(new PopStateEvent("popstate")); });
  }
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

test("a failed refresh labels retained prices and can be retried after switching back to a realm", async () => {
  let offline = false;
  let price = 10000;
  localStorage.setItem("wow-selected-connected-realm", "1");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/realms")) return Response.json([
      { connected_realm_id: 1, realms: [{ name: "One" }] },
      { connected_realm_id: 2, realms: [{ name: "Two" }] },
    ]);
    if (offline) throw new Error("offline");
    return Response.json({
      items: [{ id: 1, name: "Fixture ore", marketType: "realm", latestPrice: { minPrice: price, totalQuantity: 5 } }],
      total: 1, page: 1, totalPages: 1,
    });
  }));
  await selectedRealm.retry();
  render(<><NavSettings /><ItemsClient /></>);
  await screen.findByRole("link", { name: "Fixture ore" });
  offline = true;
  fireEvent.change(screen.getByRole("combobox", { name: "Connected realm" }), { target: { value: "2" } });
  await screen.findByRole("button", { name: "Retry market" });
  fireEvent.change(screen.getByRole("combobox", { name: "Connected realm" }), { target: { value: "1" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last loaded prices");
  expect(screen.getByRole("link", { name: "Fixture ore" })).toBeVisible();
  offline = false;
  price = 20000;
  fireEvent.click(screen.getByRole("button", { name: "Retry market" }));
  await screen.findByText("2g 0s");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("combines category and price filters, preserves them in detail links, and clears them", async () => {
  window.history.replaceState(null, "", "/items?type=commodity&page=3");
  const requests: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/realms")) return Response.json([]);
    if (url.includes("/items/filters")) return Response.json({ categories: [{ name: "Trade Goods", subcategories: ["Herb"] }], slots: [], professions: [] });
    requests.push(new URL(url, "http://localhost"));
    return Response.json({ items: [{ id: 1, name: "Fixture herb", marketType: "commodity", latestPrice: { minPrice: 1, totalQuantity: 50 } }], total: 1, page: 1, totalPages: 1 });
  }));
  render(<ItemsClient />);
  await screen.findByRole("option", { name: "Trade Goods" });
  fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "Trade Goods" } });
  await screen.findByRole("link", { name: "Fixture herb" });
  expect(window.location.search).toContain("category=Trade+Goods");
  expect(window.location.search).not.toContain("page=");
  fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
  fireEvent.change(screen.getByLabelText("Minimum price (gold)"), { target: { value: "0.0001" } });
  fireEvent.change(screen.getByLabelText("Maximum price (gold)"), { target: { value: "5.25" } });
  fireEvent.change(screen.getByLabelText("Minimum quantity"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply ranges" }));
  await screen.findByRole("link", { name: "Fixture herb" });
  expect(requests.at(-1)?.searchParams.get("minPrice")).toBe("1");
  expect(requests.at(-1)?.searchParams.get("maxPrice")).toBe("52500");
  expect(requests.at(-1)?.searchParams.get("minQuantity")).toBe("20");
  expect(screen.getByRole("link", { name: "Fixture herb" }).getAttribute("href")).toContain("minPrice%3D1");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(window.location.search).not.toContain("minPrice");
  expect(window.location.search).not.toContain("category");
});
