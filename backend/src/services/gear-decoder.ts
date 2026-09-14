import { getGearData, type GearBonus, type GearData } from "./gear-data";

export interface GearIdentity {
  itemId: number;
  bonusLists: number[];
  modifiers: { type: number; value: number }[];
  context: number | null;
}

const STAT_NAMES: Record<number, string> = {
  3: "Agility", 4: "Strength", 5: "Intellect", 7: "Stamina", 32: "Critical Strike", 36: "Haste", 40: "Versatility", 49: "Mastery",
  61: "Speed", 62: "Leech", 63: "Avoidance", 64: "Indestructible", 71: "Primary stat", 72: "Agility / Strength", 73: "Agility / Intellect", 74: "Strength / Intellect",
};

export function decodeGear(identity: GearIdentity, data: GearData = getGearData()) {
  const item = data.items[identity.itemId];
  const unknown = new Set<number>();
  const bonuses: GearBonus[] = [];
  const visited = new Set<number>();
  function expand(id: number) {
    if (visited.has(id)) return;
    visited.add(id);
    const bonus = data.bonuses[id];
    if (!bonus) { unknown.add(id); return; }
    bonuses.push(bonus);
    if (bonus.applyBonusId) expand(bonus.applyBonusId);
  }
  for (const id of identity.bonusLists) expand(id);
  const modifiers = new Map(identity.modifiers.map((modifier) => [modifier.type, modifier.value]));
  let dropLevel = modifiers.get(9);
  const tuningId = modifiers.get(28);
  const tuning = tuningId === undefined ? undefined : data.contentTuning?.[tuningId];
  if (dropLevel !== undefined && tuning && tuning.maxLevelSquish > 0) dropLevel = Math.min(dropLevel, tuning.maxLevelSquish);
  const craftedStats = [modifiers.get(29), modifiers.get(30)].filter((id): id is number => id !== undefined);
  const issues: string[] = [];
  if (dropLevel !== undefined && tuningId !== undefined && !tuning) issues.push("content-tuning");

  function curve(id: number, value: number): number | null {
    const points = data.curves[id]?.points;
    if (!points?.length) { issues.push("curve"); return null; }
    if (value <= points[0]!.playerLevel) return points[0]!.itemLevel;
    for (let i = 1; i < points.length; i++) {
      const right = points[i]!;
      if (value <= right.playerLevel) {
        const left = points[i - 1]!;
        return Math.round(left.itemLevel + (right.itemLevel - left.itemLevel) * (value - left.playerLevel) / (right.playerLevel - left.playerLevel));
      }
    }
    return points.at(-1)!.itemLevel;
  }

  let itemLevel: number | null = item?.itemLevel ?? null;
  let levelEra = item?.squishEra ?? 1;
  const eras = [...data.eras].sort((a, b) => a.id - b.id);
  const modern = bonuses.some((b) => b.itemLevel || b.dropLevelCurve || b.levelOffset || b.levelOffsetSecondary);
  const latestEra = eras.at(-1)!.id;
  let conflictingLevel = false;
  if (modern) {
    for (const era of [{ id: 0, curveId: 0 }, ...eras]) {
      if (era.curveId && era.id > levelEra && itemLevel !== null) { itemLevel = curve(era.curveId, itemLevel); levelEra = era.id; }
      const sets = bonuses.flatMap((b) => b.itemLevel && (b.itemLevel.squishEra ?? 0) === era.id ? [b.itemLevel] : []);
      const drops = bonuses.flatMap((b) => b.dropLevelCurve && (b.dropLevelCurve.squishEra ?? 0) === era.id ? [b.dropLevelCurve] : []);
      // Auction identities are canonicalized, so source order cannot resolve conflicting ties.
      const set = sets.reduce<typeof sets[number] | undefined>((chosen, entry) => !chosen || entry.priority <= chosen.priority ? entry : chosen, undefined);
      if (set && sets.some((entry) => entry.priority === set.priority && (entry.amount !== set.amount || entry.curveId !== set.curveId))) conflictingLevel = true;
      if (set) { itemLevel = set.curveId ? curve(set.curveId, set.amount) : set.amount; levelEra = era.id; }
      const drop = drops.reduce<typeof drops[number] | undefined>((chosen, entry) => !chosen || entry.priority <= chosen.priority ? entry : chosen, undefined);
      if (drop && drops.some((entry) => entry.priority === drop.priority && (entry.curveId !== drop.curveId || entry.offset !== drop.offset))) conflictingLevel = true;
      if (drop) {
        if (dropLevel === undefined) { itemLevel = null; issues.push("drop-level"); }
        else { const value = curve(drop.curveId, dropLevel); itemLevel = value === null ? null : value + drop.offset; }
      }
      const offsets = bonuses.filter((b) => b.levelOffset && (b.levelOffset.squishEra ?? 0) === era.id);
      if (itemLevel !== null) for (const b of offsets) itemLevel += b.levelOffset!.amount;
      if (era.id === latestEra && itemLevel !== null) for (const b of bonuses) itemLevel += b.levelOffsetSecondary?.amount ?? 0;
    }
  } else if (itemLevel !== null) {
    itemLevel += bonuses.reduce((sum, b) => sum + (b.level ?? 0), 0);
    for (const era of eras) if (era.curveId && era.id > (item?.squishEra ?? 1) && itemLevel !== null) itemLevel = curve(era.curveId, itemLevel);
    if (bonuses.some((b) => b.curveId)) { itemLevel = null; issues.push("legacy-scaling"); }
  }
  if (conflictingLevel || bonuses.some((b) => [b.itemLevel, b.dropLevelCurve, b.levelOffset].some((operation) => operation && !operation.squishEra))) {
    itemLevel = null; issues.push("ambiguous-scaling");
  }
  if (item?.itemClass === 19 && bonuses.some((b) => b.levelOffset?.craftingQuality !== undefined)) {
    // Profession equipment uses different quality scaling; never present a combat-gear estimate as exact.
    itemLevel = null; issues.push("profession-scaling");
  }
  const upgrades = bonuses.flatMap((b) => b.upgrade ? [b.upgrade] : []);
  const upgrade = upgrades.length === 1 ? upgrades[0]! : null;
  if (upgrades.length > 1) issues.push("upgrade-conflict");
  const statIds = new Set<number>();
  const statSource = modifiers.has(64) ? data.items[modifiers.get(64)!] : item;
  if (modifiers.has(64) && !statSource) issues.push("redirected-stats");
  const bonusStats = bonuses.flatMap((b) => b.craftedStats ?? []);
  const replacementStats = bonusStats.length ? bonusStats : craftedStats;
  for (const stat of statSource?.stats ?? []) {
    const id = stat.id === 24 ? replacementStats[0] : stat.id === 25 ? replacementStats[1] : stat.id;
    if (id === undefined && [24, 25].includes(stat.id)) issues.push("random-stats");
    if (id !== undefined && STAT_NAMES[id]) statIds.add(id);
  }
  for (const b of bonuses) for (const stat of b.rawStats ?? []) if (stat.amount > 0 && STAT_NAMES[stat.stat]) statIds.add(stat.stat);
  for (const id of bonusStats) if (STAT_NAMES[id]) statIds.add(id);
  const tags = [...new Set(bonuses.map((b) => b.tag).filter((tag): tag is string => !!tag))];
  const sockets = (item?.socketInfo?.sockets.length ?? 0) + bonuses.reduce((count, b) => count + (b.socket ?? 0), 0);
  const params = new URLSearchParams({ item: String(identity.itemId) });
  if (identity.bonusLists.length) params.set("bonus", identity.bonusLists.join(":"));
  if (craftedStats.length) params.set("crafted-stats", craftedStats.join(":"));
  // WoW tooltips accept bonus IDs, crafted stats and character level; `mods` is a Diablo parameter.
  if (dropLevel) params.set("lvl", String(dropLevel));
  // Wowhead splits crafted stats before URL-decoding, so colons must remain literal.
  const tooltip = params.toString().replaceAll("%3A", ":");
  return {
    itemLevel, upgrade, tags, sockets, stats: [...statIds].map((id) => ({ id, name: STAT_NAMES[id]! })),
    craftedStats, unknownBonusIds: [...unknown], detailsIncomplete: !item || issues.length > 0 || unknown.size > 0,
    wowhead: { url: `https://www.wowhead.com/item=${identity.itemId}${tooltip.includes("&") ? `?${tooltip.slice(tooltip.indexOf("&") + 1)}` : ""}`, tooltip },
  };
}
