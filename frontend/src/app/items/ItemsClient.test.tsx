import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ItemsClient from "./ItemsClient";
import NavSettings from "../NavSettings";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("type=realm") }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

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
