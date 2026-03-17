import type { TierStats } from "./tool-tiers";

// Multicraft coefficient by base yield
function getMulticraftCoefficient(baseYield: number): number {
  if (baseYield === 1) return 2.1;
  if (baseYield === 2) return 1.83;
  if (baseYield === 5) return 1.875;
  return 2.5;
}

export interface AdjustedProfit {
  expectedOutputValue: number;
  expectedCost: number;
  expectedProfit: number;
  multicraftChance: number;
  resourcefulnessChance: number;
  multicraftExtraPerCraft: number;
  resourcefulnessSavingPerCraft: number;
}

/**
 * Calculate adjusted profit for a recipe scenario accounting for multicraft and resourcefulness.
 */
export function calculateAdjustedProfit(opts: {
  tierStats: TierStats;
  baseYield: number;
  outputUnitPrice: number | null;
  totalCost: number;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
}): AdjustedProfit | null {
  if (opts.outputUnitPrice === null) return null;

  const { tierStats } = opts;

  // Multicraft
  const pMc = opts.affectedByMulticraft ? Math.min(tierStats.multicraftRating / 1100, 1) : 0;
  const cMc = getMulticraftCoefficient(opts.baseYield);
  const maxExtra = cMc * opts.baseYield * (1 + tierStats.mcExtra);
  const expectedExtraOnProc = (1 + maxExtra) / 2;
  const multicraftExtraPerCraft = pMc * expectedExtraOnProc;

  // Expected output value
  const expectedOutputValue = opts.outputUnitPrice * (opts.baseYield + multicraftExtraPerCraft);

  // Resourcefulness
  const pRes = opts.affectedByResourcefulness ? Math.min(tierStats.resourcefulnessRating / 900, 1) : 0;
  const savedOnProc = opts.totalCost * 0.3 * (1 + tierStats.resExtra);
  const resourcefulnessSavingPerCraft = pRes * savedOnProc;

  // Adjusted cost
  const expectedCost = opts.totalCost - resourcefulnessSavingPerCraft;

  return {
    expectedOutputValue,
    expectedCost,
    expectedProfit: expectedOutputValue - expectedCost,
    multicraftChance: pMc,
    resourcefulnessChance: pRes,
    multicraftExtraPerCraft,
    resourcefulnessSavingPerCraft,
  };
}
