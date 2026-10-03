import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      { recipeId: 101, recipeName: "Alpha potion", categoryId: 10, scenarios: [scenario("rank:1:1", 20000), scenario("rank:2:2", -10000), scenario("rank:1:2", 30000)] },
      { recipeId: 102, recipeName: "Beta potion", categoryId: 10, scenarios: [scenario("rank:1:1", 50000), scenario("rank:2:2", 60000)] },
      { recipeId: 103, recipeName: "Missing potion", categoryId: 10, scenarios: [scenario("rank:1:1", null), scenario("rank:2:2", null)] },
    ]);
  }));
  await selectedRealm.retry(); selectedRealm.select(1);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test.each(["", "?compare=0&scenario=rank%3A2%3A2", "?compare=1"])("shows all scenario prices side by side on entry %s", async (search) => {
  window.history.replaceState(null, "", `/professions/1${search}`);
  render(<ProfessionClient profession={profession} />);
  const recipe = await screen.findByRole("link", { name: "Alpha potion" });
  const table = screen.getByRole("table");
  for (const name of ["Pure R1", "Pure R2", "Conc R1→R2"]) {
    expect(within(table).getByRole("columnheader", { name })).toBeVisible();
  }
  const row = recipe.closest("tr")!;
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "1g 0s", "3g 0s", "2g 0s", "1g 0s", "0g 0s", "−1g 0s", "1g 0s", "4g 0s", "3g 0s",
  ]);
  expect(screen.queryByRole("combobox", { name: "Scenario" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "Compare all scenarios" })).not.toBeInTheDocument();
  const missingRow = screen.getByRole("link", { name: "Missing potion" }).closest("tr")!;
  expect(within(missingRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "1g 0s", "—", "—", "1g 0s", "—", "—", "—", "—", "—",
  ]);
});

test("search, selected-scenario ranking and positive filtering keep unknown prices out and survive revisit", async () => {
  const view = render(<ProfessionClient profession={profession} />);
  await screen.findByRole("link", { name: "Alpha potion" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search recipes" }), { target: { value: "potions" } });
  expect(screen.getByRole("link", { name: "Alpha potion" })).toBeVisible(); // category search
  fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), { target: { value: "profit" } });
  await waitFor(() => expect(screen.getAllByRole("link").filter((link) => /potion$/.test(link.textContent ?? "")).map((link) => link.textContent)).toEqual(["Beta potion", "Alpha potion", "Missing potion"]));
  fireEvent.click(screen.getByRole("radio", { name: "Pure R2" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Positive gross profit only" }));
  expect(screen.queryByRole("link", { name: "Alpha potion" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Missing potion" })).toBeNull();
  const link = screen.getByRole("link", { name: "Beta potion" });
  expect(within(link.closest("tr")!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "1g 0s", "6g 0s", "5g 0s", "1g 0s", "7g 0s", "6g 0s", "—", "—", "—",
  ]);
  expect(screen.getByRole("columnheader", { name: "Conc R1→R2" })).toBeVisible();
  expect(new URL(link.getAttribute("href")!, window.location.origin).searchParams.get("from")).toBe(`/professions/1${window.location.search}`);
  view.unmount(); render(<ProfessionClient profession={profession} />);
  await screen.findByRole("link", { name: "Beta potion" });
  expect(screen.getByRole("textbox", { name: "Search recipes" })).toHaveValue("potions");
  expect(screen.getByRole("radio", { name: "Pure R2" })).toBeChecked();
  fireEvent.change(screen.getByRole("textbox", { name: "Search recipes" }), { target: { value: "unmatched" } });
  expect(screen.getByText("No recipes match these filters.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await screen.findByRole("link", { name: "Alpha potion" });
});

test("keeps every salvage input visible when changing the sorting scenario", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json([
    { recipeId: 104, recipeName: "Salvage materials", categoryId: 10, scenarios: [
      { ...scenario("salvage:21", 20000), isSalvage: true, inputItemId: 21 },
      { ...scenario("salvage:22", -10000), isSalvage: true, inputItemId: 22 },
      { ...scenario("salvage:23", null), isSalvage: true, inputItemId: 23 },
    ] },
  ]));
  render(<ProfessionClient profession={profession} />);
  const recipe = await screen.findByRole("link", { name: "Salvage materials" });
  fireEvent.click(screen.getByRole("radio", { name: "Conc R1→R2" }));
  const row = within(recipe.closest("tr")!);
  expect(row.getByText("Gross profit by salvage input")).toBeVisible();
  for (const [label, price] of [["Input 21", "2g 0s"], ["Input 22", "−1g 0s"], ["Input 23", "—"]]) {
    const input = row.getByText(label);
    expect(input).toBeVisible();
    expect(within(input.parentElement!).getByText(price)).toBeVisible();
  }
});
