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
  expect(screen.queryByRole("button", { name: /View listings for ilvl 282/ })).toBeNull();
  expect(screen.getByRole("heading", { name: "1 version on Alpha (+1)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /View listings for ilvl 318/ }));
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
  render(<GearMarket item={item} />);
  fireEvent.click(await screen.findByRole("button", { name: /View listings for ilvl 318/ }));
  await waitFor(() => expect(state.listings).toHaveBeenCalledWith(271434, 1, "single", 1));
  fireEvent.change(screen.getByLabelText("Compare this version on other realms"), { target: { value: "2" } });
  await screen.findByText("#realm-two");
  await act(async () => finishFirst(listings("stale-first-realm")));
  expect(screen.queryByText("#stale-first-realm")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Buyout listings" })).getByText("#realm-two")).toBeTruthy();
  expect(state.realm.selectedId).toBe(1);
});

test("a single untracked version has no irrelevant filters and its listings open in place", async () => {
  state.variants.mockResolvedValue({ dataVersion: { wowBuild: "12.1.0.69814" }, variants: [variant("single", 5)] });
  state.listings.mockResolvedValue(listings("single-auction"));
  render(<GearMarket item={item} />);
  fireEvent.click(await screen.findByRole("button", { name: /View listings for ilvl 5/ }));
  await screen.findByText("#single-auction");
  expect(screen.queryByLabelText("Upgrade track")).toBeNull();
  expect(screen.queryByLabelText("Item level")).toBeNull();
});

test("sorts by cheapest buyout by default and switches scope without changing the saved realm", async () => {
  const expensive = variant("expensive", 328, true);
  const cheap = variant("cheap", 279);
  cheap.realms[1].minBuyout = 100;
  state.variants.mockResolvedValue({ dataVersion: {}, variants: [expensive, cheap] });
  render(<GearMarket item={item} />);
  await screen.findByRole("button", { name: /View listings for ilvl 279/ });
  expect(screen.getAllByRole("button", { name: /View listings for/ })[0]).toHaveAccessibleName(/ilvl 279/);
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "level" } });
  expect(screen.getAllByRole("button", { name: /View listings for/ })[0]).toHaveAccessibleName(/ilvl 328/);
  fireEvent.click(screen.getByRole("button", { name: "All EU realms" }));
  state.listings.mockResolvedValue(listings("cheapest-realm"));
  fireEvent.click(screen.getByRole("button", { name: /View listings for ilvl 279/ }));
  await screen.findByText("#cheapest-realm");
  expect(state.listings).toHaveBeenCalledWith(item.id, 2, "cheap", 1);
  expect(state.realm.selectedId).toBe(1);
});

test("combines both stat filters and can recover from an empty result", async () => {
  const myth = variant("myth", 318, true);
  myth.stats.push({ id: 32, name: "Critical Strike" });
  const other = variant("other", 282);
  other.stats = [{ id: 36, name: "Haste" }, { id: 5, name: "Intellect" }];
  state.variants.mockResolvedValue({ dataVersion: {}, variants: [myth, other] });
  render(<GearMarket item={item} />);
  fireEvent.change(await screen.findByLabelText("Stat"), { target: { value: "40" } });
  fireEvent.change(screen.getByLabelText("Additional stat"), { target: { value: "32" } });
  expect(screen.getAllByRole("button", { name: /View listings for/ })).toHaveLength(1);
  expect(screen.queryByRole("option", { name: "Intellect" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Item level"), { target: { value: "282" } });
  expect(screen.getByRole("heading", { name: /No matching offers/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getAllByRole("button", { name: /View listings for/ })).toHaveLength(2);
});

test("changing realms resets version pagination instead of leaving a blank page", async () => {
  const variants = Array.from({ length: 15 }, (_, index) => variant(`v${index}`, 280 + index));
  state.variants.mockResolvedValue({ dataVersion: {}, variants });
  const view = render(<GearMarket item={item} />);
  await screen.findByRole("button", { name: /View listings for ilvl 280/ });
  fireEvent.click(screen.getByRole("button", { name: "Next →" }));
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  state.realm = { ...state.realm, status: "ready", selectedId: 2 };
  view.rerender(<GearMarket item={item} />);
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
});

test("shows an actionable other-realm empty state and falls back to EU without a saved realm", async () => {
  const elsewhere = variant("elsewhere", 318);
  elsewhere.realms = elsewhere.realms.filter((realm) => realm.connectedRealmId === 2);
  state.variants.mockResolvedValue({ dataVersion: {}, variants: [elsewhere] });
  const view = render(<GearMarket item={item} />);
  fireEvent.click(await screen.findByRole("button", { name: "Search all EU realms" }));
  expect(screen.getByRole("button", { name: /View listings for ilvl 318/ })).toBeTruthy();
  state.realm = { ...state.realm, status: "selection-required", selectedId: null };
  view.rerender(<GearMarket item={item} />);
  expect(screen.getByRole("button", { name: "All EU realms" })).toHaveAttribute("aria-pressed", "true");
});

test("closes with Escape, restores focus, and preserves filters", async () => {
  state.variants.mockResolvedValue({ dataVersion: {}, variants: [variant("myth", 318, true), variant("other", 282)] });
  state.listings.mockResolvedValue(listings("9001"));
  render(<GearMarket item={item} />);
  fireEvent.change(await screen.findByLabelText("Upgrade track"), { target: { value: "618" } });
  const offer = screen.getByRole("button", { name: /View listings for ilvl 318/ });
  offer.focus();
  fireEvent.click(offer);
  const dialog = await screen.findByRole("dialog", { name: item.name });
  expect(dialog).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(offer).toHaveFocus();
  expect(screen.getByLabelText("Upgrade track")).toHaveValue("618");
});

test("retries a failed listing request and retains stack quantity and exact tooltip identity", async () => {
  state.variants.mockResolvedValue({ dataVersion: {}, variants: [variant("stack", 5)] });
  state.listings.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(listings("stack-auction"));
  render(<GearMarket item={item} />);
  fireEvent.click(await screen.findByRole("button", { name: /View listings for ilvl 5/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  const auction = await screen.findByRole("link", { name: "View item tooltip for auction stack-auction" });
  expect(auction).toHaveAttribute("data-wowhead", "item=271434&bonus=12849&crafted-stats=40");
  expect(within(auction.closest("tr")!).getByText("3")).toBeTruthy();
  expect(within(auction.closest("tr")!).getByText("0g 0s each")).toBeTruthy();
});
