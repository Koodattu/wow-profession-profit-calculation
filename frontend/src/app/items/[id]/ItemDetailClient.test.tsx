import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Item } from "@/lib/api";

const state = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/features/item-detail", () => ({ useItemDetail: state.history }));
vi.mock("@/lib/selected-realm", () => ({ useSelectedRealm: () => ({ status: "ready", selectedId: 1, options: [{ id: 1, label: "Kazzak" }] }) }));
vi.mock("./GearMarket", () => ({ default: () => <div>Current gear offers</div> }));
vi.mock("@/app/HistoryLineChart", () => ({ default: () => <div>History chart</div> }));
import ItemDetailClient from "./ItemDetailClient";

const item: Item = { id: 271434, name: "Venom Rite Mantle", itemQuality: 4, qualityRank: null, isReagent: false, isCraftedOutput: false, marketType: "realm", itemClass: "Armor", itemSubclass: "Cloth", inventoryType: "Shoulder" };
beforeEach(() => state.history.mockReset());
afterEach(cleanup);

test("loads history only when requested and explains absent non-profession history", () => {
  state.history.mockReturnValue({ status: "ready", connectedRealmId: 1, prices: [] });
  render(<ItemDetailClient item={item} />);
  expect(state.history).not.toHaveBeenCalled();
  expect(screen.getByText("Current gear offers")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Price history" }));
  expect(state.history).toHaveBeenCalled();
  expect(screen.getByText(/History combines all item versions/)).toBeVisible();
  expect(screen.getByText(/We currently keep price history for profession items/)).toBeVisible();
  expect(screen.getByText("Current gear offers")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Buyout listings" }));
  expect(screen.getByText("Current gear offers")).toBeVisible();
});

test("keeps a commodity's latest price visible even with only one observation", () => {
  state.history.mockReturnValue({ status: "ready", connectedRealmId: 1, prices: [{ time: "2026-09-16T12:00:00Z", min_price: 10000, avg_price: 20000, median_price: null, max_price: 30000, total_quantity: 17 }] });
  render(<ItemDetailClient item={{ ...item, marketType: "commodity", isReagent: true }} />);
  expect(screen.getByRole("heading", { name: "Price history · EU commodities" })).toBeVisible();
  expect(screen.getByText("1g 0s")).toBeVisible();
  expect(screen.getByText("17")).toBeVisible();
  expect(screen.queryByText("Current gear offers")).toBeNull();
  expect(screen.queryByText("History chart")).toBeNull();
});

test("does not mislabel a loading history request as missing data", () => {
  state.history.mockReturnValue({ status: "loading", connectedRealmId: 1, prices: [] });
  render(<ItemDetailClient item={{ ...item, marketType: "commodity" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading price history");
  expect(screen.queryByText("No price history to chart yet")).toBeNull();
});
