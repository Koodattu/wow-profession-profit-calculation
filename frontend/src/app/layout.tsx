import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavSettings from "./NavSettings";
import WowheadTooltips from "./WowheadTooltips";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Copper — EU Auction House",
  description: "Fast EU auction house prices, quantities, realm comparisons, and profession costs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl">
          <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
            <Link href="/" className="shrink-0 text-base font-semibold tracking-tight text-foreground">
              Copper
            </Link>
            <nav
              className="order-3 flex w-full items-center gap-1 sm:order-none sm:min-w-0 sm:flex-1 sm:overflow-x-auto"
              aria-label="Primary navigation"
            >
              <NavLink href="/items">Market</NavLink>
              <NavLink href="/professions">Professions</NavLink>
              <NavLink href="/flipping">Realms</NavLink>
            </nav>
            <div className="ml-auto shrink-0 sm:ml-0">
              <NavSettings />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 sm:py-10">{children}</main>
        <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 pb-8 text-xs text-muted sm:px-6">
          <p>Market data provided by Blizzard Entertainment. Copper is not affiliated with or endorsed by Blizzard.</p>
          <Link href="/privacy" className="inline-flex h-10 items-center transition-colors hover:text-foreground">
            Privacy
          </Link>
        </footer>
        <WowheadTooltips />
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex h-10 shrink-0 items-center rounded-lg px-3 text-sm text-muted transition-[color,background-color,scale] duration-150 ease-out hover:bg-card-hover hover:text-foreground active:scale-[0.96]"
    >
      {children}
    </Link>
  );
}
