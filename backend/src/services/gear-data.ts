import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export interface GearBonus {
  id: number;
  itemLevel?: { amount: number; priority: number; squishEra?: number; curveId?: number };
  levelOffset?: { amount: number; squishEra?: number; craftingQuality?: number };
  levelOffsetSecondary?: { amount: number };
  dropLevelCurve?: { curveId: number; offset: number; priority: number; squishEra?: number };
  level?: number;
  curveId?: number;
  applyBonusId?: number;
  tag?: string;
  name?: string;
  socket?: number;
  quality?: number;
  rawStats?: { stat: number; amount: number; name: string }[];
  craftedStats?: number[];
  upgrade?: { group: number; level: number; max: number; name?: string; fullName?: string; seasonId?: number };
}

export interface GearItem {
  id: number;
  itemLevel: number;
  squishEra?: number;
  itemClass: number;
  stats?: { id: number; alloc: number }[];
  socketInfo?: { sockets: { type: string }[] };
  profession?: unknown;
}

export interface GearData {
  metadata: { wowBuild: string; contentHash: string; generatedAt: string };
  items: Record<string, GearItem>;
  bonuses: Record<string, GearBonus>;
  curves: Record<string, { points: { playerLevel: number; itemLevel: number }[] }>;
  eras: { id: number; curveId: number }[];
  contentTuning?: Record<string, { minLevelSquish: number; maxLevelSquish: number }>;
}

export function validateGearData(data: GearData): void {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(data.metadata?.wowBuild) || !data.metadata.contentHash
    || Object.keys(data.items ?? {}).length < 1_000 || Object.keys(data.bonuses ?? {}).length < 1_000
    || !data.eras?.length || data.eras.some((era) => era.curveId && !data.curves[era.curveId])) {
    throw new Error("Incomplete gear reference data");
  }
}

let reference: GearData = JSON.parse(gunzipSync(readFileSync(new URL("../data/gear-reference.json.gz", import.meta.url))).toString());
validateGearData(reference);

export function getGearData(): GearData { return reference; }
export function setGearData(data: GearData): void { validateGearData(data); reference = data; }

export async function downloadGearData(): Promise<GearData> {
  async function get<T>(url: string): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Gear reference download failed: ${response.status}`);
    return response.json() as Promise<T>;
  }
  const metadata = await get<GearData["metadata"]>("https://www.raidbots.com/static/data/live/metadata.json");
  if (!/^[a-f0-9]{32}$/.test(metadata.contentHash)) throw new Error("Invalid gear reference version");
  if (metadata.contentHash === reference.metadata.contentHash && reference.contentTuning) return reference;
  const base = `https://www.raidbots.com/static/data/${metadata.contentHash}`;
  const [items, bonuses, curves, eras, contentTuning] = await Promise.all([
    get<GearItem[]>(`${base}/equippable-items-full.json`), get<GearData["bonuses"]>(`${base}/bonuses.json`),
    get<GearData["curves"]>(`${base}/item-curves.json`), get<GearData["eras"]>(`${base}/item-squish-era.json`),
    get<GearData["contentTuning"]>(`${base}/content-tuning.json`),
  ]);
  const data = compactGearData({ metadata, items: Object.fromEntries(items.map((item) => [item.id, item])), bonuses, curves, eras, contentTuning });
  validateGearData(data);
  return data;
}

export function compactGearData(data: GearData): GearData {
  return {
    metadata: data.metadata, curves: data.curves, eras: data.eras, contentTuning: data.contentTuning,
    items: Object.fromEntries(Object.values(data.items).map(({ id, itemLevel, squishEra, itemClass, stats, socketInfo, profession }) =>
      [id, { id, itemLevel, squishEra, itemClass, stats, socketInfo, profession }])),
    bonuses: Object.fromEntries(Object.values(data.bonuses).map((bonus) => {
      const { id, itemLevel, levelOffset, levelOffsetSecondary, dropLevelCurve, level, curveId, applyBonusId, tag, name, socket, quality, rawStats, craftedStats, upgrade } = bonus;
      return [id, { id, itemLevel, levelOffset, levelOffsetSecondary, dropLevelCurve, level, curveId, applyBonusId, tag, name, socket, quality, rawStats, craftedStats,
        upgrade: upgrade && { group: upgrade.group, level: upgrade.level, max: upgrade.max, name: upgrade.name, fullName: upgrade.fullName, seasonId: upgrade.seasonId } }];
    })),
  };
}
