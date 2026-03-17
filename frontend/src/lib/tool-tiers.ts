// Tool tier configuration per profession.
// Each profession has stats for "blue" and "epic" tool tiers.
// "none" tier is always 0 for everything (no tools/knowledge).
//
// Values to fill in:
//   multicraftRating      — raw multicraft rating from tools + knowledge
//   resourcefulnessRating — raw resourcefulness rating from tools + knowledge
//   mcExtra               — extra multicraft % from specialization tree (decimal, e.g. 0.4 = 40%)
//   resExtra              — extra resourcefulness % from specialization tree (decimal, e.g. 0.5 = 50%)

export type ToolTier = "none" | "blue" | "epic";

export const TOOL_TIER_LABELS: Record<ToolTier, string> = {
  none: "No Tools",
  blue: "Blue Tools",
  epic: "Epic Tools",
};

export const TOOL_TIERS: ToolTier[] = ["none", "blue", "epic"];

export interface TierStats {
  multicraftRating: number;
  resourcefulnessRating: number;
  mcExtra: number;
  resExtra: number;
}

const ZERO: TierStats = { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0, resExtra: 0 };

// Per-profession tier stats. "none" is always zero — only "blue" and "epic" need values.
// TODO: Fill in real values per profession
const PROFESSION_TIERS: Record<string, Record<"blue" | "epic", TierStats>> = {
  Alchemy: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.4, resExtra: 0.5 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.4, resExtra: 0.5 },
  },
  Blacksmithing: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.55 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.55 },
  },
  Enchanting: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.2 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.2 },
  },
  Engineering: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.55 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.55 },
  },
  Inscription: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.65 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 1.0, resExtra: 0.65 },
  },
  Jewelcrafting: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.5, resExtra: 0.5 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.5, resExtra: 0.5 },
  },
  Leatherworking: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.5, resExtra: 0.5 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.5, resExtra: 0.5 },
  },
  Tailoring: {
    blue: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.4, resExtra: 0.5 },
    epic: { multicraftRating: 0, resourcefulnessRating: 0, mcExtra: 0.4, resExtra: 0.5 },
  },
};

export function getTierStats(professionName: string, tier: ToolTier): TierStats {
  if (tier === "none") return ZERO;
  return PROFESSION_TIERS[professionName]?.[tier] ?? ZERO;
}
