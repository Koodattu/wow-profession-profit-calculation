import type { ProfessionStats } from "./profession-stats";

// Maxed Midnight specialization tree extra percentages by profession name
const PROFESSION_EXTRAS: Record<string, { mcExtra: number; resExtra: number }> = {
  Alchemy: { mcExtra: 0.4, resExtra: 0.5 },
  Blacksmithing: { mcExtra: 1.0, resExtra: 0.55 },
  Enchanting: { mcExtra: 1.0, resExtra: 0.2 },
  Engineering: { mcExtra: 1.0, resExtra: 0.55 },
  Inscription: { mcExtra: 1.0, resExtra: 0.65 },
  Jewelcrafting: { mcExtra: 0.5, resExtra: 0.5 },
  Leatherworking: { mcExtra: 0.5, resExtra: 0.5 },
  Tailoring: { mcExtra: 0.4, resExtra: 0.5 },
};

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
  professionName: string;
  stats: ProfessionStats;
  baseYield: number;
  outputUnitPrice: number | null;
  totalCost: number;
  affectedByMulticraft: boolean;
  affectedByResourcefulness: boolean;
}): AdjustedProfit | null {
  if (opts.outputUnitPrice === null) return null;

  const extras = PROFESSION_EXTRAS[opts.professionName] ?? { mcExtra: 0, resExtra: 0 };

  // Multicraft
  const pMc = opts.affectedByMulticraft ? Math.min(opts.stats.multicraftRating / 1100, 1) : 0;
  const cMc = getMulticraftCoefficient(opts.baseYield);
  const maxExtra = cMc * opts.baseYield * (1 + extras.mcExtra);
  const expectedExtraOnProc = (1 + maxExtra) / 2;
  const multicraftExtraPerCraft = pMc * expectedExtraOnProc;

  // Expected output value
  const expectedOutputValue = opts.outputUnitPrice * (opts.baseYield + multicraftExtraPerCraft);

  // Resourcefulness
  const pRes = opts.affectedByResourcefulness ? Math.min(opts.stats.resourcefulnessRating / 900, 1) : 0;
  const savedOnProc = opts.totalCost * 0.3 * (1 + extras.resExtra);
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
