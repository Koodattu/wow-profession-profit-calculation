import { fetchRecipeCost } from "@/lib/api";
import RecipeClient from "./RecipeClient";

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = Number(id);
  const recipe = await fetchRecipeCost(recipeId);

  return <RecipeClient recipe={recipe} />;
}
