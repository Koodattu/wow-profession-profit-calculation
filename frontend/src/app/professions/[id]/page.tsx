import { notFound } from "next/navigation";
import { ApiError, fetchProfession } from "@/lib/api";
import ProfessionClient from "./ProfessionClient";

export const dynamic = "force-dynamic";

export default async function ProfessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const professionId = Number(id);
  if (!Number.isInteger(professionId) || professionId < 1 || professionId > 2147483647) notFound();

  const profession = await fetchProfession(professionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  return <ProfessionClient profession={profession} />;
}
