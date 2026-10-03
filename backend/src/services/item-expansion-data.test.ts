import { expect, test } from "bun:test";
import { readBundledItemExpansions } from "./item-expansion-data";

test("the offline reference includes known historical and Midnight items without an unbounded fallback", async () => {
  const data = await readBundledItemExpansions();
  expect(data.expansions['2447']).toBe(1); // Peacebloom
  expect(data.expansions['210796']).toBe(11); // Mycobloom
  expect(data.expansions['236761']).toBe(12); // Tranquility Bloom
  expect(data.expansions['1900200001']).toBeUndefined();
  expect(new Set(Object.values(data.expansions)).size).toBe(12);
  expect(data.metadata.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
});
