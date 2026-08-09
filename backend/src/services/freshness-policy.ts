export function toTimestampMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isFresh(
  value: Date | string | null | undefined,
  maxAgeMinutes: number,
  nowMs = Date.now(),
): boolean {
  const timestamp = toTimestampMs(value);
  return timestamp !== null && nowMs - timestamp < maxAgeMinutes * 60_000;
}
