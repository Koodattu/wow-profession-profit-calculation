const STORAGE_KEY = "wow-profession-stats";

export interface ProfessionStats {
  multicraftRating: number;
  resourcefulnessRating: number;
}

type AllStats = Record<number, ProfessionStats>;

const DEFAULT_STATS: ProfessionStats = {
  multicraftRating: 0,
  resourcefulnessRating: 0,
};

// Cache for useSyncExternalStore referential equality
const snapshotCache = new Map<number, ProfessionStats>();

const STATS_CHANGE_EVENT = "profession-stats-change";

function loadAll(): AllStats {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AllStats;
  } catch {
    return {};
  }
}

function saveAll(stats: AllStats): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function getProfessionStats(professionId: number): ProfessionStats {
  const all = loadAll();
  const stored = all[professionId] ?? { ...DEFAULT_STATS };
  // Maintain referential equality for useSyncExternalStore
  const cached = snapshotCache.get(professionId);
  if (cached && cached.multicraftRating === stored.multicraftRating && cached.resourcefulnessRating === stored.resourcefulnessRating) {
    return cached;
  }
  snapshotCache.set(professionId, stored);
  return stored;
}

export function setProfessionStats(professionId: number, stats: ProfessionStats): void {
  const all = loadAll();
  all[professionId] = stats;
  saveAll(all);
  snapshotCache.set(professionId, stats);
  window.dispatchEvent(new Event(STATS_CHANGE_EVENT));
}

export function subscribeToStats(callback: () => void): () => void {
  window.addEventListener(STATS_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(STATS_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
