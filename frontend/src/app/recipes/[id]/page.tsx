import RecipeDetailClient from "./RecipeDetailClient";

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = Number(id);

  return <RecipeDetailClient recipeId={recipeId} />;
}
