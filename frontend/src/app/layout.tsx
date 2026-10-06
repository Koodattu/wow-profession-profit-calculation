import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavSettings from "./NavSettings";
import PrimaryNav from "./PrimaryNav";
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
        <a href="#main-content" className="sr-only rounded-lg bg-accent px-4 py-3 font-medium text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50">Skip to content</a>
        <header className="top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl sm:sticky">
          <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
            <Link href="/" className="shrink-0 text-base font-semibold tracking-tight text-foreground">
              Copper
            </Link>
            <PrimaryNav />
            <div className="ml-auto shrink-0 sm:ml-0">
              <NavSettings />
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1440px] scroll-mt-20 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
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
