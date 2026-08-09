"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchRealms, type ConnectedRealmGroup } from "@/lib/api";
import { getSelectedConnectedRealmId, setSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";

type RealmOption = { id: number; label: string };

export default function NavSettings() {
  const selectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [realmGroups, setRealmGroups] = useState<ConnectedRealmGroup[]>([]);

  useEffect(() => {
    let active = true;
    fetchRealms("eu")
      .then((groups) => active && setRealmGroups(groups))
      .catch(() => active && setRealmGroups([]));
    return () => {
      active = false;
    };
  }, []);

  const options = useMemo<RealmOption[]>(
    () =>
      realmGroups
        .map((group) => ({
          id: group.connected_realm_id,
          label: group.realms.map((realm) => realm.name).sort().join(" / "),
        }))
        .filter((option) => option.label)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [realmGroups],
  );

  useEffect(() => {
    if (options.length === 0) return;
    if (selectedRealmId === null || !options.some((option) => option.id === selectedRealmId)) {
      setSelectedConnectedRealmId(options[0]!.id);
    }
  }, [options, selectedRealmId]);

  return (
    <label className="block min-w-0">
      <span className="sr-only">Connected realm</span>
      <select
        value={selectedRealmId ?? ""}
        onChange={(event) => setSelectedConnectedRealmId(Number(event.target.value))}
        disabled={options.length === 0}
        className="h-10 w-40 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition-[border-color,background-color] duration-150 ease-out hover:bg-card-hover focus:border-accent disabled:opacity-60 sm:w-56"
      >
        {options.length === 0 && <option value="">Loading realms…</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
