import type { MarginBasis, PricingRuleSet, QuotationPolicy, RateCard, RoundingMode, RoundingRule, TaxPolicy } from "@lintel/types";
import { engineCalculationStatus } from "../envelope.js";
import { MappingError } from "../errors.js";
import { assertNotTestFixture } from "../fixture-guard.js";
import type { MapContext, Versioned, VersionMeta, VersionRow } from "./common.js";
import { byKey, checkEngineStatus, omit, readEnvelope, requireLabel, versioned, versionRow } from "./common.js";

/* ------------------------------------------------------------ PricingStandard (rules + rate card) */

export type RateMeasure = "BOARD_M2" | "EDGE_M" | "FINISH_M2" | "HARDWARE_UNIT";

/** Rate in integer paise; null = NULL / UNVERIFIED (never 0, never assumed). */
export interface RateCardLineRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly measure: RateMeasure;
  /** Catalog item id (material, edge band, finish) or `MANUFACTURER:ARTICLE_NUMBER`. */
  readonly item_key: string;
  readonly rate_paise: number | null;
}

export interface PricingStandardVersionRow extends VersionRow {
  readonly rate_card_code: string;
  readonly rule_set_code: string;
  /** Source of the pricing rules; the envelope `source` is the rate card's. */
  readonly rules_source: string;
  readonly currency: "INR";
  /** Formula text; evaluated only by the TypeScript formula engine, never by SQL. */
  readonly manufacturing_cost_formula: string | null;
  readonly wastage_board_pct: number | null;
  readonly wastage_edge_band_pct: number | null;
  readonly wastage_finish_pct: number | null;
  readonly overhead_pct: number | null;
  readonly margin_basis: MarginBasis | null;
  readonly margin_pct: number | null;
  readonly gst_pct: number | null;
}

export interface PricingStandardRows {
  readonly version: PricingStandardVersionRow;
  readonly rateLines: readonly RateCardLineRow[];
}

export interface PricingStandardData {
  readonly rateCard: RateCard;
  readonly rules: PricingRuleSet;
}

/** INR with at most 2 decimals → exact integer paise. */
export function inrToPaise(inr: number, what: string): number {
  const paise = Math.round(inr * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(inr * 100 - paise) > 1e-6) throw new MappingError(`${what}: ${inr} INR is not representable in whole paise`);
  return paise;
}

const MEASURES: readonly (readonly [RateMeasure, "boardPerM2" | "edgeBandPerM" | "finishPerM2" | "hardwarePerUnit"])[] = [
  ["BOARD_M2", "boardPerM2"],
  ["EDGE_M", "edgeBandPerM"],
  ["FINISH_M2", "finishPerM2"],
  ["HARDWARE_UNIT", "hardwarePerUnit"],
];

export function pricingStandardToRows(entityCode: string, data: PricingStandardData, meta: VersionMeta, ctx: MapContext): PricingStandardRows {
  const { rateCard: rc, rules } = data;
  assertNotTestFixture(`rate card ${rc.rateCardId}`, rc.classification, rc.status);
  assertNotTestFixture(`pricing rules ${rules.ruleSetId}`, rules.classification, rules.status);
  checkEngineStatus(`rate card ${rc.rateCardId}`, rc.status, meta);
  checkEngineStatus(`pricing rules ${rules.ruleSetId}`, rules.status, meta);
  if (rc.version !== rules.version) throw new MappingError(`PricingStandard ${entityCode}: rate card v${rc.version} and rules v${rules.version} must share one version`);
  if (rc.effectiveFrom !== meta.effectiveFrom) throw new MappingError(`PricingStandard ${entityCode}: rate card effectiveFrom must equal the version's effectiveFrom`);
  const rateLines: RateCardLineRow[] = [];
  for (const [measure, field] of MEASURES) {
    const rates = rc[field];
    for (const key of byKey(Object.keys(rates), (k) => k)) {
      const r = rates[key] ?? null;
      rateLines.push({ org_id: ctx.orgId, version_id: meta.versionId, measure, item_key: key, rate_paise: r === null ? null : inrToPaise(r, `${measure} ${key}`) });
    }
  }
  const ruleContent = omit(rules, "status", "classification");
  const content = { entityCode, rateCardId: rc.rateCardId, version: rc.version, source: rc.source, currency: rc.currency, rules: ruleContent, rateLines: rateLines.map((l) => omit(l, "org_id", "version_id")) };
  return {
    version: {
      ...versionRow(ctx, entityCode, meta, rc.source, rc.version, content),
      rate_card_code: rc.rateCardId,
      rule_set_code: rules.ruleSetId,
      rules_source: rules.source,
      currency: rc.currency,
      manufacturing_cost_formula: rules.manufacturingCost,
      wastage_board_pct: rules.wastagePercent.board,
      wastage_edge_band_pct: rules.wastagePercent.edgeBand,
      wastage_finish_pct: rules.wastagePercent.finish,
      overhead_pct: rules.overheadPercent,
      margin_basis: rules.marginBasis,
      margin_pct: rules.marginPercent,
      gst_pct: rules.gstPercent,
    },
    rateLines,
  };
}

export const pricingStandardFromRows = (rows: PricingStandardRows): Versioned<PricingStandardData> => versioned(rows.version, pricingStandardValue(rows));

