"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fetchRealms, type ConnectedRealmGroup } from "@/lib/api";
import { TOOL_TIERS, TOOL_TIER_LABELS, type ToolTier } from "@/lib/tool-tiers";
import { getSelectedTier, setSelectedTier, subscribeToTier } from "@/lib/profession-stats";
import { getSelectedConnectedRealmId, setSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";

const REGION = "eu";

type RealmOption = {
  connectedRealmId: number;
  name: string;
};

export default function NavSettings() {
  const tier = useSyncExternalStore(subscribeToTier, getSelectedTier, () => "none" as ToolTier);
  const selectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [realmGroups, setRealmGroups] = useState<ConnectedRealmGroup[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const realmDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const realms = await fetchRealms(REGION);
        if (cancelled) return;
        setRealmGroups(realms);
      } catch {
        if (cancelled) return;
        setRealmGroups([]);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo<RealmOption[]>(() => {
    const seen = new Set<number>();
    const flattened: RealmOption[] = [];

    for (const group of realmGroups) {
      if (seen.has(group.connected_realm_id)) continue;
      const firstRealmName = group.realms[0]?.name;
      if (!firstRealmName) continue;
      seen.add(group.connected_realm_id);
      flattened.push({ connectedRealmId: group.connected_realm_id, name: firstRealmName });
    }

    return flattened.sort((a, b) => a.name.localeCompare(b.name));
  }, [realmGroups]);

  useEffect(() => {
    if (options.length === 0) return;
    if (selectedRealmId === null || !options.some((o) => o.connectedRealmId === selectedRealmId)) {
      setSelectedConnectedRealmId(options[0]!.connectedRealmId);
    }
  }, [options, selectedRealmId]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!realmDropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const selectedRealm = options.find((o) => o.connectedRealmId === selectedRealmId) ?? options[0] ?? null;
  const query = search.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options;

  return (
    <div className="w-full mt-auto pt-4 flex flex-col items-center gap-3 border-t border-border/70">
      <div className="w-full max-w-48">
        <p className="text-xs text-muted mb-1 text-center">Tool Tier</p>
        <div role="radiogroup" aria-label="Tool tier" className="grid grid-cols-3 gap-1">
          {TOOL_TIERS.map((currentTier) => (
            <button
              key={currentTier}
              type="button"
              role="radio"
              aria-checked={tier === currentTier}
              aria-label={TOOL_TIER_LABELS[currentTier]}
              onClick={() => setSelectedTier(currentTier)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                tier === currentTier ? "bg-accent text-background" : "bg-card border border-border text-muted hover:text-foreground hover:bg-card-hover"
              }`}
            >
              {currentTier === "none" ? "None" : currentTier === "blue" ? "Blue" : "Epic"}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-48 relative" ref={realmDropdownRef}>
        <p className="text-xs text-muted mb-1 text-center">Realm</p>
        <button
          type="button"
          className="w-full px-3 py-1.5 rounded-md bg-card border border-border text-sm text-left text-foreground hover:bg-card-hover transition-colors"
          onClick={() => {
            setOpen((prev) => !prev);
            setSearch("");
          }}
        >
          {selectedRealm?.name ?? "Loading realms..."}
        </button>

        {open && (
          <div className="absolute left-0 right-0 bottom-full mb-2 bg-card border border-border rounded-lg shadow-lg z-50">
            <div className="p-2 border-b border-border/60">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search realm..."
                className="w-full bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.map((option) => (
                <button
                  key={option.connectedRealmId}
                  type="button"
                  onClick={() => {
                    setSelectedConnectedRealmId(option.connectedRealmId);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full px-3 py-1.5 text-sm text-left hover:bg-card-hover transition-colors ${
                    selectedRealmId === option.connectedRealmId ? "text-accent" : "text-foreground"
                  }`}
                >
                  {option.name}
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-2 text-xs text-muted">No realms found</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
