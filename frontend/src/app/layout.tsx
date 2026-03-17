import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SearchBar from "./SearchBar";
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
  title: "WoW Tools - Auction House Analytics",
  description: "World of Warcraft crafting cost calculator and auction house price tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}>
        <div className="flex min-h-screen">
          <nav className="w-56 shrink-0 border-r border-border bg-card p-4 flex flex-col gap-1">
            <Link href="/" className="text-lg font-bold text-accent mb-4 block">
              WoW Tools
            </Link>
            <SearchBar />
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/professions">Professions</NavLink>
            <NavLink href="/items">Items</NavLink>
            <NavLink href="/flipping">Flipping</NavLink>
          </nav>
          <main className="flex-1 p-6 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-card-hover transition-colors">
      {children}
    </Link>
  );
}
