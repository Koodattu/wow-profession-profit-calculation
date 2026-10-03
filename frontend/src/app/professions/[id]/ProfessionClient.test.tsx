import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { selectedRealm } from "@/lib/selected-realm";
import type { ProfessionDetail, RankScenario } from "@/lib/api";
import ProfessionClient from "./ProfessionClient";

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (notify) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); },
    () => window.location.search,
  )) };
});

const profession: ProfessionDetail = { id: 1, name: "Alchemy", expansion: "Midnight",
  categories: [{ id: 10, name: "Potions", professionId: 1, topCategoryId: null, topCategoryName: null }] };
function scenario(key: string, profit: number | null): RankScenario {
  return { scenarioKey: key, reagentRank: 1, outputRank: 1, cost: { totalCost: 10000, reagents: [] },
    outputItemId: 20, outputItemName: "Potion", outputItemQuality: 1, outputQuantity: 5,
    outputUnitPrice: null, outputTotalPrice: profit === null ? null : profit + 10000, profit };
}

beforeEach(async () => {
  window.history.replaceState(null, "", "/professions/1");
  const replaceState = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => { replaceState(...args); window.dispatchEvent(new PopStateEvent("popstate")); });
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/realms") return Response.json([{ connected_realm_id: 1, realms: [{ id: 1, name: "Test", slug: "test" }] }]);
    return Response.json([
      { recipeId: 101, recipeName: "Alpha potion", categoryId: 10, scenarios: [scenario("rank:1:1", 20000), scenario("rank:2:2", -10000)] },
      { recipeId: 102, recipeName: "Beta potion", categoryId: 10, scenarios: [scenario("rank:1:1", 50000), scenario("rank:2:2", 60000)] },
      { recipeId: 103, recipeName: "Missing potion", categoryId: 10, scenarios: [scenario("rank:1:1", null), scenario("rank:2:2", null)] },
    ]);
  }));
  await selectedRealm.retry(); selectedRealm.select(1);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("search, selected-scenario ranking and positive filtering keep unknown prices out and survive revisit", async () => {
  const view = render(<ProfessionClient profession={profession} />);
  await screen.findByRole("link", { name: "Alpha potion" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search recipes" }), { target: { value: "potions" } });
  expect(screen.getByRole("link", { name: "Alpha potion" })).toBeVisible(); // category search
  fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), { target: { value: "profit" } });
  await waitFor(() => expect(screen.getAllByRole("link").filter((link) => /potion$/.test(link.textContent ?? "")).map((link) => link.textContent)).toEqual(["Beta potion", "Alpha potion", "Missing potion"]));
  fireEvent.change(screen.getByRole("combobox", { name: "Scenario" }), { target: { value: "rank:2:2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Positive gross profit only" }));
  expect(screen.queryByRole("link", { name: "Alpha potion" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Missing potion" })).toBeNull();
  const link = screen.getByRole("link", { name: "Beta potion" });
  expect(new URL(link.getAttribute("href")!, window.location.origin).searchParams.get("from")).toBe(`/professions/1${window.location.search}`);
  view.unmount(); render(<ProfessionClient profession={profession} />);
  await screen.findByRole("link", { name: "Beta potion" });
  expect(screen.getByRole("textbox", { name: "Search recipes" })).toHaveValue("potions");
  fireEvent.change(screen.getByRole("textbox", { name: "Search recipes" }), { target: { value: "unmatched" } });
  expect(screen.getByText("No recipes match these filters.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await screen.findByRole("link", { name: "Alpha potion" });
});
