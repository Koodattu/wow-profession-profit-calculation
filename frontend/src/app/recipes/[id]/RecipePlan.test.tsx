import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { RecipeProfitResult } from "@/lib/api";
import { selectedRealm } from "@/lib/selected-realm";
import RecipeClient from "./RecipeClient";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const recipe: RecipeProfitResult = {
  recipeId: 101, recipeName: "Five potions", professionId: 1, professionName: "Alchemy",
  qualityTierType: "2rank", affectedByMulticraft: true, affectedByResourcefulness: true,
  scenarios: [{ scenarioKey: "rank:1:1", reagentRank: 1, outputRank: 1,
    cost: { totalCost: 60000, reagents: [{ slotIndex: 0, itemId: 11, itemName: "Test herb",
      itemQuality: 1, quantity: 3, unitPrice: 20000, totalPrice: 60000 }] },
    outputItemId: 21, outputItemName: "Test potion", outputItemQuality: 1,
    outputQuantity: 5, outputUnitPrice: 20000, outputTotalPrice: 100000, profit: 40000 }],
};

test("plan inspection returns to saved choices and ingredient links retain the recipe context", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ connected_realm_id: 2, realms: [{ id: 2, name: "Test realm", slug: "test-realm" }] }])));
  await selectedRealm.retry();
  selectedRealm.select(2);
  render(<RecipeClient recipe={recipe} returnTo="/craft-plan#plan-recipes" historyRange="7d" onHistoryRangeChange={() => {}}
    history={{}} historyLoading={false} historyFailed={false} onRetryHistory={() => {}} />);
  expect(screen.getByRole("link", { name: "← Craft plan" })).toHaveAttribute("href", "/craft-plan#plan-recipes");
  for (const name of ["Test herb", "Test potion"]) {
    const link = new URL(screen.getByRole("link", { name }).getAttribute("href")!, "https://copper.test");
    const back = new URL(link.searchParams.get("from")!, "https://copper.test");
    expect(back.pathname).toBe("/recipes/101");
    expect(back.searchParams.get("range")).toBe("7d");
    expect(back.searchParams.get("realm")).toBe("2");
    expect(link.searchParams.get("realm")).toBe("2");
    expect(back.searchParams.get("from")).toBe("/craft-plan#plan-recipes");
  }
});

test.each(["https://other.test", "//other.test", "/craft-plan/other", "/professions/2", "/professions/1/../2"])("rejects unsupported recipe return context %s", (returnTo) => {
  render(<RecipeClient recipe={recipe} returnTo={returnTo} historyRange="24h" onHistoryRangeChange={() => {}}
    history={{}} historyLoading={false} historyFailed={false} onRetryHistory={() => {}} />);
  expect(screen.getByRole("link", { name: "← Alchemy" })).toHaveAttribute("href", "/professions/1");
});

test("a recipe can add a whole number of crafts without confusing them with output items", async () => {
  localStorage.removeItem("copper-craft-plan-v1");
  render(<RecipeClient recipe={recipe} historyRange="24h" onHistoryRangeChange={() => {}}
    history={{}} historyLoading={false} historyFailed={false} onRetryHistory={() => {}} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Crafts to add" }), { target: { value: "3" } });
  fireEvent.click(await screen.findByRole("button", { name: "Add Pure R1 to plan" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Added 3 crafts");
  expect(JSON.parse(localStorage.getItem("copper-craft-plan-v1")!).entries).toEqual([
    { recipeId: 101, scenarioKey: "rank:1:1", crafts: 3 },
  ]);
  expect(screen.getByText(/15 output items/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add Pure R1 to plan" }));
  expect(JSON.parse(localStorage.getItem("copper-craft-plan-v1")!).entries).toEqual([
    { recipeId: 101, scenarioKey: "rank:1:1", crafts: 6 },
  ]);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Crafts to add" }), { target: { value: "10000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Pure R1 to plan" }));
  expect(screen.getByRole("alert")).toHaveTextContent("exceed 10,000 crafts");
  expect(JSON.parse(localStorage.getItem("copper-craft-plan-v1")!).entries[0].crafts).toBe(6);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Crafts to add" }), { target: { value: "1.5" } });
  expect(screen.getByRole("button", { name: "Add Pure R1 to plan" })).toBeDisabled();
});
