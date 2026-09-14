import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GearListingsResponse, GearVariant, Item } from "@/lib/api";
import type { SelectedRealmState } from "@/lib/selected-realm";

const state = vi.hoisted(() => ({
  realm: { status: "ready", selectedId: 1, options: [{ id: 1, label: "Alpha (+1)", fullLabel: "Alpha / Beta" }, { id: 2, label: "Gamma", fullLabel: "Gamma" }] } as SelectedRealmState,
  variants: vi.fn(), listings: vi.fn(),
}));
vi.mock("@/lib/selected-realm", () => ({ useSelectedRealm: () => state.realm, selectedRealm: { select: (id: number) => { state.realm = { ...state.realm, status: "ready", selectedId: id }; } } }));
vi.mock("@/lib/api", async (original) => ({ ...await original<object>(), fetchGearVariants: state.variants, fetchGearListings: state.listings }));
import GearMarket from "./GearMarket";

const item: Item = { id: 271434, name: "Venom Rite Mantle", itemQuality: 4, qualityRank: null, isReagent: false, isCraftedOutput: false, marketType: "realm", itemClass: "Armor", itemSubclass: "Cloth", inventoryType: "Shoulder" };
const variant = (key: string, level: number, myth = false): GearVariant => ({
  key, itemLevel: level, upgrade: myth ? { group: 618, level: 1, max: 6, name: "Myth", fullName: "Myth 1/6" } : null,
  stats: [{ id: 40, name: "Versatility" }], tags: myth ? ["Mythic"] : [], sockets: 0, craftedStats: [40], unknownBonusIds: [], detailsIncomplete: false,
  bonusLists: [12849], modifiers: [{ type: 29, value: 40 }], context: null,
  wowhead: { url: "https://www.wowhead.com/item=271434?bonus=12849&crafted-stats=40", tooltip: "item=271434&bonus=12849&crafted-stats=40" },
  realms: [1, 2].map((id) => ({ connectedRealmId: id, minBuyout: level * id, totalQuantity: 1, numAuctions: 1, observedAt: "2026-09-14T00:00:00Z" })),
});
const listings = (id: string): GearListingsResponse => ({ listings: [{ id, buyout: 101, quantity: 3, bid: null, timeLeft: "LONG" }], total: 1, totalPages: 1, page: 1, observedAt: "2026-09-14T00:00:00Z", detailsAvailable: true });
beforeEach(() => { state.realm = { ...state.realm, status: "ready", selectedId: 1 }; state.variants.mockReset(); state.listings.mockReset(); });
afterEach(cleanup);

test("filters the same versions across the realm comparison and listings, retaining Wowhead identity", async () => {
  state.variants.mockResolvedValue({ dataVersion: { wowBuild: "12.1.0.69814" }, variants: [variant("myth", 318, true), variant("other", 282)] });
  state.listings.mockResolvedValue(listings("9001"));
  render(<GearMarket item={item} />);
  fireEvent.change(await screen.findByLabelText("Upgrade track"), { target: { value: "618" } });
  expect(screen.queryByText("ilvl 282")).toBeNull();
  expect(screen.getByText("1 versions · 2 connected realms")).toBeTruthy();
  const auction = await screen.findByText("#9001");
  expect(auction.getAttribute("data-wowhead")).toContain("bonus=12849&crafted-stats=40");
  expect(state.listings).toHaveBeenCalledWith(271434, 1, "myth", 1);
  const realmButton = screen.getByRole("button", { name: /Alpha/, pressed: true });
  expect(realmButton.getAttribute("title")).toBe("Alpha / Beta");
});

test("a late response from the previous realm cannot replace the selected realm's listings", async () => {
  state.variants.mockResolvedValue({ dataVersion: { wowBuild: "12.1.0.69814" }, variants: [variant("single", 318)] });
  let finishFirst!: (value: GearListingsResponse) => void;
  state.listings.mockImplementation((_item: number, realm: number) => realm === 1 ? new Promise<GearListingsResponse>((resolve) => { finishFirst = resolve; }) : Promise.resolve(listings("realm-two")));
  const view = render(<GearMarket item={item} />);
  await waitFor(() => expect(state.listings).toHaveBeenCalledWith(271434, 1, "single", 1));
  state.realm = { ...state.realm, status: "ready", selectedId: 2 };
  view.rerender(<GearMarket item={item} />);
  await screen.findByText("#realm-two");
  await act(async () => finishFirst(listings("stale-first-realm")));
  expect(screen.queryByText("#stale-first-realm")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Buyout listings" })).getByText("#realm-two")).toBeTruthy();
});

test("a single untracked version opens directly without irrelevant filters", async () => {
  state.variants.mockResolvedValue({ dataVersion: { wowBuild: "12.1.0.69814" }, variants: [variant("single", 5)] });
  state.listings.mockResolvedValue(listings("single-auction"));
  render(<GearMarket item={item} />);
  await screen.findByText("#single-auction");
  expect(screen.queryByLabelText("Upgrade track")).toBeNull();
  expect(screen.queryByLabelText("Item level")).toBeNull();
});
