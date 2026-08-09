import { describe, expect, test } from "bun:test";
import { isFresh, toTimestampMs } from "./freshness-policy";

describe("price freshness", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");

  test("treats missing and invalid timestamps as stale", () => {
    expect(isFresh(null, 60, now)).toBe(false);
    expect(isFresh("not-a-date", 60, now)).toBe(false);
    expect(toTimestampMs(undefined)).toBeNull();
  });

  test("uses each feed timestamp against the configured maximum age", () => {
    expect(isFresh("2026-08-09T11:01:00Z", 60, now)).toBe(true);
    expect(isFresh("2026-08-09T11:00:00Z", 60, now)).toBe(false);
  });
});
