import type { HardwareCategory, HingeMounting, Millimetres } from "@lintel/types";

/**
 * Hettich data model (PRD §25). Hettich-specific data lives only in this package,
 * behind the generic ManufacturerAdapter contract (PRD §24).
 */
export interface HettichArticle {
  readonly manufacturer: "HETTICH";
  readonly articleNumber: string;
  readonly description: string;
  readonly family: string;
  readonly series: string | null;
  readonly category: HardwareCategory;
  readonly application: "HINGED_DOOR" | null;
  readonly mounting: HingeMounting | null;
  readonly openingAngle: number | null;
  readonly doorThicknessRange: { readonly min: Millimetres; readonly max: Millimetres } | null;
  /** Articles that must be supplied with this one (e.g. mounting plates), in preference order. */
  readonly compatibleArticles: readonly string[];
  readonly drillingPatternId: string | null;
  /** Lower = preferred when several articles are compatible. */
  readonly preferenceRank: number;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string;
  readonly retrievedAt: string;
  readonly licenseStatus: "OFFICIAL_PUBLIC" | "AUTHORISED" | "TEST_FIXTURE" | "UNKNOWN";
}

/** A quantity band: the first band whose `when` is true gives the quantity. */
export interface QuantityBand {
  readonly when: string;
  readonly quantity: string;
}

/**
 * Manufacturer calculation rule (PRD §27: no hard-coded hinge-count tables in code).
 * Scope variables: DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS, DOOR_WEIGHT (when known),
 * OPENING_ANGLE (when required).
 */
export interface HettichCalculationRule {
  readonly ruleId: string;
  readonly family: string;
  readonly category: HardwareCategory;
  readonly description: string;
  readonly bands: readonly QuantityBand[];
  readonly sourceUrl: string | null;
  readonly sourceVersion: string;
}

export interface HettichDrillingPattern {
  readonly patternId: string;
  readonly description: string;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string;
}

export interface HettichDataset {
  readonly datasetId: string;
  readonly sourceVersion: string;
  /** True only for official/authorised Hettich data (PRD §25). */
  readonly authoritative: boolean;
  readonly retrievedAt: string | null;
  readonly notes: string;
  readonly articles: readonly HettichArticle[];
  readonly calculationRules: readonly HettichCalculationRule[];
  readonly drillingPatterns: readonly HettichDrillingPattern[];
}
