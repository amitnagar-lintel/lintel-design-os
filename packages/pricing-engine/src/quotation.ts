import type {
  CatalogSnapshot,
  DataClassification,
  PricingRuleSet,
  PriceSnapshot,
  QuotationLine,
  QuotationPolicy,
  QuotationSnapshot,
  QuotationStaleness,
  RateCard,
  ResolvedRoom,
  RoomBOM,
  RoomBOQ,
  TaxGroup,
  ValidationMessage,
} from "@lintel/types";
import { deepFreeze, hash53, stableStringify } from "@lintel/types";
import { buildValidationResult } from "@lintel/rules-engine";
import { compareRoomTrace } from "@lintel/design-engine";
import { percentToBasisPoints, toSafeNumber } from "./money.js";
import { priceCabinet } from "./price.js";
import { isValidRoundingRule, roundRational } from "./rounding.js";

export interface PriceQuotationInput {
  readonly mode: DataClassification;
  readonly room: ResolvedRoom;
  readonly roomBom: RoomBOM;
  readonly roomBoq: RoomBOQ;
  readonly rateCard: RateCard;
  readonly rules: PricingRuleSet;
  readonly policy: QuotationPolicy;
  /** Product categories (for the tax-rate mapping) come from the catalog, never from code. */
  readonly catalog: CatalogSnapshot;
  readonly revision: string;
  /** Supplied by the caller (ISO timestamp). */
  readonly createdAt: string;
}

export type QuotationResult =
  | { readonly status: "PRICED"; readonly snapshot: QuotationSnapshot; readonly messages: readonly ValidationMessage[] }
  | { readonly status: "UNAVAILABLE"; readonly classification: DataClassification; readonly blockers: readonly ValidationMessage[] };

const block = (code: string, message: string, path?: string): ValidationMessage => (path === undefined ? { code, severity: "BLOCKER", message } : { code, severity: "BLOCKER", message, path });

function policyGate(input: PriceQuotationInput, categories: readonly string[]): ValidationMessage[] {
  const { mode, policy, room } = input;
  const out: ValidationMessage[] = [];
  if (policy.classification !== mode) out.push(block("QUOTATION_CLASSIFICATION_MISMATCH", `Policy ${policy.policyId} is ${policy.classification}; ${mode} quotation refuses it`, "policy"));
  if (policy.classification === "TEST_FIXTURE" && policy.status !== "TEST_FIXTURE") out.push(block("QUOTATION_POLICY_MISLABELLED", `Policy ${policy.policyId}: TEST_FIXTURE classification requires TEST_FIXTURE status`, "policy.status"));
  if (mode === "PRODUCTION") {
    if (policy.status !== "APPROVED") out.push(block("QUOTATION_POLICY_NOT_APPROVED", `Quotation policy ${policy.policyId} v${policy.version} is ${policy.status}`, "policy.status"));
    if (room.trace.dataClassification !== "PRODUCTION") out.push(block("QUOTATION_TEST_FIXTURE_DESIGN_DATA", `Room uses TEST_FIXTURE data (${room.trace.testFixtureSources.join("; ")})`, "room.trace"));
    if (!room.validation.canApprove) out.push(block("QUOTATION_ROOM_BLOCKED", `Room has ${room.validation.counts.BLOCKER} BLOCKER(s) outstanding`, "room.validation"));
  }
  if (policy.taxPolicy === null) out.push(block("QUOTATION_POLICY_UNVERIFIED", `Tax policy is NULL / UNVERIFIED in ${policy.policyId}`, "policy.taxPolicy"));
  if (policy.rounding.tax === null) out.push(block("QUOTATION_POLICY_UNVERIFIED", `Tax rounding policy is NULL / UNVERIFIED in ${policy.policyId}`, "policy.rounding.tax"));
  else if (!isValidRoundingRule(policy.rounding.tax)) out.push(block("QUOTATION_POLICY_INVALID", "Tax rounding increment must be a positive integer number of paise", "policy.rounding.tax"));
  if (policy.rounding.grandTotal === null) out.push(block("QUOTATION_POLICY_UNVERIFIED", `Grand-total rounding policy is NULL / UNVERIFIED in ${policy.policyId}`, "policy.rounding.grandTotal"));
  else if (!isValidRoundingRule(policy.rounding.grandTotal)) out.push(block("QUOTATION_POLICY_INVALID", "Grand-total rounding increment must be a positive integer number of paise", "policy.rounding.grandTotal"));
  if (policy.discountPolicy === null) out.push(block("QUOTATION_POLICY_UNVERIFIED", `Discount policy is NULL / UNVERIFIED in ${policy.policyId}`, "policy.discountPolicy"));
  for (const cat of categories) {
    const rateId = policy.taxRateByProductCategory[cat];
    if (rateId === undefined || rateId === null) {
      out.push(block("QUOTATION_TAX_RATE_UNVERIFIED", `No verified tax rate for product category ${cat} in ${policy.policyId}`, `policy.taxRateByProductCategory.${cat}`));
      continue;
    }
    const pct = policy.taxRates[rateId];
    if (pct === undefined || pct === null) out.push(block("QUOTATION_TAX_RATE_UNVERIFIED", `Tax rate ${rateId} is NULL / UNVERIFIED in ${policy.policyId}`, `policy.taxRates.${rateId}`));
    else {
      try {
        percentToBasisPoints(pct);
      } catch (e) {
        out.push(block("QUOTATION_POLICY_INVALID", `Tax rate ${rateId}: ${(e as Error).message}`, `policy.taxRates.${rateId}`));
      }
    }
  }
  return out;
}

