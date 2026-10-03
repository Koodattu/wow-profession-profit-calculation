"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { HISTORY_RANGES, type HistoryRange } from "./time-ranges";
import { selectedRealm, useSelectedRealm } from "./selected-realm";

export function updateHistoryQuery(values: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useHistoryRange(realmScoped: boolean) {
  const query = useSearchParams();
  const realm = useSelectedRealm();
  const requested = query?.get("range");
  const range = HISTORY_RANGES.find((option) => option.value === requested)?.value ?? "24h";
  function setRange(next: HistoryRange) {
    updateHistoryQuery({ range: next === "24h" ? null : next,
      ...(realmScoped && realm.status === "ready" ? { realm: String(realm.selectedId) } : {}) });
  }
  return { range, setRange };
}

// Linked analysis must use the same realm as the navigation and subsequent actions.
// Wait to render realm-dependent content until the validated selection is applied.
export function useLinkedHistoryRealm(enabled: boolean) {
  const query = useSearchParams();
  const realm = useSelectedRealm();
  const requested = enabled ? query?.get("realm") : null;
  const linkedId = requested && /^\d+$/.test(requested)
    ? realm.options.find((option) => option.id === Number(requested))?.id : undefined;
  useEffect(() => {
    if (linkedId !== undefined && realm.selectedId !== linkedId) selectedRealm.select(linkedId);
  }, [linkedId, realm.selectedId]);
  return {
    realm,
    pending: !!requested && (realm.status === "loading" || (linkedId !== undefined && realm.selectedId !== linkedId)),
    invalid: !!requested && realm.status !== "loading" && realm.status !== "error" && linkedId === undefined,
  };
}
