import { describe, expect, test } from "bun:test";
import { normalizeRealmVariant, summarizePrices } from "./auction-aggregation";

describe("auction aggregation", () => {
  test("uses quantity-weighted price statistics", () => {
    expect(
      summarizePrices([
        { price: 100, quantity: 9 },
        { price: 1_000, quantity: 1 },
      ]),
    ).toEqual({
      minPrice: 100,
      avgPrice: 190,
      medianPrice: 100,
      maxPrice: 1_000,
      totalQuantity: 10,
      numAuctions: 2,
      priceP10: 100,
      priceP25: 100,
      totalValue: "1900",
    });
  });

  test("keeps weighted totals precise beyond Number safe multiplication", () => {
    const result = summarizePrices([{ price: 100_000_000_000, quantity: 1_000_000 }]);
    expect(result?.avgPrice).toBe(100_000_000_000);
    expect(result?.totalValue).toBe("100000000000000000");
  });

  test("preserves the listed stack value before per-unit rounding", () => {
    const summary = summarizePrices([{ price: 33, quantity: 3, totalPrice: 100 }]);
    expect(summary?.totalValue).toBe("100");
    expect(summary?.avgPrice).toBe(33);
  });

  test("returns null when no valid listings remain", () => {
    expect(summarizePrices([{ price: 0, quantity: 1 }])).toBeNull();
  });

  test("canonicalizes equivalent realm variants", () => {
    const first = normalizeRealmVariant({
      context: 1,
      bonus_lists: [20, 10],
      modifiers: [
        { type: 9, value: 80 },
        { type: 1, value: 2 },
      ],
    });
    const second = normalizeRealmVariant({
      context: 1,
      bonus_lists: [10, 20],
      modifiers: [
        { type: 1, value: 2 },
        { type: 9, value: 80 },
      ],
    });

    expect(first.key).toBe(second.key);
    expect(normalizeRealmVariant({}).key).toBe("base");
  });
});
