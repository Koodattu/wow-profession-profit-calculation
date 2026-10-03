import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "copper-craft-plan-v1";
export const MAX_PLAN_ENTRIES = 50;
export const MAX_CRAFTS = 10_000;

export interface CraftPlanEntry {
  recipeId: number;
  scenarioKey: string;
  crafts: number;
}

interface PlanState {
  ready: boolean;
  entries: CraftPlanEntry[];
  storage: "saved" | "session" | "invalid";
}

const SERVER_STATE: PlanState = { ready: false, entries: [], storage: "saved" };
let state = SERVER_STATE;
const listeners = new Set<() => void>();

export function validCraftCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CRAFTS;
}

export function planEntryKey(entry: Pick<CraftPlanEntry, "recipeId" | "scenarioKey">): string {
  return `${entry.recipeId}/${entry.scenarioKey}`;
}

function validEntry(value: unknown): value is CraftPlanEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as CraftPlanEntry;
  return Number.isInteger(entry.recipeId) && entry.recipeId > 0 && entry.recipeId <= 2147483647
    && typeof entry.scenarioKey === "string"
    && /^(rank:1:1|rank:2:2|rank:1:2|salvage:[1-9]\d{0,9})$/.test(entry.scenarioKey)
    && validCraftCount(entry.crafts);
}

function publish(next: PlanState): void {
  state = next;
  for (const listener of listeners) listener();
}

function readStorage(): void {
  let raw: string | null;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { publish({ ready: true, entries: state.entries, storage: "session" }); return; }
  if (raw === null) { publish({ ready: true, entries: [], storage: "saved" }); return; }
  try {
    if (raw.length > 20_000) throw new Error("Oversized plan");
    const stored = JSON.parse(raw);
    if (!stored || stored.version !== 1 || !Array.isArray(stored.entries) || stored.entries.length > MAX_PLAN_ENTRIES
      || !stored.entries.every(validEntry)
      || new Set(stored.entries.map(planEntryKey)).size !== stored.entries.length) {
      publish({ ready: true, entries: [], storage: "invalid" });
      return;
    }
    // Persist only choices, never cached quotes or server-provided labels.
    publish({ ready: true, entries: stored.entries.map(({ recipeId, scenarioKey, crafts }: CraftPlanEntry) => ({ recipeId, scenarioKey, crafts })), storage: "saved" });
  } catch {
    publish({ ready: true, entries: [], storage: "invalid" });
  }
}

function save(entries: CraftPlanEntry[]): void {
  let storage: PlanState["storage"] = "saved";
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries })); }
  catch { storage = "session"; }
  publish({ ready: true, entries, storage });
}

export const craftPlan = {
  initialize() {
    if (state.ready) return;
    readStorage();
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY || event.key === null) readStorage();
    });
  },
  getSnapshot: () => state,
  subscribe(callback: () => void) {
    listeners.add(callback);
    return () => { listeners.delete(callback); };
  },
  add(entry: CraftPlanEntry): string | null {
    if (!state.ready || !validEntry(entry)) return "Enter a whole number of crafts from 1 to 10,000.";
    const key = planEntryKey(entry);
    const current = state.entries.find((candidate) => planEntryKey(candidate) === key);
    if (current && current.crafts + entry.crafts > MAX_CRAFTS) return "This choice would exceed 10,000 crafts. Adjust it in your plan.";
    if (!current && state.entries.length >= MAX_PLAN_ENTRIES) return "Your plan has 50 choices. Remove one before adding another.";
    save(current
      ? state.entries.map((candidate) => planEntryKey(candidate) === key ? { ...candidate, crafts: candidate.crafts + entry.crafts } : candidate)
      : [...state.entries, entry]);
    return null;
  },
  update(key: string, crafts: number): void {
    if (validCraftCount(crafts)) save(state.entries.map((entry) => planEntryKey(entry) === key ? { ...entry, crafts } : entry));
  },
  remove(key: string): void { save(state.entries.filter((entry) => planEntryKey(entry) !== key)); },
};

export function useCraftPlan() {
  const snapshot = useSyncExternalStore(craftPlan.subscribe, craftPlan.getSnapshot, () => SERVER_STATE);
  useEffect(() => { craftPlan.initialize(); }, []);
  return snapshot;
}
