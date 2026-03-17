import { fetchProfession } from "@/lib/api";
import ProfessionClient from "./ProfessionClient";

export default async function ProfessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const professionId = Number(id);

  const profession = await fetchProfession(professionId);

  return <ProfessionClient profession={profession} />;
}
