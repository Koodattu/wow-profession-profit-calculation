import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MarketSummary } from "@/lib/api";
import { selectedRealm } from "@/lib/selected-realm";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import MarketDashboard from "./MarketDashboard";

const summary: MarketSummary = { region: "eu", itemCount: 42, commodityCount: 21, realmItemCount: 21,
  pendingMetadataCount: 0, commodityObservedAt: null, realmOldestObservedAt: null,
  realmNewestObservedAt: null, connectedRealmCount: 2, selectedRealm: null };
const summaryRequest = vi.fn<() => Promise<Response>>();
beforeEach(async () => {
  summaryRequest.mockReset().mockImplementation(async () => Response.json(summary));
  navigation.push.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (new URL(input).pathname === "/api/realms") return Response.json([]);
    return summaryRequest();
  }));
  await selectedRealm.retry();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("unavailable market status stops loading and retries without losing the search", async () => {
  summaryRequest.mockRejectedValueOnce(new Error("offline"));
  render(<MarketDashboard />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search auction house items" }), { target: { value: "ore" } });
  await screen.findByText(/Market status is temporarily unavailable/);
  expect(screen.queryAllByText("Loading…")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Retry market status" }));
  await screen.findByText("42");
  expect(screen.getByRole("textbox", { name: "Search auction house items" })).toHaveValue("ore");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(navigation.push).toHaveBeenCalledWith("/items?search=ore");
  expect(screen.queryByRole("alert")).toBeNull();
});
