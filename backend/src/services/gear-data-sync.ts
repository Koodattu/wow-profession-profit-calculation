import { eq } from "drizzle-orm";
import { db } from "../db";
import { gearReference } from "../db/schema";
import { downloadGearData, getGearData, setGearData } from "./gear-data";

export async function loadSavedGearData(): Promise<void> {
  const [saved] = await db.select().from(gearReference).where(eq(gearReference.id, "live"));
  if (saved && saved.data.metadata.generatedAt > getGearData().metadata.generatedAt) setGearData(saved.data);
}

export async function syncGearData(): Promise<void> {
  const data = await downloadGearData();
  const [saved] = await db.select({ data: gearReference.data }).from(gearReference).where(eq(gearReference.id, "live"));
  if (saved?.data.metadata.contentHash === data.metadata.contentHash && saved.data.contentTuning) { setGearData(data); return; }
  await db.insert(gearReference).values({ id: "live", data }).onConflictDoUpdate({
    target: gearReference.id, set: { data, updatedAt: new Date() },
  });
  setGearData(data);
  console.log(`[GearData] Ready: ${data.metadata.wowBuild} (${data.metadata.contentHash})`);
}
