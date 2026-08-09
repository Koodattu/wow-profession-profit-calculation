export function calculateGrossProfit(outputTotalPrice: number | null, totalCost: number, hasCompleteCostData: boolean): number | null {
  if (outputTotalPrice === null || !hasCompleteCostData) return null;
  return outputTotalPrice - totalCost;
}
