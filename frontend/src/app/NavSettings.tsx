"use client";

import { useId, useRef, useState } from "react";
import { selectedRealm, useSelectedRealm } from "@/lib/selected-realm";
import { updateHistoryQuery } from "@/lib/history-view";

function searchableName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’\s-]/g, "");
}

export default function NavSettings() {
  const realm = useSelectedRealm();
  const selected = realm.options.find((option) => option.id === realm.selectedId);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [query, setQuery] = useState("");
  const matches = realm.options.filter((option) => searchableName(option.fullLabel).includes(searchableName(query)));
  const unavailable = realm.status === "error" || (realm.status === "selection-required" && realm.options.length === 0);
  const label = realm.status === "loading" ? "Loading realms…" : unavailable ? "Realms unavailable" : selected?.label ?? "Select a realm…";

  function choose(id: number) {
    if (new URLSearchParams(window.location.search).has("realm")) updateHistoryQuery({ realm: String(id) });
    selectedRealm.select(id);
    dialog.current?.close();
  }

  return <div className="flex min-w-0 items-center gap-2">
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-label={`Connected realm: ${label}`}
      disabled={realm.status === "loading" || unavailable}
      onClick={() => {
        setQuery("");
        dialog.current?.showModal();
        search.current?.focus();
      }}
      className="flex min-h-11 w-40 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-card-hover disabled:opacity-60 sm:w-56">
      <span className="min-w-0 break-words">{label}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {unavailable && <button type="button" onClick={() => void selectedRealm.retry()} className="min-h-11 px-2 text-sm text-accent" aria-label="Retry loading realms">Retry</button>}

    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onClose={() => trigger.current?.focus()}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60">
      <div className="z-10 border-b border-border bg-card px-5 pb-4 pt-3 sm:sticky sm:top-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <h2 id={titleId} className="min-w-0 text-lg font-semibold">Choose your realm</h2>
          <button type="button" className="min-h-11 shrink-0 px-2 text-sm text-accent hover:underline" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted">Search any EU realm. Connected realms share an auction house; commodities use EU-wide prices.</p>
        <label className="mt-4 block text-sm font-medium">Search realms
          <input ref={search} type="search" value={query} autoComplete="off" spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base"
            placeholder="Realm name, e.g. Tarren Mill" />
        </label>
        <p className="mt-3 text-xs text-muted" role="status">{matches.length} {matches.length === 1 ? "connected market" : "connected markets"}</p>
      </div>
      {matches.length ? <ul aria-label="Matching realms" className="divide-y divide-border px-3 pb-3">
        {matches.map((option) => <li key={option.id}>
          <button type="button" onClick={() => choose(option.id)} aria-pressed={option.id === realm.selectedId}
            className="flex min-h-14 w-full items-start justify-between gap-3 rounded-lg px-3 py-4 text-left text-sm leading-6 hover:bg-card-hover aria-pressed:bg-card-hover">
            <span className="min-w-0 break-words">{option.fullLabel}</span>
            {option.id === realm.selectedId && <span aria-hidden="true" className="shrink-0 text-xs font-medium text-accent">Selected</span>}
          </button>
        </li>)}
      </ul> : <div className="px-5 py-6">
        <p className="text-sm">No realms match “{query}”. Try another name or check the spelling.</p>
        <button type="button" className="mt-3 min-h-11 text-sm text-accent hover:underline" onClick={() => { setQuery(""); search.current?.focus(); }}>Show all realms</button>
      </div>}
    </dialog>
  </div>;
}
