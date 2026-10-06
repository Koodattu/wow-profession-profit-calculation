import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RankScenario, RecipeProfitResult } from "@/lib/api";
import { craftPlan } from "@/lib/craft-plan";
import { selectedRealm } from "@/lib/selected-realm";
import NavSettings from "@/app/NavSettings";
import { chooseRealm } from "@/test/choose-realm";
import CraftPlanClient from "./CraftPlanClient";

const storageKey = "copper-craft-plan-v1";
const entries = [
  { recipeId: 101, scenarioKey: "rank:1:1", crafts: 2 },
  { recipeId: 102, scenarioKey: "rank:1:1", crafts: 3 },
  { recipeId: 101, scenarioKey: "rank:2:2", crafts: 1 },
];
function scenario(key: string, itemId: number, quantity: number, unitPrice: number, outputQuantity: number, outputPrice: number): RankScenario {
  const totalCost = quantity * unitPrice;
  return { scenarioKey: key, reagentRank: key === "rank:2:2" ? 2 : 1, outputRank: key === "rank:2:2" ? 2 : 1,
    cost: { totalCost, reagentsComplete: true, reagents: [{ slotIndex: 0, itemId, itemName: "Test herb", itemQuality: 1, quantity, unitPrice, totalPrice: totalCost }] },
    outputItemId: 21, outputItemName: "Potion", outputItemQuality: 1, outputQuantity, outputUnitPrice: outputPrice,
    outputTotalPrice: outputQuantity * outputPrice, profit: outputQuantity * outputPrice - totalCost };
}
const recipes: RecipeProfitResult[] = [
  { recipeId: 101, recipeName: "Five potions", professionId: 1, professionName: "Alchemy", qualityTierType: "2rank",
    affectedByMulticraft: true, affectedByResourcefulness: true,
    scenarios: [scenario("rank:1:1", 11, 3, 20000, 5, 20000), scenario("rank:2:2", 12, 3, 30000, 5, 40000)] },
  { recipeId: 102, recipeName: "Two potions", professionId: 1, professionName: "Alchemy", qualityTierType: "2rank",
    affectedByMulticraft: true, affectedByResourcefulness: true, scenarios: [scenario("rank:1:1", 11, 4, 20000, 2, 50000)] },
];
const loadPrices = vi.fn<(url: URL) => Promise<Response>>();
const writeClipboard = vi.fn<(text: string) => Promise<void>>();

function restoreStored(value: unknown) {
  localStorage.setItem(storageKey, typeof value === "string" ? value : JSON.stringify(value));
  window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
}
beforeEach(async () => {
  loadPrices.mockReset().mockImplementation(async () => Response.json(recipes));
  writeClipboard.mockReset().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText: writeClipboard } });
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/realms") return Response.json([1, 2].map((id) => ({ connected_realm_id: id, realms: [{ id, name: `Realm ${id}`, slug: `realm-${id}` }] })));
    return loadPrices(url);
  }));
  await selectedRealm.retry(); selectedRealm.select(1);
  craftPlan.initialize();
  restoreStored({ version: 1, entries });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("each saved choice shows quantity-scaled cost, output and gross profit together", async () => {
  render(<CraftPlanClient />);
  await screen.findByText("45g 0s");
  const first = within(screen.getByLabelText("Five potions (Pure R1) estimates"));
  expect(first.getByText("12g 0s")).toBeVisible();
  expect(first.getByText("20g 0s")).toBeVisible();
  expect(first.getByText("8g 0s")).toBeVisible();
  const second = within(screen.getByLabelText("Two potions (Pure R1) estimates"));
  expect(second.getByText("24g 0s")).toBeVisible();
  expect(second.getByText("30g 0s")).toBeVisible();
  expect(second.getByText("6g 0s")).toBeVisible();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" }), { target: { value: "4" } });
  expect(first.getByText("24g 0s")).toBeVisible();
  expect(first.getByText("40g 0s")).toBeVisible();
  expect(first.getByText("16g 0s")).toBeVisible();
});

