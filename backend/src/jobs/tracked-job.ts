import { db } from "../db";
import { withAdvisoryLock } from "../db/advisory-lock";
import { syncJobs } from "../db/schema";
import { eq } from "drizzle-orm";

const MAX_STORED_ERROR_LENGTH = 2_000;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_STORED_ERROR_LENGTH);
}

export async function runTrackedJob<T>(name: string, task: () => Promise<T>): Promise<T | undefined> {
  const result = await withAdvisoryLock(`wowtools:job:${name}`, async () => {
    const startedAt = new Date();
    await db
      .insert(syncJobs)
      .values({ name, status: "running", startedAt, finishedAt: null, lastError: null })
      .onConflictDoUpdate({
        target: syncJobs.name,
        set: { status: "running", startedAt, finishedAt: null, lastError: null },
      });

    try {
      const value = await task();
      const finishedAt = new Date();
      await db
        .update(syncJobs)
        .set({ status: "succeeded", finishedAt, lastSuccessAt: finishedAt, lastError: null })
        .where(eq(syncJobs.name, name));
      return value;
    } catch (error) {
      await db
        .update(syncJobs)
        .set({ status: "failed", finishedAt: new Date(), lastError: errorMessage(error) })
        .where(eq(syncJobs.name, name));
      throw error;
    }
  });

  if (!result.acquired) {
    console.log(`[Jobs] ${name} is already running on another instance; skipping`);
    return undefined;
  }

  return result.value;
}
