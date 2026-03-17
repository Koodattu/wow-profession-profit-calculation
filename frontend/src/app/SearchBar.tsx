"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchSearch, type SearchResult } from "@/lib/api";
import { getItemQualityClass } from "@/lib/item-quality";

export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setOpen(false);
      return;
    }

    setLoading(true);
    setOpen(true);

    const timer = setTimeout(async () => {
      try {
        const data = await fetchSearch(query.trim());
        setResults(data);
      } catch {
        setResults({ items: [], recipes: [] });
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function navigate(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
  }

  const hasResults = results && (results.items.length > 0 || results.recipes.length > 0);

  return (
    <div ref={containerRef} className="relative mb-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Search..."
        className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
          {loading && <p className="px-3 py-2 text-sm text-muted">Searching...</p>}

          {!loading && !hasResults && <p className="px-3 py-2 text-sm text-muted">No results</p>}

          {!loading && results && results.items.length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-xs text-muted uppercase tracking-wide">Items</p>
              {results.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(`/items/${item.id}`)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-card-hover transition-colors flex items-center gap-2"
                >
                  <span className={getItemQualityClass(item.qualityRank)}>{item.name}</span>
                  {item.qualityRank && <span className="text-xs text-muted">R{item.qualityRank}</span>}
                  {item.isReagent && <span className="text-xs bg-blue-500/20 text-blue-400 px-1 rounded">Reagent</span>}
                  {item.isCraftedOutput && <span className="text-xs bg-green-500/20 text-green-400 px-1 rounded">Crafted</span>}
                </button>
              ))}
            </div>
          )}

          {!loading && results && results.recipes.length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-xs text-muted uppercase tracking-wide">Recipes</p>
              {results.recipes.map((recipe) => (
                <button
                  key={recipe.id}
                  onClick={() => navigate(`/recipes/${recipe.id}`)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-card-hover transition-colors flex items-center gap-2"
                >
                  <span className="text-accent">{recipe.name}</span>
                  <span className="text-xs text-muted">{recipe.professionName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
