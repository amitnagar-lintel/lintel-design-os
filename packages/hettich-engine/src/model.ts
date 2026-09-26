import type { HardwareCategory, HingeMounting, Millimetres } from "@lintel/types";

/**
 * Hettich data model (PRD §25). Hettich-specific data lives only in this package,
 * behind the generic ManufacturerAdapter contract (PRD §24).
 *
 * Two strictly separated dataset kinds:
 * - PRODUCTION: source-verified intake records (`HettichProductionRecord`). Only records
 *   that pass `validateProductionRecord` are ever used.
 * - TEST_FIXTURE: synthetic `FIXTURE-*` articles for engine tests. Never authoritative.
 */

/** Engine view of an article, used by the compatibility engine. */
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
  /** Articles that must be supplied with this one (e.g. mounting plates), alternatives in preference order. */
  readonly compatibleArticles: readonly string[];
  readonly drillingPatternId: string | null;
  /** Lower = preferred when several articles are compatible. */
  readonly preferenceRank: number;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string;
  readonly retrievedAt: string;
  readonly licenseStatus: HettichLicenceStatus | "TEST_FIXTURE";
}

export type HettichLicenceStatus = "OFFICIAL_PUBLIC" | "AUTHORISED" | "RESTRICTED" | "UNKNOWN";

/** Where a fact came from. Every production fact must carry one. */
export interface SourceReference {
  /** Official Hettich URL (https, hettich.com domain). */
  readonly url: string | null;
  /** Date the source was consulted/published, ISO `YYYY-MM-DD`. */
  readonly sourceDate: string | null;
  readonly documentTitle: string | null;
  readonly documentVersion: string | null;
}

export interface Measured {
  readonly value: number;
  readonly unit: "MM" | "DEG" | "KG" | "N";
}

/** One drilled hole, coordinates relative to a named datum on a named face. */
export interface DrillHole {
  readonly face: string;
  readonly datum: string;
  readonly x: Millimetres;
  readonly y: Millimetres;
  readonly diameter: Millimetres;
  readonly depth: Millimetres;
}

/**
 * Production intake record — every field the business requires for a Hettich article.
 * `null` means NULL / UNVERIFIED; such a record is never used by the engine.
 */
export interface HettichProductionRecord {
  readonly recordId: string;
  readonly articleNumber: string | null;
  readonly productFamily: string | null;
  readonly series: string | null;
  readonly category: HardwareCategory | null;
  readonly description: string | null;
  readonly exactApplication: {
    readonly description: string | null;
    readonly application: "HINGED_DOOR" | null;
    readonly mounting: HingeMounting | null;
  };
  readonly dimensions: Readonly<Record<string, Measured>> | null;
  readonly compatibility: {
    readonly doorThicknessRange: { readonly min: Millimetres; readonly max: Millimetres } | null;
    readonly openingAngle: number | null;
    /** Required companion articles (e.g. mounting plates); `[]` = explicitly none. */
    readonly compatibleArticles: readonly string[] | null;
    readonly notes: string | null;
  };
  readonly drilling: {
    readonly patternId: string | null;
    readonly holes: readonly DrillHole[] | null;
    readonly source: SourceReference | null;
  };
  readonly installation: { readonly guide: SourceReference | null; readonly notes: string | null };
  readonly adjustment: {
    readonly ranges: Readonly<Record<string, { readonly min: number; readonly max: number; readonly unit: "MM" | "DEG" }>> | null;
    readonly notes: string | null;
  };
  /** Optional accessories; `[]` = explicitly none. */
  readonly accessories: readonly string[] | null;
  readonly cadReference: {
    readonly assetId: string | null;
    readonly formats: readonly string[] | null;
    readonly url: string | null;
  } | null;
  readonly source: SourceReference;
  readonly licence: { readonly status: HettichLicenceStatus; readonly usageNotes: string | null };
  readonly verification: { readonly verifiedBy: string | null; readonly verifiedAt: string | null };
  readonly preferenceRank: number | null;
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
  /** Required for production rules; `null` for fixtures. */
  readonly source: SourceReference | null;
  readonly verification: { readonly verifiedBy: string | null; readonly verifiedAt: string | null } | null;
  readonly sourceVersion: string;
}

export interface HettichDrillingPattern {
  readonly patternId: string;
  readonly description: string;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string;
}

export interface HettichProductionDataset {
  readonly kind: "PRODUCTION";
  readonly datasetId: string;
  readonly sourceVersion: string;
  readonly notes: string;
  readonly records: readonly HettichProductionRecord[];
  readonly calculationRules: readonly HettichCalculationRule[];
}

export interface HettichFixtureDataset {
  readonly kind: "TEST_FIXTURE";
  readonly datasetId: string;
  readonly sourceVersion: string;
  readonly notes: string;
  readonly articles: readonly HettichArticle[];
  readonly calculationRules: readonly HettichCalculationRule[];
  readonly drillingPatterns: readonly HettichDrillingPattern[];
}

export type HettichDataset = HettichProductionDataset | HettichFixtureDataset;