function pricingStandardValue(rows: PricingStandardRows): PricingStandardData {
  const v = rows.version;
  const e = readEnvelope(v);
  const status = engineCalculationStatus(e.status);
  const version = requireLabel(v);
  const rates: Record<(typeof MEASURES)[number][1], Record<string, number | null>> = { boardPerM2: {}, edgeBandPerM: {}, finishPerM2: {}, hardwarePerUnit: {} };
  for (const l of rows.rateLines) {
    if (l.version_id !== e.versionId) throw new MappingError(`rate line ${l.item_key} belongs to version ${l.version_id}`);
    const field = MEASURES.find(([m]) => m === l.measure)?.[1];
    if (field === undefined) throw new MappingError(`unknown rate measure ${l.measure}`);
    if (l.item_key in rates[field]) throw new MappingError(`duplicate rate ${l.measure} ${l.item_key}`);
    rates[field][l.item_key] = l.rate_paise === null ? null : l.rate_paise / 100;
  }
  return {
    rateCard: { rateCardId: v.rate_card_code, version, status, classification: "PRODUCTION", currency: v.currency, effectiveFrom: e.effectiveFrom, source: e.source, ...rates },
    rules: {
      ruleSetId: v.rule_set_code,
      version,
      status,
      classification: "PRODUCTION",
      source: v.rules_source,
      manufacturingCost: v.manufacturing_cost_formula,
      wastagePercent: { board: v.wastage_board_pct, edgeBand: v.wastage_edge_band_pct, finish: v.wastage_finish_pct },
      overheadPercent: v.overhead_pct,
      marginBasis: v.margin_basis,
      marginPercent: v.margin_pct,
      gstPercent: v.gst_pct,
    },
  };
}

/* ------------------------------------------------------------ Finance / QuotationPolicy */

export interface TaxRateRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly rate_code: string;
  readonly percent: number | null;
}

export interface TaxRateMappingRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly product_category: string;
  readonly rate_code: string | null;
}

export interface QuotationPolicyVersionRow extends VersionRow {
  readonly tax_policy: TaxPolicy | null;
  readonly tax_rounding_mode: RoundingMode | null;
  readonly tax_rounding_increment_paise: number | null;
  readonly grand_total_rounding_mode: RoundingMode | null;
  readonly grand_total_rounding_increment_paise: number | null;
  /** Only NONE exists until finance approves other discount modes. */
  readonly discount_mode: "NONE" | null;
}

export interface QuotationPolicyRows {
  readonly version: QuotationPolicyVersionRow;
  readonly taxRates: readonly TaxRateRow[];
  readonly taxRateMappings: readonly TaxRateMappingRow[];
}

const roundingCols = (r: RoundingRule | null) => ({ mode: r?.mode ?? null, inc: r?.incrementPaise ?? null });
function roundingFrom(mode: RoundingMode | null, inc: number | null, what: string): RoundingRule | null {
  if (mode === null && inc === null) return null;
  if (mode === null || inc === null) throw new MappingError(`${what}: rounding mode and increment must both be set or both null`);
  return { mode, incrementPaise: inc };
}

export function quotationPolicyToRows(p: QuotationPolicy, meta: VersionMeta, ctx: MapContext): QuotationPolicyRows {
  assertNotTestFixture(`quotation policy ${p.policyId}`, p.classification, p.status);
  checkEngineStatus(`quotation policy ${p.policyId}`, p.status, meta);
  const taxRates = byKey(Object.keys(p.taxRates), (k) => k).map((code) => ({ org_id: ctx.orgId, version_id: meta.versionId, rate_code: code, percent: p.taxRates[code] ?? null }));
  const taxRateMappings = byKey(Object.keys(p.taxRateByProductCategory), (k) => k).map((cat) => ({ org_id: ctx.orgId, version_id: meta.versionId, product_category: cat, rate_code: p.taxRateByProductCategory[cat] ?? null }));
  const tax = roundingCols(p.rounding.tax);
  const grand = roundingCols(p.rounding.grandTotal);
  const content = omit(p, "status", "classification");
  return {
    version: {
      ...versionRow(ctx, p.policyId, meta, p.source, p.version, content),
      tax_policy: p.taxPolicy,
      tax_rounding_mode: tax.mode,
      tax_rounding_increment_paise: tax.inc,
      grand_total_rounding_mode: grand.mode,
      grand_total_rounding_increment_paise: grand.inc,
      discount_mode: p.discountPolicy?.mode ?? null,
    },
    taxRates,
    taxRateMappings,
  };
}

export const quotationPolicyFromRows = (rows: QuotationPolicyRows): Versioned<QuotationPolicy> => versioned(rows.version, quotationPolicyValue(rows));

function quotationPolicyValue(rows: QuotationPolicyRows): QuotationPolicy {
  const v = rows.version;
  const e = readEnvelope(v);
  const taxRates: Record<string, number | null> = {};
  for (const r of rows.taxRates) taxRates[r.rate_code] = r.percent;
  const taxRateByProductCategory: Record<string, string | null> = {};
  for (const m of rows.taxRateMappings) taxRateByProductCategory[m.product_category] = m.rate_code;
  return {
    policyId: v.entity_code,
    version: requireLabel(v),
    status: engineCalculationStatus(e.status),
    classification: "PRODUCTION",
    source: e.source,
    taxRates,
    taxRateByProductCategory,
    taxPolicy: v.tax_policy,
    rounding: { tax: roundingFrom(v.tax_rounding_mode, v.tax_rounding_increment_paise, "tax"), grandTotal: roundingFrom(v.grand_total_rounding_mode, v.grand_total_rounding_increment_paise, "grand total") },
    discountPolicy: v.discount_mode === null ? null : { mode: v.discount_mode },
  };
}
