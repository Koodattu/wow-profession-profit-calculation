import { describe, expect, test } from "bun:test";
import { calculateGrossProfit } from "./profit-policy";

describe("gross profit policy", () => {
  test("calculates gross profit when all prices are available", () => {
    expect(calculateGrossProfit(15_000, 9_000)).toBe(6_000);
  });

  test("does not present missing reagent prices as zero cost", () => {
    expect(calculateGrossProfit(15_000, null)).toBeNull();
    expect(calculateGrossProfit(null, 9_000)).toBeNull();
  });
});
