/** IDs are stored in PostgreSQL integer columns. */
export function isDatabaseId(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
