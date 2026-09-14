export function calculateGrossProfit(outputTotalPrice: number | null, totalCost: number | null): number | null {
  if (outputTotalPrice === null || totalCost === null) return null;
  return outputTotalPrice - totalCost;
}
