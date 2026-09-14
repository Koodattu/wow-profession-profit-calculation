import { describe, expect, test } from "bun:test";
import { createBlizzardClient, type BlizzardClientDependencies } from "./blizzard-client";

type TimedFetch = NonNullable<BlizzardClientDependencies["timedFetch"]>;

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Fixture Error",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function createFixtureClient(timedFetch: TimedFetch, overrides: Partial<BlizzardClientDependencies> = {}) {
  return createBlizzardClient({
    clientId: "fixture-client",
    clientSecret: "fixture-secret",
    requestTimeoutMs: 500,
    maxRetries: 2,
    timedFetch,
    wait: async () => {},
    ...overrides,
  });
}

function authorization(init: RequestInit): string | null {
  return new Headers(init.headers).get("Authorization");
}

describe("authenticated Blizzard client", () => {
  test("concurrent requests share one token refresh", async () => {
    let tokenRequests = 0;
    let apiRequests = 0;
    const client = createFixtureClient(async (input, init) => {
      if (String(input).includes("oauth.battle.net")) {
        tokenRequests++;
        await Promise.resolve();
        return jsonResponse({ access_token: "shared-token", expires_in: 3600 });
      }

      apiRequests++;
      expect(authorization(init)).toBe("Bearer shared-token");
      return jsonResponse({ id: apiRequests });
    });

    const results = await Promise.all([
      client.get<{ id: number }>("eu", "/data/wow/item/1", "static"),
      client.get<{ id: number }>("eu", "/data/wow/item/2", "static"),
    ]);

    expect(tokenRequests).toBe(1);
    expect(apiRequests).toBe(2);
    expect(results.map((result) => result.id).sort()).toEqual([1, 2]);
  });

  test("a 401 invalidates the used token and replays once", async () => {
    let tokenRequests = 0;
    let apiRequests = 0;
    const client = createFixtureClient(async (input, init) => {
      if (String(input).includes("oauth.battle.net")) {
        tokenRequests++;
        return jsonResponse({ access_token: `token-${tokenRequests}`, expires_in: 3600 });
      }

      apiRequests++;
      if (apiRequests === 1) {
        expect(authorization(init)).toBe("Bearer token-1");
        return jsonResponse({}, 401);
      }
      expect(authorization(init)).toBe("Bearer token-2");
      return jsonResponse({ ok: true });
    });

    await expect(client.get("eu", "/data/wow/item/1", "static")).resolves.toEqual({ ok: true });
    expect(tokenRequests).toBe(2);
    expect(apiRequests).toBe(2);
  });

  test("rate limits honor Retry-After before retrying", async () => {
    const delays: number[] = [];
    let apiRequests = 0;
    const client = createFixtureClient(
      async (input) => {
        if (String(input).includes("oauth.battle.net")) {
          return jsonResponse({ access_token: "token", expires_in: 3600 });
        }

        apiRequests++;
        if (apiRequests === 1) return jsonResponse({}, 429, { "Retry-After": "2" });
        return jsonResponse({ ok: true });
      },
      {
        wait: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );

    await client.get("eu", "/data/wow/item/1", "static");
    expect(apiRequests).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  test("request errors exhaust the bounded retry policy", async () => {
    const delays: number[] = [];
    let apiRequests = 0;
    const client = createFixtureClient(
      async (input) => {
        if (String(input).includes("oauth.battle.net")) {
          return jsonResponse({ access_token: "token", expires_in: 3600 });
        }
        apiRequests++;
        throw new Error("fixture timeout");
      },
      {
        maxRetries: 2,
        wait: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );

    let requestError: unknown;
    try {
      await client.get("eu", "/data/wow/item/1", "static");
    } catch (error) {
      requestError = error;
    }

    expect(requestError).toBeInstanceOf(Error);
    expect((requestError as Error).message).toContain("fixture timeout");
    expect(apiRequests).toBe(3);
    expect(delays).toEqual([1_000, 2_000]);
  });

  test("pagination stays behind the same authenticated interface", async () => {
    let tokenRequests = 0;
    const requestedPages: string[] = [];
    const client = createFixtureClient(async (input) => {
      if (String(input).includes("oauth.battle.net")) {
        tokenRequests++;
        return jsonResponse({ access_token: "token", expires_in: 3600 });
      }

      const page = new URL(String(input)).searchParams.get("_page") ?? "missing";
      requestedPages.push(page);
      return jsonResponse({ results: [Number(page)], _pageCount: 3 });
    });

    const results = await client.getAllPages<number>("eu", "/data/wow/search/item", "static");
    expect(results).toEqual([1, 2, 3]);
    expect(requestedPages).toEqual(["1", "2", "3"]);
    expect(tokenRequests).toBe(1);
  });
});
