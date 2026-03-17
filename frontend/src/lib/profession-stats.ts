import type { ToolTier } from "./tool-tiers";

const STORAGE_KEY = "wow-tool-tier";
const TIER_CHANGE_EVENT = "tool-tier-change";

let cachedTier: ToolTier | null = null;

function load(): ToolTier {
  if (typeof window === "undefined") return "none";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "blue" || raw === "epic") return raw;
    return "none";
  } catch {
    return "none";
  }
}

export function getSelectedTier(): ToolTier {
  const stored = load();
  if (cachedTier === stored) return cachedTier;
  cachedTier = stored;
  return stored;
}

export function setSelectedTier(tier: ToolTier): void {
  localStorage.setItem(STORAGE_KEY, tier);
  cachedTier = tier;
  window.dispatchEvent(new Event(TIER_CHANGE_EVENT));
}

export function subscribeToTier(callback: () => void): () => void {
  window.addEventListener(TIER_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(TIER_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
