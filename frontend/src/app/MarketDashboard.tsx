"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMarketDashboard } from "@/features/market-dashboard";

function formatAge(value: string | null): string {
  if (!value) return "Waiting for first sync";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.round(minutes / 60)}h ago`;
}

export default function MarketDashboard() {
  const router = useRouter();
  const { summary, failed } = useMarketDashboard();
  const [query, setQuery] = useState("");

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/items?search=${encodeURIComponent(value)}` : "/items");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="max-w-3xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Europe · Retail</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">EU Auction House</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
          Commodities across the whole region. Everything else on your connected realm. Prices, quantities, and crafting costs—nothing extra.
        </p>

        <form onSubmit={search} className="mt-8 flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search auction house items</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search any item"
              className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base text-foreground outline-none transition-[border-color,background-color] duration-150 ease-out placeholder:text-muted focus:border-accent focus:bg-card-hover"
            />
          </label>
          <button
            type="submit"
            className="h-12 shrink-0 rounded-xl bg-accent px-5 text-sm font-semibold text-background transition-[background-color,scale] duration-150 ease-out hover:bg-accent-hover active:scale-[0.96]"
          >
            Search
          </button>
        </form>
      </div>

      <section className="mt-10 grid gap-3 sm:grid-cols-3" aria-label="Market status">
        <Stat label="Items" value={summary?.itemCount} detail={summary ? `${summary.pendingMetadataCount.toLocaleString()} names queued` : undefined} />
        <Stat label="Commodities" value={summary?.commodityCount} detail={summary ? formatAge(summary.commodityObservedAt) : undefined} />
        <Stat label="Realm items" value={summary?.realmItemCount} detail={summary ? formatAge(summary.realmOldestObservedAt) : undefined} />
      </section>

      {failed && <p className="mt-4 text-sm text-negative">Market status is temporarily unavailable. Existing pages may still have cached data.</p>}

      <section className="mt-10 grid gap-3 md:grid-cols-3" aria-label="Tools">
        <ToolLink href="/items" title="Market" description="Search current prices and quantities." />
        <ToolLink href="/professions" title="Professions" description="Compare material cost with sale value." />
        <ToolLink href="/flipping" title="Realm comparison" description="See current price gaps between realms." />
      </section>

      <p className="mt-8 text-xs text-muted">
        {summary?.selectedRealm ? `Realm prices use ${summary.selectedRealm.name}. ` : "Choose a realm above for local prices. "}
        Auction data is provided by Blizzard and may be delayed.
      </p>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value?: number; detail?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value === undefined ? "—" : value.toLocaleString()}</p>
      <p className="mt-1 min-h-5 text-xs text-muted">{detail ?? "Loading…"}</p>
    </div>
  );
}

function ToolLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="surface interactive-surface block min-h-32 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
      <span className="mt-4 inline-block text-sm text-accent">Open →</span>
    </Link>
  );
}
