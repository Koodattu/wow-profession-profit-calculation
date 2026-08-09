import { describe, expect, test } from "bun:test";
import { calculateGrossProfit } from "./profit-policy";

describe("gross profit policy", () => {
  test("calculates gross profit when all prices are available", () => {
    expect(calculateGrossProfit(15_000, 9_000, true)).toBe(6_000);
  });

  test("does not present missing reagent prices as zero cost", () => {
    expect(calculateGrossProfit(15_000, 0, false)).toBeNull();
    expect(calculateGrossProfit(null, 9_000, true)).toBeNull();
  });
});
