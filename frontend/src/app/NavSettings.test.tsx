import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import NavSettings from "./NavSettings";
import { selectedRealm } from "@/lib/selected-realm";

const groups = [
  { connected_realm_id: 1, realms: [{ name: "Dentarg" }, { name: "Tarren Mill" }] },
  { connected_realm_id: 2, realms: [{ name: "Confrérie du Thorium" }, { name: "Les Sentinelles" }] },
  { connected_realm_id: 3, realms: [{ name: "Ahn'Qiraj" }] },
];

beforeEach(async () => {
  localStorage.removeItem("wow-selected-connected-realm");
  window.history.replaceState(null, "", "/items?search=robe&realm=1");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(groups)));
  await selectedRealm.retry();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /^Connected realm:/ }));
  return within(screen.getByRole("dialog", { name: "Choose your realm" }));
}

test("finds secondary connected names and selects the shared market without losing URL context", () => {
  render(<NavSettings />);
  const picker = openPicker();
  fireEvent.change(picker.getByRole("searchbox", { name: "Search realms" }), { target: { value: "tarren mill" } });
  expect(picker.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(picker.getByRole("button", { name: "Dentarg / Tarren Mill" }));
  expect(selectedRealm.getSnapshot().selectedId).toBe(1);
  expect(localStorage.getItem("wow-selected-connected-realm")).toBe("1");
  expect(window.location.search).toBe("?search=robe&realm=1");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Connected realm: Dentarg (+1)" })).toHaveFocus();
});

test("search tolerates accents, spaces, apostrophes and capitalization", () => {
  render(<NavSettings />);
  const picker = openPicker();
  const input = picker.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "CONFRERIE" } });
  expect(picker.getByRole("button", { name: "Confrérie du Thorium / Les Sentinelles" })).toBeVisible();
  fireEvent.change(input, { target: { value: "ahn qiraj" } });
  expect(picker.getAllByRole("listitem")).toHaveLength(1);
  expect(picker.getByRole("button", { name: "Ahn'Qiraj" })).toBeVisible();
});

test("empty search recovers, cancellation preserves selection, and reopening resets the query", () => {
  selectedRealm.select(2);
  render(<NavSettings />);
  const picker = openPicker();
  expect(picker.getByRole("button", { name: "Confrérie du Thorium / Les Sentinelles" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(picker.getByRole("searchbox"), { target: { value: "no such realm" } });
  expect(picker.getByText(/No realms match/)).toBeVisible();
  fireEvent.click(picker.getByRole("button", { name: "Show all realms" }));
  expect(picker.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.change(picker.getByRole("searchbox"), { target: { value: "Dentarg" } });
  fireEvent.click(picker.getByRole("button", { name: "Close" }));
  expect(selectedRealm.getSnapshot().selectedId).toBe(2);
  expect(openPicker().getByRole("searchbox")).toHaveValue("");
});

test("updates a linked realm but leaves other filters intact, without adding realm to an unlinked page", () => {
  render(<NavSettings />);
  fireEvent.click(openPicker().getByRole("button", { name: "Ahn'Qiraj" }));
  expect(window.location.search).toBe("?search=robe&realm=3");
  window.history.replaceState(null, "", "/professions/171?search=potion");
  fireEvent.click(openPicker().getByRole("button", { name: "Dentarg / Tarren Mill" }));
  expect(window.location.search).toBe("?search=potion");
});

test("catalog failure has a retry and never offers a fabricated default realm", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await selectedRealm.retry();
  render(<NavSettings />);
  expect(screen.getByRole("button", { name: "Connected realm: Realms unavailable" })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry loading realms" })); });
  expect(screen.getByRole("button", { name: "Connected realm: Select a realm…" })).toBeEnabled();
});
