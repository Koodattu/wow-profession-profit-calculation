import { describe, expect, test } from "bun:test";
import { isRetryableStatus, parseRetryAfter, retryDelayMs } from "./request-policy";

describe("request retry policy", () => {
  test("retries rate limits, timeouts, and transient server failures", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  test("parses Retry-After seconds and HTTP dates", () => {
    const now = Date.parse("2026-08-09T12:00:00Z");
    expect(parseRetryAfter("2", now)).toBe(2_000);
    expect(parseRetryAfter("Sun, 09 Aug 2026 12:00:05 GMT", now)).toBe(5_000);
    expect(parseRetryAfter("invalid", now)).toBeNull();
  });

  test("uses capped exponential fallback delays", () => {
    expect(retryDelayMs(0)).toBe(1_000);
    expect(retryDelayMs(3)).toBe(8_000);
    expect(retryDelayMs(10)).toBe(30_000);
  });
});
