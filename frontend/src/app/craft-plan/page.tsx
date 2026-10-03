import type { Metadata } from "next";
import CraftPlanClient from "./CraftPlanClient";

export const metadata: Metadata = { title: "Craft plan — Copper" };

export default function CraftPlanPage() {
  return <CraftPlanClient />;
}
