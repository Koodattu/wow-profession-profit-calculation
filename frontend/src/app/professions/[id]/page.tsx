import { fetchProfession, fetchProfessionCosts } from "@/lib/api";
import ProfessionClient from "./ProfessionClient";

export default async function ProfessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const professionId = Number(id);

  const [profession, recipeCosts] = await Promise.all([fetchProfession(professionId), fetchProfessionCosts(professionId)]);

  return <ProfessionClient profession={profession} recipeCosts={recipeCosts} />;
}
