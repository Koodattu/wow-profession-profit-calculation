import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SelectedRealmState } from "@/lib/selected-realm";

const realmState = vi.hoisted<{ current: SelectedRealmState }>(() => ({
  current: { status: "selection-required", options: [{ id: 1, label: "One", fullLabel: "One" }], selectedId: null },
}));

vi.mock("@/lib/selected-realm", () => ({
  useSelectedRealm: () => realmState.current,
}));

import { useItemBrowser, type ItemBrowserAdapter } from "./item-browser";

describe("item browser feature interface", () => {
  test("loads region commodities before a realm is selected", async () => {
    const adapter: ItemBrowserAdapter = {
      load: vi.fn(async () => ({ items: [], total: 0, page: 1, totalPages: 0 })),
    };
    const { result } = renderHook(() =>
      useItemBrowser({ type: "commodity", page: 1, limit: 50 }, adapter),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(adapter.load).toHaveBeenCalledWith({ type: "commodity", search: undefined, page: 1, limit: 50 });
  });

  test("requires a realm for mixed or realm-specific browsing", () => {
    const adapter: ItemBrowserAdapter = {
      load: vi.fn(async () => ({ items: [], total: 0, page: 1, totalPages: 0 })),
    };
    const { result } = renderHook(() => useItemBrowser({ page: 1, limit: 50 }, adapter));

    expect(result.current.status).toBe("selection-required");
    expect(adapter.load).not.toHaveBeenCalled();
  });
});
