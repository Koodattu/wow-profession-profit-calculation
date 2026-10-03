import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { RecipeProfitResult } from "@/lib/api";

vi.mock("@/lib/selected-realm", () => ({
  useSelectedRealm: () => ({ status: "ready", selectedId: 1, options: [] }),
}));
import { useRecipeValuation } from "./recipe-valuation";

test("history failure stays distinct from empty history and can recover without reloading the valuation", async () => {
  const recipe: RecipeProfitResult = { recipeId: 1, recipeName: "Fixture", qualityTierType: "none",
    affectedByMulticraft: false, affectedByResourcefulness: false, professionId: 1, professionName: "Alchemy", scenarios: [] };
  const history = { "r1-r1": [{ time: "2026-10-03T08:00:00Z", cost: 100, output: 200, outputQuantity: 1 }] };
  const adapter = { loadValuation: vi.fn(async () => recipe),
    loadHistory: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(history) };
  const { result } = renderHook(() => useRecipeValuation(1, "24h", adapter));
  await waitFor(() => expect(result.current.recipe).toEqual(recipe));
  expect(result.current.historyFailed).toBe(true);
  expect(result.current.historyLoading).toBe(false);
  act(() => result.current.retryHistory());
  await waitFor(() => expect(result.current.history).toEqual(history));
  expect(result.current.historyFailed).toBe(false);
  expect(adapter.loadValuation).toHaveBeenCalledTimes(1);
});