test("combined materials preserve ranks, multiply craft counts, persist edits and copy usable quantities", async () => {
  const view = render(<CraftPlanClient />);
  await screen.findByText("45g 0s");
  expect(screen.getByText("70g 0s")).toBeVisible();
  expect(screen.getByText("25g 0s")).toBeVisible();
  const materials = within(screen.getByRole("list", { name: "Combined reagents" }));
  expect(materials.getAllByRole("listitem")).toHaveLength(2);
  expect(materials.getByText("18 needed")).toBeVisible();
  expect(materials.getByText("3 needed")).toBeVisible();
  expect(screen.getByText("2 crafts × 5 items = at least 10 output items")).toBeVisible();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" }), { target: { value: "4" } });
  expect(screen.getByText("57g 0s")).toBeVisible();
  expect(materials.getByText("24 needed")).toBeVisible();
  expect(loadPrices).toHaveBeenCalledTimes(1); // quantity editing does not refetch unchanged recipe IDs
  expect(loadPrices.mock.calls[0][0].searchParams.get("ids")).toBe("101,102");
  fireEvent.click(screen.getByRole("button", { name: "Copy list" }));
  await screen.findByText("Shopping list copied.");
  expect(writeClipboard.mock.calls[0][0]).toContain("24 × Test herb (item 11)\n3 × Test herb (item 12)");
  expect(JSON.parse(localStorage.getItem(storageKey)!).entries[0].crafts).toBe(4);
  view.unmount();
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: storageKey })); });
  render(<CraftPlanClient />);
  expect(await screen.findByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" })).toHaveValue(4);
});

test("losses, zero output and missing quotes stay distinct in each choice's estimates", async () => {
  const mixed = structuredClone(recipes);
  mixed[0].scenarios[0].outputTotalPrice = 0;
  mixed[1].scenarios[0].outputTotalPrice = 50000;
  mixed[0].scenarios[1].outputTotalPrice = null;
  loadPrices.mockImplementation(async () => Response.json(mixed));
  render(<CraftPlanClient />);
  await screen.findByText(/Some prices or recipe choices are unavailable/);
  const zero = within(screen.getByLabelText("Five potions (Pure R1) estimates"));
  expect(zero.getByText("0g 0s")).toBeVisible();
  expect(zero.getByText("−12g 0s")).toBeVisible();
  expect(within(screen.getByLabelText("Two potions (Pure R1) estimates")).getByText("−9g 0s")).toBeVisible();
  const missing = within(screen.getByLabelText("Five potions (Pure R2) estimates"));
  expect(missing.getByText("9g 0s")).toBeVisible();
  expect(missing.getAllByText("Unavailable")).toHaveLength(2);
});

test("recipe and shopping links carry their plan section as return context", async () => {
  render(<CraftPlanClient />);
  const recipe = (await screen.findAllByRole("link", { name: "Five potions" }))[0];
  expect(new URL(recipe.getAttribute("href")!, "https://copper.test").searchParams.get("from")).toBe("/craft-plan#plan-recipes");
  const material = within(screen.getByRole("list", { name: "Combined reagents" })).getAllByRole("link", { name: "Test herb" })[0];
  expect(new URL(material.getAttribute("href")!, "https://copper.test").searchParams.get("from")).toBe("/craft-plan#plan-shopping");
});

