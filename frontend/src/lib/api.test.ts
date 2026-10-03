import { describe, expect, test } from "vitest";
import { formatPrice } from "./api";

describe("displayed market values", () => {
  test("zero profit is a known value, not missing data", () => {
    expect(formatPrice(0)).toBe("0g 0s");
    expect(formatPrice(-10000)).toBe("−1g 0s");
    expect(formatPrice(12345678)).toBe("1 234g 56s");
  });
});
