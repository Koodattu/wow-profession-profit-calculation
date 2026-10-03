import { fetchItem } from "@/lib/api";
import ItemDetailClient from "./ItemDetailClient";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const itemId = Number(id);
  const item = await fetchItem(itemId);
  const { from } = await searchParams;
  const backHref = typeof from === "string" && ["/items", "/flipping"].some((path) => from === path || from.startsWith(`${path}?`)) ? from : "/items";

  return <ItemDetailClient item={item} backHref={backHref} />;
}
