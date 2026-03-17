"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { fetchRecipeCost, type RecipeProfitResult } from "@/lib/api";
import { getSelectedConnectedRealmId, subscribeToConnectedRealm } from "@/lib/realm-state";
import RecipeClient from "./RecipeClient";

interface Props {
  recipeId: number;
}

export default function RecipeDetailClient({ recipeId }: Props) {
  const connectedRealmId = useSyncExternalStore(subscribeToConnectedRealm, getSelectedConnectedRealmId, () => null);
  const [recipe, setRecipe] = useState<RecipeProfitResult | null>(null);
  const [hasError, setHasError] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const hasLoadedDataRef = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (connectedRealmId === null) return;

    let cancelled = false;

    startTransition(async () => {
      try {
        const nextRecipe = await fetchRecipeCost(recipeId, "eu", connectedRealmId);
        if (!cancelled) {
          setRecipe(nextRecipe);
          setHasError(false);
          hasLoadedDataRef.current = true;
        }
      } catch {
        if (!cancelled && !hasLoadedDataRef.current) {
          setHasError(true);
        }
      } finally {
        if (!cancelled) setInitialLoad(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [recipeId, connectedRealmId]);

  if (initialLoad) {
    return <p className="text-muted">Loading recipe prices...</p>;
  }

  if (!recipe && hasError) {
    return <p className="text-muted">Failed to load recipe data.</p>;
  }

  if (!recipe) {
    return <p className="text-muted">No recipe data available.</p>;
  }

  return <RecipeClient recipe={recipe} />;
}