test("invalid quantities retain the last valid totals, and removal can be undone", async () => {
  render(<CraftPlanClient />);
  const input = await screen.findByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" });
  for (const value of ["", "0", "-1", "1.5", "10001"]) {
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("45g 0s")).toBeVisible();
  }
  fireEvent.click(screen.getByRole("button", { name: "Remove Five potions (Pure R1)" }));
  expect(screen.queryByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" })).toBeNull();
  expect(screen.getByRole("button", { name: "Undo remove" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Undo remove" }));
  expect(screen.getByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" })).toHaveValue(2);
  expect(screen.getByRole("heading", { name: "Recipes" })).toHaveFocus();
});

test("missing quotes never become partial totals, while unavailable recipes prevent incomplete export", async () => {
  const missing = structuredClone(recipes);
  missing[0].scenarios[0].cost.totalCost = null;
  missing[0].scenarios[0].cost.reagents[0].unitPrice = null;
  missing[0].scenarios[0].cost.reagents[0].totalPrice = null;
  loadPrices.mockImplementation(async () => Response.json(missing));
  render(<CraftPlanClient />);
  await screen.findByText(/Some prices or recipe choices are unavailable/);
  expect(within(screen.getByLabelText("Plan totals")).getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.getByText("Price unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy list" })).toBeEnabled();
  act(() => restoreStored({ version: 1, entries: [...entries, { recipeId: 999, scenarioKey: "rank:1:1", crafts: 1 }] }));
  await screen.findByText(/Incomplete list: 1/);
  expect(screen.getByRole("button", { name: "Copy list" })).toBeDisabled();
});

test("a stalled old realm response cannot replace the new realm; failed refresh retains choices and recovers", async () => {
  let finishOld!: (response: Response) => void;
  loadPrices.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  render(<><NavSettings /><CraftPlanClient /></>);
  await waitFor(() => expect(loadPrices).toHaveBeenCalledTimes(1));
  chooseRealm("Realm 2");
  await screen.findByText("45g 0s");
  await act(async () => finishOld(Response.json([])));
  expect(screen.getByText("45g 0s")).toBeVisible();
  loadPrices.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh prices" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last loaded quotes");
  fireEvent.click(screen.getByRole("button", { name: "Retry prices" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(loadPrices.mock.calls.at(-1)![0].searchParams.get("connectedRealmId")).toBe("2");
});

test("a recipe with an unresolved reagent slot cannot export a partial shopping list", async () => {
  const incomplete = structuredClone(recipes);
  incomplete[0].scenarios[0].cost.reagentsComplete = false;
  incomplete[0].scenarios[0].cost.totalCost = null;
  loadPrices.mockImplementation(async () => Response.json(incomplete));
  render(<CraftPlanClient />);
  await screen.findByText(/Incomplete list: 1/);
  expect(screen.getByRole("button", { name: "Copy list" })).toBeDisabled();
});

test("returning to a realm recovers after its earlier request failed", async () => {
  loadPrices.mockRejectedValueOnce(new Error("offline"));
  render(<><NavSettings /><CraftPlanClient /></>);
  await screen.findByRole("alert");
  chooseRealm("Realm 2");
  await screen.findByText("45g 0s");
  chooseRealm("Realm 1");
  await screen.findByText("45g 0s");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("storage and clipboard failures leave the plan usable with explicit recovery", async () => {
  render(<CraftPlanClient />);
  const input = await screen.findByRole("spinbutton", { name: "Crafts for Five potions (Pure R1)" });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  fireEvent.change(input, { target: { value: "4" } });
  expect(screen.getByRole("alert")).toHaveTextContent("lasts only for this session");
  expect(screen.getByText("57g 0s")).toBeVisible();
  writeClipboard.mockRejectedValue(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy list" }));
  expect((await screen.findByRole("textbox", { name: "Shopping list text" }) as HTMLTextAreaElement).value).toContain("24 × Test herb");
});

test.each(["{broken", JSON.stringify({ version: 1, entries: [{ recipeId: -1, scenarioKey: "rank:1:1", crafts: 2 }] })])("invalid saved data is disclosed and can start a fresh plan: %s", (raw) => {
  act(() => restoreStored(raw));
  render(<CraftPlanClient />);
  expect(screen.getByRole("alert")).toHaveTextContent("saved plan could not be read");
  expect(screen.getByRole("link", { name: "Browse professions" })).toBeVisible();
});
