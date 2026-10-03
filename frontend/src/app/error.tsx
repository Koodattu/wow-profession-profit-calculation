"use client";

import Link from "next/link";

export default function PageError({ retry }: { retry: () => void }) {
  return <div className="surface max-w-xl p-6" role="alert">
    <h1 className="text-xl font-semibold">Couldn’t load this page</h1>
    <p className="mt-2 text-sm text-muted">Market data may be temporarily unavailable. Try again in a moment.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" onClick={retry} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-background">Retry page</button>
      <Link href="/items" className="inline-flex min-h-11 items-center px-3 text-sm text-accent">Back to market</Link>
    </div>
  </div>;
}
