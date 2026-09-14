import { useEffect, useSyncExternalStore } from "react";
import { fetchRealms, type ConnectedRealmGroup } from "./api";

const STORAGE_KEY = "wow-selected-connected-realm";

export interface RealmOption {
  id: number;
  label: string;
}

export type SelectedRealmState =
  | { status: "loading"; options: RealmOption[]; selectedId: null }
  | { status: "selection-required"; options: RealmOption[]; selectedId: null }
  | { status: "ready"; options: RealmOption[]; selectedId: number }
  | { status: "error"; options: RealmOption[]; selectedId: null };

interface SelectedRealmDependencies {
  loadCatalog(): Promise<ConnectedRealmGroup[]>;
  readStored(): number | null;
  writeStored(value: number | null): void;
}

export interface SelectedRealmModule {
  initialize(): Promise<void>;
  getSnapshot(): SelectedRealmState;
  subscribe(callback: () => void): () => void;
  select(connectedRealmId: number): void;
}

function catalogOptions(groups: ConnectedRealmGroup[]): RealmOption[] {
  return groups
    .map((group) => ({
      id: group.connected_realm_id,
      label: group.realms.map((realm) => realm.name).sort().join(" / "),
    }))
    .filter((option) => option.label.length > 0)
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function createSelectedRealmModule(dependencies: SelectedRealmDependencies): SelectedRealmModule {
  let state: SelectedRealmState = { status: "loading", options: [], selectedId: null };
  let initializePromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: SelectedRealmState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    initialize() {
      initializePromise ??= dependencies
        .loadCatalog()
        .then((groups) => {
          const options = catalogOptions(groups);
          const stored = dependencies.readStored();
          if (stored !== null && options.some((option) => option.id === stored)) {
            publish({ status: "ready", options, selectedId: stored });
          } else {
            if (stored !== null) dependencies.writeStored(null);
            publish({ status: "selection-required", options, selectedId: null });
          }
        })
        .catch(() => publish({ status: "error", options: [], selectedId: null }));
      return initializePromise;
    },

    getSnapshot: () => state,

    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    select(connectedRealmId) {
      if (!state.options.some((option) => option.id === connectedRealmId)) {
        throw new Error(`Unknown connected realm ${connectedRealmId}`);
      }
      dependencies.writeStored(connectedRealmId);
      publish({ status: "ready", options: state.options, selectedId: connectedRealmId });
    },
  };
}

const browserStorage = {
  readStored(): number | null {
    if (typeof window === "undefined") return null;
    try {
      const value = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  },
  writeStored(value: number | null): void {
    if (typeof window === "undefined") return;
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(value));
  },
};

export const selectedRealm = createSelectedRealmModule({
  loadCatalog: () => fetchRealms("eu"),
  ...browserStorage,
});

const SERVER_SNAPSHOT: SelectedRealmState = { status: "loading", options: [], selectedId: null };

export function useSelectedRealm(): SelectedRealmState {
  const state = useSyncExternalStore(selectedRealm.subscribe, selectedRealm.getSnapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    void selectedRealm.initialize();
  }, []);
  return state;
}
