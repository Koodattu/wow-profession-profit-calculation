import RecipeDetailClient from "./RecipeDetailClient";

export default async function RecipeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const recipeId = Number(id);

  return <RecipeDetailClient recipeId={recipeId} returnTo={typeof from === "string" ? from : undefined} />;
}
