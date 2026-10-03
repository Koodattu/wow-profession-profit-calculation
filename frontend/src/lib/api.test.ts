import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchProfessions, formatPrice } from "./api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("displayed market values", () => {
  test("zero profit is a known value, not missing data", () => {
    expect(formatPrice(0)).toBe("0g 0s");
    expect(formatPrice(-10000)).toBe("−1g 0s");
    expect(formatPrice(12345678)).toBe("1 234g 56s");
  });
});

describe("HTTP request deadline", () => {
  test.each(["headers", "body"])("a stalled response %s rejects after 15 seconds", async (stage) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (stage === "headers") return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      } })));
    }));
    let outcome: unknown = "pending";
    void fetchProfessions().then((value) => { outcome = value; }, (error) => { outcome = error; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(outcome).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([200, 503])("a completed HTTP %s response releases its deadline", async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([], { status })));
    const result = await fetchProfessions().catch((error: unknown) => error);
    if (status === 200) expect(result).toEqual([]);
    else expect(result).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
