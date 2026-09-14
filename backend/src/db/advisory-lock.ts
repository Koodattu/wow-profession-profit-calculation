import { sql } from ".";

export type LockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

export async function withAdvisoryLockWait<T>(
  name: string,
  timeoutMs: number,
  task: () => Promise<T>,
): Promise<LockResult<T>> {
  const connection = await sql.reserve();
  let acquired = false;

  try {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    do {
      const [row] = await connection<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(hashtextextended(${name}, 0)) AS acquired
      `;
      acquired = row?.acquired ?? false;
      if (acquired || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (!acquired);

    if (!acquired) {
      return { acquired: false };
    }

    return { acquired: true, value: await task() };
  } finally {
    try {
      if (acquired) {
        await connection`SELECT pg_advisory_unlock(hashtextextended(${name}, 0))`;
      }
    } finally {
      connection.release();
    }
  }
}

export function withAdvisoryLock<T>(name: string, task: () => Promise<T>): Promise<LockResult<T>> {
  return withAdvisoryLockWait(name, 0, task);
}
