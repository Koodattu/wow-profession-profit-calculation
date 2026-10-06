import Link from "next/link";

export default function NotFound() {
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold">Page not found</h1>
    <p className="mt-3 text-base leading-7 text-muted">This link may be out of date, or the entry isn’t in Copper’s catalog. Search the market or browse professions to continue.</p>
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/items" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-background hover:bg-accent-hover">Search the market</Link>
      <Link href="/professions" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-accent hover:bg-card-hover">Browse professions</Link>
    </div>
  </div>;
}
