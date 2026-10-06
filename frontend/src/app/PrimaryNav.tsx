"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/items", label: "Market", paths: ["/items"] },
  { href: "/professions", label: "Professions", paths: ["/professions", "/recipes"] },
  { href: "/flipping", label: "Realms", paths: ["/flipping"] },
  { href: "/craft-plan", label: "Craft plan", paths: ["/craft-plan"] },
];

export default function PrimaryNav() {
  const pathname = usePathname();
  return <nav aria-label="Primary navigation"
    className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:overflow-x-auto">
    {sections.map(({ href, label, paths }) => {
      const active = paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
      return <Link key={href} href={href} aria-current={active ? pathname === href ? "page" : "location" : undefined}
        className={`flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm transition-colors hover:bg-card-hover hover:text-foreground ${active ? "bg-card-hover font-medium text-accent" : "text-muted"}`}>
        {label}
      </Link>;
    })}
  </nav>;
}
