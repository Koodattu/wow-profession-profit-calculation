import { fetchItem } from "@/lib/api";
import ItemDetailClient from "./ItemDetailClient";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  const item = await fetchItem(itemId);

  return <ItemDetailClient item={item} />;
}
