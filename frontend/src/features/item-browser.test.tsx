import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SelectedRealmState } from "@/lib/selected-realm";

const realmState = vi.hoisted<{ current: SelectedRealmState }>(() => ({
  current: { status: "selection-required", options: [{ id: 1, label: "One", fullLabel: "One" }], selectedId: null },
}));

vi.mock("@/lib/selected-realm", () => ({
  useSelectedRealm: () => realmState.current,
}));

import { useItemBrowser, type ItemBrowserAdapter } from "./item-browser";

describe("item browser feature interface", () => {
  beforeEach(() => { realmState.current = { status: "selection-required", options: [], selectedId: null }; });

  test("retries a failed market request with the same search and page", async () => {
    const data = { items: [], total: 0, page: 2, totalPages: 0 };
    const adapter = { load: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(data) };
    const { result } = renderHook(() => useItemBrowser({ type: "commodity", search: "ore", page: 2, limit: 50 }, adapter));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(adapter.load).toHaveBeenLastCalledWith({ type: "commodity", search: "ore", page: 2, limit: 50 });
  });

  test("changing realm does not refetch EU-wide commodities", async () => {
    const adapter = { load: vi.fn(async () => ({ items: [], total: 0, page: 1, totalPages: 0 })) };
    const { result, rerender } = renderHook(() => useItemBrowser({ type: "commodity", page: 1, limit: 50 }, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    for (const selectedId of [1, 2]) {
      realmState.current = { status: "ready", options: [], selectedId };
      rerender();
      await waitFor(() => expect(result.current.status).toBe("ready"));
    }
    expect(adapter.load).toHaveBeenCalledTimes(1);
  });
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
