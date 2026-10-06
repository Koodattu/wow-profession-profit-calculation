import { afterEach, expect, test, vi } from "vitest";
import ItemPage from "./items/[id]/page";
import ProfessionPage from "./professions/[id]/page";
import RecipePage from "./recipes/[id]/page";

afterEach(() => { vi.unstubAllGlobals(); });

test.each([ItemPage, ProfessionPage, RecipePage])("invalid catalog IDs produce not-found without sending invalid API requests: %s", async (Page) => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const id of ["unknown", "0", "-1", "1.5", "2147483648"]) {
    await expect(Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  }
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([ItemPage, ProfessionPage])("missing catalog entries show not-found while an outage remains retryable: %s", async (Page) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Not found" }, { status: 404 })));
  await expect(Page({ params: Promise.resolve({ id: "99999999" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unavailable" }, { status: 503 })));
  await expect(Page({ params: Promise.resolve({ id: "1" }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ status: 503 });
});
