"use client";

import Link from "next/link";

type WowheadType = "item" | "spell";

interface WowheadLinkProps {
  /** Internal app route, e.g. /items/123 */
  href: string;
  /** Wowhead entity type */
  type: WowheadType;
  /** Blizzard API ID for the entity */
  id: number;
  /** Link display text */
  children: React.ReactNode;
  className?: string;
}

/**
 * Renders a Next.js Link for internal navigation that also triggers
 * Wowhead tooltips on hover via the data-wowhead attribute.
 * The Wowhead script detects data-wowhead lazily on first hover,
 * so no per-component refreshLinks call is needed.
 */
export default function WowheadLink({ href, type, id, children, className }: WowheadLinkProps) {
  return (
    <Link href={href} data-wowhead={`${type}=${id}`} className={className}>
      {children}
    </Link>
  );
}
