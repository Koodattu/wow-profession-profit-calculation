import { describe, expect, test } from "bun:test";
import { decodeGear, type GearIdentity } from "./gear-decoder";
import { getGearData, type GearData } from "./gear-data";

const identity = (itemId: number, bonusLists: number[] = [], modifiers: GearIdentity["modifiers"] = []): GearIdentity => ({ itemId, bonusLists, modifiers, context: null });

describe("gear decoding against bundled live reference", () => {
  test.each([[12826, 282, "Veteran", 2], [12833, 292, "Champion", 1], [12841, 305, "Hero", 1], [12849, 318, "Myth", 1], [12854, 334, "Myth", 6]] as const)("Mantle bonus %i selects the actual rank", (bonus, level, track, rank) => {
    const result = decodeGear(identity(271434, [bonus, 6652], [{ type: 29, value: 40 }, { type: 30, value: 49 }]));
    expect(result.itemLevel).toBe(level);
    expect(result.upgrade).toMatchObject({ name: track, level: rank, max: 6 });
    expect(result.stats.map((stat) => stat.name)).toEqual(["Intellect", "Stamina", "Versatility", "Mastery"]);
  });

  test("crafted offsets apply after the older era is squished", () => {
    expect(decodeGear(identity(215135, [10421, 9633, 8902, 10879, 10396, 9627, 12050, 10520, 8960, 8793, 12053])).itemLevel).toBe(160);
    expect(decodeGear(identity(239664, [12214, 8960, 12494, 12066, 13622, 12667])).itemLevel).toBe(275);
  });

  test("legacy items do not acquire an upgrade track", () => {
    const result = decodeGear(identity(33820));
    expect(result.itemLevel).toBe(5);
    expect(result.upgrade).toBeNull();
    expect(result.wowhead.tooltip).toBe("item=33820");
  });

  test("drop-level scaling requires the auction modifier", () => {
    const bonuses = [13573, 13613, 13615, 6652];
    expect(decodeGear(identity(248039, bonuses, [{ type: 9, value: 80 }])).itemLevel).toBe(126);
    expect(decodeGear(identity(248039, bonuses)).itemLevel).toBeNull();
  });

  test("unknown bonuses are retained, and tooltips get the complete bonus and crafted-stat identity", () => {
    const result = decodeGear(identity(271434, [12849, 13335, 987654321], [{ type: 29, value: 32 }, { type: 30, value: 36 }]));
    expect(result.unknownBonusIds).toEqual([987654321]);
    expect(result.detailsIncomplete).toBe(true);
    const params = new URLSearchParams(result.wowhead.tooltip);
    expect(params.get("bonus")).toBe("12849:13335:987654321");
    expect(params.get("crafted-stats")).toBe("32:36");
    expect(result.wowhead.tooltip).toContain("crafted-stats=32:36");
    expect(params.has("ilvl")).toBe(false);
    expect(params.has("mods")).toBe(false);
    expect(new URL(result.wowhead.url).searchParams.get("bonus")).toBe(params.get("bonus"));
  });
});

describe("ambiguous and recursive gear identities", () => {
  const data: GearData = {
    metadata: getGearData().metadata,
    items: { 1: { id: 1, itemLevel: 100, squishEra: 2, itemClass: 4, stats: [{ id: 24, alloc: 5000 }, { id: 25, alloc: 5000 }] } },
    bonuses: {
      1: { id: 1, itemLevel: { amount: 200, priority: 10, squishEra: 2 } },
      2: { id: 2, itemLevel: { amount: 300, priority: 10, squishEra: 2 } },
      3: { id: 3, applyBonusId: 1, socket: 1 },
      4: { id: 4, dropLevelCurve: { curveId: 1, offset: 6, priority: 10, squishEra: 2 } },
      5: { id: 5, applyBonusId: 5 },
      6: { id: 6, craftedStats: [40, 49] },
    },
    curves: { 1: { points: [{ playerLevel: 70, itemLevel: 100 }, { playerLevel: 90, itemLevel: 200 }] } },
    eras: [{ id: 2, curveId: 0 }], contentTuning: { 10: { minLevelSquish: 70, maxLevelSquish: 80 } },
  };
  test("conflicting equal-priority bonuses cannot be resolved by sorted bonus order", () => {
    expect(decodeGear(identity(1, [1, 2]), data).itemLevel).toBeNull();
    expect(decodeGear(identity(1, [2, 1]), data).itemLevel).toBeNull();
  });
  test("recursive bonuses apply once and cycles terminate", () => {
    const result = decodeGear(identity(1, [3, 1, 5]), data);
    expect(result.itemLevel).toBe(200);
    expect(result.sockets).toBe(1);
  });
  test("content tuning caps the drop level before interpolating", () => {
    const result = decodeGear(identity(1, [4], [{ type: 9, value: 90 }, { type: 28, value: 10 }]), data);
    expect(result.itemLevel).toBe(156);
    expect(new URLSearchParams(result.wowhead.tooltip).get("lvl")).toBe("80");
  });
  test("missives override placeholder stats without inventing extra secondary stats", () => {
    const result = decodeGear(identity(1, [6], [{ type: 29, value: 32 }, { type: 30, value: 36 }]), data);
    expect(result.stats.map((stat) => stat.id)).toEqual([40, 49]);
  });
  test("an absent base item remains explicitly incomplete", () => {
    expect(decodeGear(identity(999), data)).toMatchObject({ itemLevel: null, upgrade: null, detailsIncomplete: true });
  });
});
