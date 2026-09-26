import type { Currency, DataClassification, DataStatus, VersionRef } from "./common.js";
import type { BOM } from "./bom.js";
import type { BOQ, BOQItem } from "./boq.js";
import type { Paise, PriceSnapshot } from "./pricing.js";
import type { RoomTrace } from "./room.js";

/* ---------------------------------------------------------------- room BOM / BOQ */

/** Room-level total of one material / edge band / finish / hardware article, traced to object BOM lines. */
export interface RoomBomTotal {
  readonly lineId: string;
  readonly kind: "BOARD" | "EDGE_BAND" | "FINISH" | "HARDWARE";
  /** materialId / edgeBandId / finishId / MANUFACTURER:ARTICLE (or UNRESOLVED:<requirementId>). */
  readonly key: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: "M2" | "M" | "NOS";
  readonly status: "RESOLVED" | "UNRESOLVED";
  readonly sourceBomItemIds: readonly string[];
}

export interface RoomBOM {
  readonly roomBomId: string;
  readonly trace: RoomTrace;
  readonly roomFingerprint: string;
  /** Each object's BOM, intact, in room order. */
  readonly objectBoms: readonly BOM[];
  readonly totals: readonly RoomBomTotal[];
  readonly incomplete: boolean;
}

export interface RoomBOQ {
  readonly roomBoqId: string;
  readonly trace: RoomTrace;
  readonly roomFingerprint: string;
  readonly roomBomId: string;
  /** Each object's BOQ, intact, in room order. */
  readonly objectBoqs: readonly BOQ[];
  /** All BOQ items, one per object line, in room order. */
  readonly items: readonly BOQItem[];
}

/* ---------------------------------------------------------------- quotation */

/**
 * PER_LINE: tax computed and rounded per line, then summed per rate.
 * PER_RATE_GROUP: taxable amounts summed per rate, tax computed once per rate group.
 */
export type TaxPolicy = "PER_LINE" | "PER_RATE_GROUP";
export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "DOWN" | "UP";

export interface RoundingRule {
  readonly mode: RoundingMode;
  /** Round to a multiple of this many paise (1 = paise, 100 = whole rupees). */
  readonly incrementPaise: number;
}

/** M4 supports only NONE; other discount modes need Lintel finance approval before they exist. */
export interface DiscountPolicy {
  readonly mode: "NONE";
}

/** Finance / tax policy for quotations. `null` = NULL / UNVERIFIED (finance / tax review pending). */
export interface QuotationPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly classification: DataClassification;
  readonly source: string;
  /** Tax rates in percent (≤ 2 decimals), by rate id. */
  readonly taxRates: Readonly<Record<string, number | null>>;
  /** Product category → tax rate id. */
  readonly taxRateByProductCategory: Readonly<Record<string, string | null>>;
  readonly taxPolicy: TaxPolicy | null;
  readonly rounding: { readonly tax: RoundingRule | null; readonly grandTotal: RoundingRule | null };
  readonly discountPolicy: DiscountPolicy | null;
}

export interface QuotationLine {
  readonly lineNo: number;
  readonly lineId: string;
  readonly boqItemId: string;
  readonly objectId: string;
  readonly objectCode: string;
  readonly productId: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceExGst: Paise;
  readonly taxableAmount: Paise;
  readonly taxRateId: string;
  readonly taxPercent: number;
  /** Only under PER_LINE; null under PER_RATE_GROUP. */
  readonly lineTax: Paise | null;
  readonly priceSnapshotId: string;
  readonly priceSnapshotHash: string;
}

export interface TaxGroup {
  readonly taxRateId: string;
  readonly percent: number;
  readonly taxableAmount: Paise;
  readonly taxAmount: Paise;
  readonly lineNos: readonly number[];
}

export interface QuotationTotals {
  readonly taxableAmount: Paise;
  readonly discountAmount: Paise;
  readonly taxAmount: Paise;
  readonly totalBeforeRounding: Paise;
  readonly roundingAdjustment: Paise;
  readonly grandTotal: Paise;
}

/** Immutable, hash-sealed quotation for a room. Embeds every price snapshot and the policy used. */
export interface QuotationSnapshot {
  readonly quotationId: string;
  readonly revision: string;
  readonly classification: DataClassification;
  readonly currency: Currency;
  readonly createdAt: string;
  readonly trace: RoomTrace;
  readonly roomFingerprint: string;
  readonly roomBomId: string;
  readonly roomBoqId: string;
  readonly policy: QuotationPolicy;
  readonly policyRef: VersionRef;
  readonly rateCardRef: VersionRef;
  readonly pricingRulesRef: VersionRef;
  readonly lines: readonly QuotationLine[];
  readonly taxGroups: readonly TaxGroup[];
  readonly totals: QuotationTotals;
  readonly priceSnapshots: readonly PriceSnapshot[];
  readonly contentHash: string;
}

export interface QuotationStaleness {
  readonly stale: boolean;
  readonly reasons: readonly string[];
  /** Objects whose model changed, was added, or was removed since the quotation. */
  readonly changedObjectIds: readonly string[];
}
