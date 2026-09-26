import type { PricingRuleSet, RateCard } from "@lintel/types";

/**
 * PRODUCTION pricing — NOT YET DEFINED.
 *
 * Every rate and rule is `null` (NULL / UNVERIFIED). No production rate has been
 * invented. The legacy ops `rate_library` is NOT a source for these values: it prices
 * composite items per sq ft of front, not unit costs of board / edge band / finish /
 * hardware, and it has not been approved for Design OS. Production pricing stays
 * UNAVAILABLE until finance approves a PRODUCTION rate card and rule set
 * (intake: docs/catalog/production-data/07-pricing-standards.md).
 */
export const LINTEL_PRODUCTION_RATE_CARD: RateCard = {
  rateCardId: "LINTEL_PRODUCTION_RATE_CARD",
  version: "0.1.0",
  status: "DRAFT",
  classification: "PRODUCTION",
  currency: "INR",
  effectiveFrom: null,
  source: "Pending — Lintel finance / procurement",
  boardPerM2: { BOARD_BWP_18: null, BOARD_HDHMR_18: null, BOARD_BACK_6: null },
  edgeBandPerM: { EDGE_ABS_2MM: null, EDGE_ABS_0_8MM: null },
  finishPerM2: { LAMINATE_WHITE: null },
  // No verified hardware articles exist yet, so no hardware rates can be keyed.
  hardwarePerUnit: {},
};

export const LINTEL_PRODUCTION_PRICING_RULES: PricingRuleSet = {
  ruleSetId: "LINTEL_PRODUCTION_PRICING_RULES",
  version: "0.1.0",
  status: "DRAFT",
  classification: "PRODUCTION",
  source: "Pending — Lintel finance",
  manufacturingCost: null,
  wastagePercent: { board: null, edgeBand: null, finish: null },
  overheadPercent: null,
  marginBasis: null,
  marginPercent: null,
  gstPercent: null,
};
