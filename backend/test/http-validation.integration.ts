import "./support/local-env";
import { afterAll, expect, test } from "bun:test";
import app from "../src/app";
import { sql } from "../src/db";

afterAll(async () => {
  await sql`DELETE FROM items WHERE id BETWEEN 1900080001 AND 1900080006`;
  await sql.end();
});

test("malformed pagination and out-of-range IDs return client errors, not database failures", async () => {
  for (const path of [
    "/api/items?page=1.5", "/api/items?limit=1.5", "/api/items?limit=Infinity",
    "/api/items/2147483648", "/api/items/1.5/prices", "/api/items/Infinity/realm-prices",
    "/api/items?connectedRealmId=2147483648", "/api/items/1/prices?connectedRealmId=2147483648",
    "/api/professions/1.5", "/api/professions/2147483648/recipes",
    "/api/crafting/recipes/Infinity", "/api/crafting/professions/1.5",
    "/api/crafting/recipes/1/history?connectedRealmId=2147483648",
    "/api/market/summary?connectedRealmId=2147483648", "/api/flipping/opportunities?limit=1.5",
    "/api/flipping/opportunities?minSpread=Infinity",
  ]) {
    const response = await app.request(path);
    expect(response.status, path).toBe(400);
    expect((await response.json() as { error: string }).error, path).toBeString();
  }
});

test("equal-name items have stable page boundaries and out-of-range pages recover to the last page", async () => {
  for (const id of [1900080006, 1900080003, 1900080005, 1900080001, 1900080004, 1900080002]) {
    await sql`INSERT INTO items (id, name) VALUES (${id}, 'Pagination fixture')`;
  }
  const seen: number[] = [];
  for (const page of [1, 2, 3]) {
    const response = await app.request(`/api/items?search=Pagination%20fixture&limit=2&page=${page}`);
    expect(response.status).toBe(200);
    const data = await response.json() as { items: { id: number }[] };
    seen.push(...data.items.map((item) => item.id));
  }
  expect(seen).toEqual([1900080001, 1900080002, 1900080003, 1900080004, 1900080005, 1900080006]);
  const response = await app.request('/api/items?search=Pagination%20fixture&limit=2&page=5000');
  const data = await response.json() as { page: number; totalPages: number; items: { id: number }[] };
  expect(data.page).toBe(3);
  expect(data.totalPages).toBe(3);
  expect(data.items.map((item) => item.id)).toEqual([1900080005, 1900080006]);
});
