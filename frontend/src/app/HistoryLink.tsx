"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function HistoryLink({ connectedRealmId }: { connectedRealmId?: number | null }) {
  const query = useSearchParams();
  const key = `${query?.toString()}:${connectedRealmId ?? "eu"}`;
  const [result, setResult] = useState<{ key: string; url: string; copied: boolean } | null>(null);
  async function copy() {
    const url = new URL(window.location.href);
    url.searchParams.delete("from");
    if (connectedRealmId != null) url.searchParams.set("realm", String(connectedRealmId));
    else url.searchParams.delete("realm");
    try {
      await navigator.clipboard.writeText(url.href);
      setResult({ key, url: url.href, copied: true });
    } catch {
      setResult({ key, url: url.href, copied: false });
    }
  }
  return <div className="flex flex-wrap items-center gap-3 text-sm">
    <button type="button" onClick={() => void copy()} className="min-h-11 px-2 text-accent hover:underline">Copy history link</button>
    {result?.key === key && (result.copied ? <span role="status" className="text-muted">Link copied</span>
      : <label className="w-full text-muted">Copy this history link
        <input aria-label="History link" readOnly value={result.url} onFocus={(event) => event.currentTarget.select()}
          className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground" />
      </label>)}
  </div>;
}
