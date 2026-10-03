import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FlippingClient from "./FlippingClient";

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (notify) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); },
    () => window.location.search,
  )) };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/flipping");
  const replaceState = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replaceState(...args);
    // Next notifies useSearchParams after native history changes.
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a failed comparison is not reported as no opportunities and retry preserves filters", async () => {
  let offline = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("opportunities") && offline) throw new Error("offline");
    return Response.json([]);
  }));
  render(<FlippingClient />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load realm comparisons"));
  expect(screen.queryByText("No flipping opportunities found")).toBeNull();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Min spread" }), { target: { value: "50" } });
  await screen.findByRole("button", { name: "Retry comparison" });
  offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
  await screen.findByText("No items match these comparison filters.");
  expect(screen.getByRole("spinbutton", { name: "Min spread" })).toHaveValue(50);
});

test("comparison filters and detail return context survive a fresh visit to the URL", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("categories")
    ? [{ categoryName: "Powerful Peridots" }]
    : [{ itemId: 100, itemName: "Deadly Peridot", itemQuality: 3, qualityRank: 2,
      categoryName: "Powerful Peridots", regionAvgPrice: 2000000, spread: 1000000,
      spreadPercent: 100, realmCount: 2, cheapestRealm: { realmName: "One", minBuyout: 1000000 },
      mostExpensiveRealm: { realmName: "Two", minBuyout: 2000000 } }])));
  const view = render(<FlippingClient />);
  await screen.findByRole("link", { name: "Deadly Peridot" });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Min spread" }), { target: { value: "50" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Show" }), { target: { value: "50" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "regionAvgPrice" } });
  fireEvent.click(screen.getByRole("button", { name: "Category" }));
  fireEvent.click(await screen.findByRole("button", { name: "Powerful Peridots" }));
  const link = await screen.findByRole("link", { name: "Deadly Peridot" });
  const query = new URLSearchParams(window.location.search);
  expect(Object.fromEntries(query)).toEqual({ minSpread: "50", limit: "50", sort: "regionAvgPrice", category: "name:Powerful Peridots" });
  const detailUrl = new URL(link.getAttribute("href")!, window.location.origin);
  expect(detailUrl.searchParams.get("from")).toBe(`/flipping${window.location.search}`);

  view.unmount();
  render(<FlippingClient />);
  await screen.findByRole("link", { name: "Deadly Peridot" });
  expect(screen.getByRole("spinbutton", { name: "Min spread" })).toHaveValue(50);
  expect(screen.getByRole("combobox", { name: "Show" })).toHaveValue("50");
  expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("regionAvgPrice");
  expect(screen.getByRole("button", { name: "Category" })).toHaveTextContent("Powerful Peridots");
  const request = new URL(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("opportunities")).at(-1)![0] as string);
  expect(request.searchParams.get("minSpread")).toBe("500000");
  expect(request.searchParams.get("categoryName")).toBe("Powerful Peridots");
});
