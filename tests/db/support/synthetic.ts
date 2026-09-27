/**
 * SYNTHETIC DATABASE-TEST VALUES — isolated here on purpose.
 *
 * Approval requires complete, sourced values, and some integrity rules (edge rules, verified Hettich records)
 * cannot be exercised without them. These values exist ONLY inside rolled-back test transactions in tests/db.
 * They are not Lintel values, not manufacturer data, never seeded by a migration, never used outside tests/db,
 * and the global teardown proves nothing persists (tests/db/support/global-setup.ts).
 * tests/synthetic-data-isolation.test.ts proves this module is referenced only from tests/db.
 */
import type { ConstructionStandard, EdgeBandStandard, PlanningStandard, PricingRuleSet, QuotationPolicy, RateCard } from "@lintel/types";
import type { HettichProductionDataset } from "@lintel/hettich-engine";
import type { ValueProvenance } from "@lintel/persistence";

export const SYNTHETIC_MARKER = "DB TEST ONLY";
export const SYNTHETIC_SOURCE = `${SYNTHETIC_MARKER} — synthetic value inside a rolled-back transaction; not a Lintel value`;

export const syntheticProvenance = (codes: readonly string[]): Record<string, ValueProvenance> =>
  Object.fromEntries(codes.map((k) => [k, { unit: "MM", source: SYNTHETIC_SOURCE, evidenceRef: null, note: SYNTHETIC_MARKER }]));

export const syntheticConstruction = (s: ConstructionStandard): ConstructionStandard => ({ ...s, variables: Object.fromEntries(Object.keys(s.variables).map((k) => [k, 1])) });
export const syntheticPlanning = (s: PlanningStandard): PlanningStandard => ({ ...s, variables: Object.fromEntries(Object.keys(s.variables).map((k) => [k, 1])) });

/** One banded edge and one explicit "no banding" component type, referencing an existing catalog edge band. */
export const syntheticEdgeRules = (s: EdgeBandStandard, edgeBandCode: string): EdgeBandStandard => ({
  ...s,
  source: SYNTHETIC_SOURCE,
  ruleSets: { CARCASS_STANDARD: { SIDE_LEFT: { FRONT: edgeBandCode }, BACK: {} } },
});

export const syntheticRateCard = (r: RateCard): RateCard => ({ ...r, source: SYNTHETIC_SOURCE, boardPerM2: { DBTEST_BOARD: 1 }, edgeBandPerM: {}, finishPerM2: {}, hardwarePerUnit: {} });
export const syntheticPricingRules = (r: PricingRuleSet): PricingRuleSet => ({
  ...r,
  source: SYNTHETIC_SOURCE,
  manufacturingCost: "0",
  wastagePercent: { board: 1, edgeBand: 1, finish: 1 },
  overheadPercent: 1,
  marginBasis: "MARKUP_ON_COST",
  marginPercent: 1,
  gstPercent: 1,
});
export const syntheticQuotationPolicy = (p: QuotationPolicy): QuotationPolicy => ({
  ...p,
  source: SYNTHETIC_SOURCE,
  taxRates: { DBTEST_RATE: 1 },
  taxRateByProductCategory: { KITCHEN_BASE: "DBTEST_RATE" },
  taxPolicy: "PER_RATE_GROUP",
  rounding: { tax: { mode: "HALF_UP", incrementPaise: 1 }, grandTotal: { mode: "HALF_UP", incrementPaise: 100 } },
  discountPolicy: { mode: "NONE" },
});

/** A source-verified-looking record + quantity rule, clearly synthetic (DBTEST article number). */
export function syntheticHettichDataset(base: HettichProductionDataset, over: { readonly url?: string; readonly licence?: "AUTHORISED" | "UNKNOWN"; readonly articleNumber?: string; readonly withRule?: boolean } = {}): HettichProductionDataset {
  const source = { url: over.url ?? "https://www.hettich.com/db-test-synthetic", sourceDate: "2026-09-26", documentTitle: SYNTHETIC_SOURCE, documentVersion: null };
  return {
    ...base,
    notes: SYNTHETIC_SOURCE,
    records: [{
      recordId: "DBTEST-REC-1",
      articleNumber: over.articleNumber ?? "DBTEST-ARTICLE-1",
      productFamily: "DBTEST_FAMILY",
      series: null,
      category: "HINGE",
      description: SYNTHETIC_SOURCE,
      exactApplication: { description: SYNTHETIC_MARKER, application: "HINGED_DOOR", mounting: "FULL_OVERLAY" },
      dimensions: { SYNTHETIC: { value: 1, unit: "MM" } },
      compatibility: { doorThicknessRange: { min: 1, max: 2 }, openingAngle: 1, nominalLength: null, compatibleArticles: [], notes: SYNTHETIC_MARKER },
      drilling: { patternId: "DBTEST-PATTERN", holes: [{ face: "X", datum: "Y", x: 1, y: 1, diameter: 1, depth: 1 }], source },
      installation: { guide: source, notes: null },
      adjustment: { ranges: { SYNTHETIC: { min: 0, max: 1, unit: "MM" } }, notes: null },
      accessories: [],
      cadReference: null,
      source,
      licence: { status: over.licence ?? "AUTHORISED", usageNotes: SYNTHETIC_MARKER },
      verification: { verifiedBy: SYNTHETIC_MARKER, verifiedAt: "2026-09-26" },
      preferenceRank: 1,
    }],
    calculationRules: over.withRule === false ? [] : [{
      ruleId: "DBTEST-RULE-1",
      family: "DBTEST_FAMILY",
      category: "HINGE",
      description: SYNTHETIC_SOURCE,
      bands: [{ when: "true", quantity: "1" }],
      source,
      verification: { verifiedBy: SYNTHETIC_MARKER, verifiedAt: "2026-09-26" },
      sourceVersion: SYNTHETIC_MARKER,
    }],
  };
}
