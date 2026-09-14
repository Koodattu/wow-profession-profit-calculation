"use client";

import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";

export default function NavSettings() {
  const realm = useSelectedRealm();
  const selectedRealmId = realm.status === "ready" ? realm.selectedId : null;

  return (
    <label className="block min-w-0">
      <span className="sr-only">Connected realm</span>
      <select
        value={selectedRealmId ?? ""}
        title={realm.options.find((option) => option.id === selectedRealmId)?.fullLabel}
        onChange={(event) => selectedRealm.select(Number(event.target.value))}
        disabled={realm.status === "loading" || realm.status === "error" || realm.options.length === 0}
        className="h-10 w-40 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition-[border-color,background-color] duration-150 ease-out hover:bg-card-hover focus:border-accent disabled:opacity-60 sm:w-56"
      >
        {realm.status === "loading" && <option value="">Loading realms…</option>}
        {realm.status === "error" && <option value="">Realms unavailable</option>}
        {realm.status === "selection-required" && <option value="">Select a realm…</option>}
        {realm.options.map((option) => (
          <option key={option.id} value={option.id} title={option.fullLabel}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
