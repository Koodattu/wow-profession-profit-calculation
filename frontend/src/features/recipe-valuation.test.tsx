import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError, type RecipeProfitResult } from "@/lib/api";

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

test.each([[404, "not-found"], [503, "error"]])("HTTP %s distinguishes a missing recipe from a retryable outage", async (status, expected) => {
  const adapter = { loadValuation: vi.fn().mockRejectedValue(new ApiError(Number(status), "Fixture error")), loadHistory: vi.fn().mockResolvedValue({}) };
  const { result } = renderHook(() => useRecipeValuation(1, "24h", adapter));
  await waitFor(() => expect(result.current.status).toBe(expected));
  expect(result.current.recipe).toBeNull();
});

test("a removed recipe hides old quotes, and its absence cannot leak into another recipe", async () => {
  const recipe: RecipeProfitResult = { recipeId: 1, recipeName: "Fixture", qualityTierType: "none",
    affectedByMulticraft: false, affectedByResourcefulness: false, professionId: 1, professionName: "Alchemy", scenarios: [] };
  const adapter = { loadValuation: vi.fn().mockResolvedValueOnce(recipe).mockRejectedValueOnce(new ApiError(404, "Removed")).mockResolvedValue({ ...recipe, recipeId: 2 }),
    loadHistory: vi.fn().mockResolvedValue({}) };
  const { result, rerender } = renderHook(({ id }) => useRecipeValuation(id, "24h", adapter), { initialProps: { id: 1 } });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe("not-found"));
  expect(result.current.recipe).toBeNull();
  rerender({ id: 2 });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.recipe?.recipeId).toBe(2);
});
