import { sql } from ".";

export type LockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

export async function withAdvisoryLock<T>(name: string, task: () => Promise<T>): Promise<LockResult<T>> {
  const connection = await sql.reserve();
  let acquired = false;

  try {
    const [row] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtextextended(${name}, 0)) AS acquired
    `;
    acquired = row?.acquired ?? false;

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
