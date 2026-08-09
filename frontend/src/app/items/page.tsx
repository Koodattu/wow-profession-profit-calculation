import ItemsClient from "./ItemsClient";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const params = await searchParams;
  return <ItemsClient initialSearch={params.search?.slice(0, 100) ?? ""} />;
}
