import type { PricingRuleSet, RateCard } from "@lintel/types";

/**
 * TEST FIXTURE — synthetic rates used only to exercise pricing mechanics in tests
 * and golden fixtures. NOT Lintel rates, NOT supplier prices, NOT a tax position.
 * Classification TEST_FIXTURE: can never be used for PRODUCTION pricing.
 */
export const TEST_FIXTURE_RATE_CARD: RateCard = {
  rateCardId: "TEST_FIXTURE_RATE_CARD",
  version: "0.0.1",
  status: "TEST_FIXTURE",
  classification: "TEST_FIXTURE",
  currency: "INR",
  effectiveFrom: null,
  source: "Test fixture (synthetic)",
  boardPerM2: { BOARD_BWP_18: 1000, BOARD_HDHMR_18: 900, BOARD_BACK_6: 400 },
  edgeBandPerM: { EDGE_ABS_2MM: 30, EDGE_ABS_0_8MM: 12 },
  finishPerM2: { LAMINATE_WHITE: 350 },
  hardwarePerUnit: {
    "HETTICH:FIXTURE-HINGE-FO-A": 150,
    "HETTICH:FIXTURE-HINGE-FO-B": 140,
    "HETTICH:FIXTURE-HINGE-IN-A": 170,
    "HETTICH:FIXTURE-PLATE-A": 40,
  },
};

export const TEST_FIXTURE_PRICING_RULES: PricingRuleSet = {
  ruleSetId: "TEST_FIXTURE_PRICING_RULES",
  version: "0.0.1",
  status: "TEST_FIXTURE",
  classification: "TEST_FIXTURE",
  source: "Test fixture (synthetic)",
  manufacturingCost: "PANEL_COUNT * 120 + BOARD_AREA_M2 * 250 + EDGE_LENGTH_M * 15",
  wastagePercent: { board: 10, edgeBand: 5, finish: 8 },
  overheadPercent: 12.5,
  marginBasis: "MARGIN_ON_PRICE",
  marginPercent: 32,
  gstPercent: 18,
};