/**
 * Room quotation (M4): each object priced by `priceCabinet` (immutable price snapshots),
 * line taxable amounts → grouped by applicable tax rate → tax per policy → rounding →
 * totals. Returns an immutable, hash-sealed QuotationSnapshot or UNAVAILABLE with every blocker.
 */
export function priceQuotation(input: PriceQuotationInput): QuotationResult {
  const { mode, room, roomBom, roomBoq, rateCard, rules, policy } = input;
  const blockers: ValidationMessage[] = [];
  if (roomBom.roomFingerprint !== room.roomFingerprint || roomBoq.roomFingerprint !== room.roomFingerprint || roomBoq.roomBomId !== roomBom.roomBomId) {
    blockers.push(block("QUOTATION_TRACE_MISMATCH", "Room BOM / BOQ were not derived from this room model", "room"));
  }
  if (room.cabinets.length === 0) blockers.push(block("QUOTATION_EMPTY_ROOM", "Room has no objects to quote", "room"));
  const categoryOf = (productId: string, version: string): string | undefined => input.catalog.products.find((p) => p.productId === productId && p.version === version)?.category;
  for (const c of room.cabinets) {
    if (categoryOf(c.trace.product.id, c.trace.product.version) === undefined) blockers.push(block("QUOTATION_PRODUCT_UNKNOWN", `${c.object.objectCode}: product ${c.trace.product.id} v${c.trace.product.version} not in catalog ${input.catalog.catalogVersion}`));
  }
  const categories = [...new Set(room.cabinets.map((c) => categoryOf(c.trace.product.id, c.trace.product.version) ?? ""))].filter((c) => c !== "").sort();
  blockers.push(...policyGate(input, categories));

  // Price every object with the existing (M2) engine.
  const snapshots: PriceSnapshot[] = [];
  room.cabinets.forEach((c, i) => {
    const bom = roomBom.objectBoms[i];
    const boq = roomBoq.objectBoqs[i];
    if (bom === undefined || boq === undefined) {
      blockers.push(block("QUOTATION_TRACE_MISMATCH", `No BOM/BOQ for ${c.object.objectCode}`));
      return;
    }
    const r = priceCabinet({ mode, resolved: c, bom, boq, rateCard, rules, createdAt: input.createdAt });
    if (r.status === "UNAVAILABLE") for (const b of r.blockers) blockers.push({ ...b, message: `${c.object.objectCode}: ${b.message}`, sourceObjectId: c.object.objectId });
    else snapshots.push(r.snapshot);
  });
  if (blockers.length > 0) return { status: "UNAVAILABLE", classification: mode, blockers: buildValidationResult(blockers).messages };

  const taxRule = policy.rounding.tax;
  const totalRule = policy.rounding.grandTotal;
  if (taxRule === null || totalRule === null || policy.taxPolicy === null) throw new Error("unreachable: policy gate");

  // Lines.
  const lines: QuotationLine[] = [];
  snapshots.forEach((s, i) => {
    const c = room.cabinets[i];
    const item = roomBoq.objectBoqs[i]?.items[0];
    const bp = s.boqPrices[0];
    if (c === undefined || item === undefined || bp === undefined) throw new Error("unreachable: line alignment");
    const rateId = policy.taxRateByProductCategory[categoryOf(c.trace.product.id, c.trace.product.version) ?? ""] ?? "";
    const pct = policy.taxRates[rateId] ?? 0;
    // The per-object price snapshot records GST from the pricing rules; the rate must agree with the quotation policy.
    if (s.pricingRules.gstPercent !== pct) {
      blockers.push(block("QUOTATION_TAX_RATE_CONFLICT", `${c.object.objectCode}: pricing rules GST ${String(s.pricingRules.gstPercent)}% ≠ quotation tax rate ${rateId} ${pct}%`));
    }
    const taxable = BigInt(bp.amountExGst);
    lines.push({
      lineNo: i + 1,
      lineId: `QL:${item.boqItemId}`,
      boqItemId: item.boqItemId,
      objectId: c.object.objectId,
      objectCode: c.object.objectCode,
      productId: item.productId,
      description: `${c.object.objectCode} ${item.description}`,
      quantity: item.quantity,
      unitPriceExGst: bp.unitPriceExGst,
      taxableAmount: toSafeNumber(taxable),
      taxRateId: rateId,
      taxPercent: pct,
      lineTax: policy.taxPolicy === "PER_LINE" ? toSafeNumber(roundRational(taxable * percentToBasisPoints(pct), 10_000n, taxRule)) : null,
      priceSnapshotId: s.priceSnapshotId,
      priceSnapshotHash: s.contentHash,
    });
  });
  if (blockers.length > 0) return { status: "UNAVAILABLE", classification: mode, blockers: buildValidationResult(blockers).messages };

  // Group by tax rate → tax.
  const groups = new Map<string, { percent: number; taxable: bigint; lineTax: bigint; lineNos: number[] }>();
  for (const l of lines) {
    const g = groups.get(l.taxRateId) ?? { percent: l.taxPercent, taxable: 0n, lineTax: 0n, lineNos: [] };
    g.taxable += BigInt(l.taxableAmount);
    g.lineTax += BigInt(l.lineTax ?? 0);
    g.lineNos.push(l.lineNo);
    groups.set(l.taxRateId, g);
  }
  const taxGroups: TaxGroup[] = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([taxRateId, g]) => ({
      taxRateId,
      percent: g.percent,
      taxableAmount: toSafeNumber(g.taxable),
      taxAmount: toSafeNumber(policy.taxPolicy === "PER_LINE" ? g.lineTax : roundRational(g.taxable * percentToBasisPoints(g.percent), 10_000n, taxRule)),
      lineNos: g.lineNos,
    }));

  const taxable = lines.reduce((a, l) => a + BigInt(l.taxableAmount), 0n);
  const discount = 0n; // DiscountPolicy NONE (the only mode in M4)
  const tax = taxGroups.reduce((a, g) => a + BigInt(g.taxAmount), 0n);
  const before = taxable - discount + tax;
  const grand = roundRational(before, 1n, totalRule);

  const body: Omit<QuotationSnapshot, "contentHash"> = {
    quotationId: `QUO:${room.trace.designVersionId}:${room.room.id}:R${input.revision}`,
    revision: input.revision,
    classification: mode,
    currency: "INR",
    createdAt: input.createdAt,
    trace: JSON.parse(JSON.stringify(room.trace)) as QuotationSnapshot["trace"],
    roomFingerprint: room.roomFingerprint,
    roomBomId: roomBom.roomBomId,
    roomBoqId: roomBoq.roomBoqId,
    policy: JSON.parse(JSON.stringify(policy)) as QuotationPolicy,
    policyRef: { id: policy.policyId, version: policy.version, status: policy.status },
    rateCardRef: { id: rateCard.rateCardId, version: rateCard.version, status: rateCard.status },
    pricingRulesRef: { id: rules.ruleSetId, version: rules.version, status: rules.status },
    lines,
    taxGroups,
    totals: {
      taxableAmount: toSafeNumber(taxable),
      discountAmount: toSafeNumber(discount),
      taxAmount: toSafeNumber(tax),
      totalBeforeRounding: toSafeNumber(before),
      roundingAdjustment: toSafeNumber(grand - before),
      grandTotal: toSafeNumber(grand),
    },
    priceSnapshots: snapshots,
  };
  const snapshot = deepFreeze({ ...body, contentHash: hash53(stableStringify(body)) });
  const messages: ValidationMessage[] =
    mode === "TEST_FIXTURE" ? [{ code: "QUOTATION_IS_TEST_FIXTURE", severity: "BLOCKER", message: "TEST_FIXTURE quotation: synthetic rates and policy, never issued to a client" }] : [];
  return { status: "PRICED", snapshot, messages };
}

export function verifyQuotation(q: QuotationSnapshot): boolean {
  const { contentHash, ...body } = q;
  return hash53(stableStringify(body)) === contentHash;
}

/** Stale when the room model changed; reports exactly which objects changed, were added or removed. */
export function checkQuotationStaleness(q: QuotationSnapshot, current: ResolvedRoom): QuotationStaleness {
  return compareRoomTrace(q.trace, q.roomFingerprint, current);
}
