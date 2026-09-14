import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SelectedRealmState } from "@/lib/selected-realm";
import type { ProfessionRecipeCost } from "@/lib/api";

const realmState = vi.hoisted<{ current: SelectedRealmState }>(() => ({
  current: { status: "ready", options: [{ id: 1, label: "One", fullLabel: "One" }], selectedId: 1 },
}));

vi.mock("@/lib/selected-realm", () => ({
  useSelectedRealm: () => realmState.current,
}));

import { useProfessionValuation, type ProfessionValuationAdapter } from "./profession-valuation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("profession valuation feature interface", () => {
  beforeEach(() => {
    realmState.current = { status: "ready", options: [{ id: 1, label: "One", fullLabel: "One" }], selectedId: 1 };
  });

  test("never presents a stale realm response as the current result", async () => {
    const first = deferred<ProfessionRecipeCost[]>();
    const second = deferred<ProfessionRecipeCost[]>();
    const adapter: ProfessionValuationAdapter = {
      load: (_professionId, connectedRealmId) => (connectedRealmId === 1 ? first.promise : second.promise),
    };
    const { result, rerender } = renderHook(() => useProfessionValuation(100, adapter));

    realmState.current = { status: "ready", options: [{ id: 2, label: "Two", fullLabel: "Two" }], selectedId: 2 };
    rerender();
    await act(async () => first.resolve([]));
    expect(result.current.status).toBe("loading");

    await act(async () => second.resolve([]));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([]);
  });
});
