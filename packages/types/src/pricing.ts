import type { Currency, DataClassification, DataStatus, VersionRef } from "./common.js";
import type { TraceInfo } from "./resolved.js";
import type { ValidationMessage } from "./validation.js";

/**
 * Money is carried as integer paise (1 INR = 100 paise) to keep arithmetic exact
 * and deterministic. Rates in data are INR with at most 2 decimals.
 */
export type Paise = number;

/** A rate that is not yet verified is `null` ("NULL / UNVERIFIED") — never 0, never assumed. */
export type Rate = number | null;

/** Versioned unit cost rates (PRD §23). */
export interface RateCard {
  readonly rateCardId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly classification: DataClassification;
  readonly currency: Currency;
  readonly effectiveFrom: string | null;
  readonly source: string;
  /** INR per m² of net board area, by materialId. */
  readonly boardPerM2: Readonly<Record<string, Rate>>;
  /** INR per metre of net edge band, by edgeBandId. */
  readonly edgeBandPerM: Readonly<Record<string, Rate>>;
  /** INR per m² of finished face area, by finishId. */
  readonly finishPerM2: Readonly<Record<string, Rate>>;
  /** INR per unit, keyed `MANUFACTURER:ARTICLE_NUMBER`. */
  readonly hardwarePerUnit: Readonly<Record<string, Rate>>;
}

export type MarginBasis =
  /** margin = cost × m% */
  | "MARKUP_ON_COST"
  /** price = cost ÷ (1 − m%) — margin expressed as a share of the ex-GST selling price. */
  | "MARGIN_ON_PRICE";

/** Percentages have at most 2 decimals (exact in basis points). `null` = unverified. */
export interface PricingRuleSet {
  readonly ruleSetId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly classification: DataClassification;
  readonly source: string;
  /**
   * Manufacturing cost in INR as a formula over BOM measures:
   * PANEL_COUNT, BOARD_AREA_M2, EDGE_LENGTH_M, FINISH_AREA_M2, HARDWARE_UNITS.
   */
  readonly manufacturingCost: string | null;
  readonly wastagePercent: {
    readonly board: number | null;
    readonly edgeBand: number | null;
    readonly finish: number | null;
  };
  readonly overheadPercent: number | null;
  readonly marginBasis: MarginBasis | null;
  readonly marginPercent: number | null;
  readonly gstPercent: number | null;
}

export type PriceLineCategory = "MATERIAL" | "FINISH" | "HARDWARE" | "MANUFACTURING" | "WASTAGE" | "OVERHEAD" | "MARGIN" | "GST";

export interface PriceLine {
  readonly lineId: string;
  readonly category: PriceLineCategory;
  readonly description: string;
  readonly sourceBomItemIds: readonly string[];
  /** Measured quantity (m², m, NOS) or the base amount in paise for percentage lines. */
  readonly quantity: number;
  readonly unit: "M2" | "M" | "NOS" | "PAISE" | "LUMP";
  /** INR per unit for measured lines; percent for percentage lines; null for formula lines. */
  readonly rate: number | null;
  readonly amount: Paise;
}

export interface PriceTotals {
  readonly material: Paise;
  readonly finish: Paise;
  readonly hardware: Paise;
  readonly manufacturing: Paise;
  readonly wastage: Paise;
  readonly directCost: Paise;
  readonly overhead: Paise;
  readonly totalCost: Paise;
  readonly margin: Paise;
  readonly sellingPriceExGst: Paise;
  readonly gst: Paise;
  readonly sellingPriceIncGst: Paise;
}

export interface BoqItemPrice {
  readonly boqItemId: string;
  readonly quantity: number;
  readonly unitPriceExGst: Paise;
  readonly amountExGst: Paise;
}

/**
 * Immutable price snapshot (PRD §23). Embeds the exact rate card and rule set used,
 * so an approved quotation never changes when current rates change.
 */
export interface PriceSnapshot {
  readonly priceSnapshotId: string;
  readonly classification: DataClassification;
  readonly currency: Currency;
  readonly createdAt: string;
  readonly trace: TraceInfo;
  readonly modelFingerprint: string;
  readonly bomId: string;
  readonly boqId: string;
  readonly rateCard: RateCard;
  readonly rateCardRef: VersionRef;
  readonly pricingRules: PricingRuleSet;
  readonly pricingRulesRef: VersionRef;
  readonly lines: readonly PriceLine[];
  readonly totals: PriceTotals;
  readonly boqPrices: readonly BoqItemPrice[];
  /** Design validation state when priced (TEST_FIXTURE snapshots carry design blockers). */
  readonly designBlockerCount: number;
  /** Hash of every other field; `verifyPriceSnapshot` recomputes it. */
  readonly contentHash: string;
}

export type PricingResult =
  | { readonly status: "PRICED"; readonly snapshot: PriceSnapshot; readonly messages: readonly ValidationMessage[] }
  | { readonly status: "UNAVAILABLE"; readonly classification: DataClassification; readonly blockers: readonly ValidationMessage[] };
