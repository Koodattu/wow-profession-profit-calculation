"use client";

import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";
import { updateHistoryQuery } from "@/lib/history-view";

export default function NavSettings() {
  const realm = useSelectedRealm();
  const selectedRealmId = realm.status === "ready" ? realm.selectedId : null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="block min-w-0">
        <span className="sr-only">Connected realm</span>
        <select
          value={selectedRealmId ?? ""}
          title={realm.options.find((option) => option.id === selectedRealmId)?.fullLabel}
          onChange={(event) => {
            if (new URLSearchParams(window.location.search).has("realm")) updateHistoryQuery({ realm: event.target.value });
            selectedRealm.select(Number(event.target.value));
          }}
          disabled={realm.status === "loading" || realm.status === "error" || realm.options.length === 0}
          className="h-11 w-40 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition-[border-color,background-color] duration-150 ease-out hover:bg-card-hover focus:border-accent disabled:opacity-60 sm:w-56"
        >
          {realm.status === "loading" && <option value="">Loading realms…</option>}
          {realm.status === "error" && <option value="">Realms unavailable</option>}
          {realm.status === "selection-required" && <option value="">{realm.options.length ? "Select a realm…" : "No realms available"}</option>}
          {realm.options.map((option) => (
            <option key={option.id} value={option.id} title={option.fullLabel}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {(realm.status === "error" || (realm.status === "selection-required" && realm.options.length === 0)) && (
        <button type="button" onClick={() => void selectedRealm.retry()} className="h-11 px-2 text-sm text-accent" aria-label="Retry loading realms">Retry</button>
      )}
    </div>
  );
}
