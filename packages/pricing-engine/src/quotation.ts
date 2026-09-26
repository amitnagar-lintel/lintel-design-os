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
  RoomPriceSnapshot,
  TaxGroup,
  ValidationMessage,
  VersionRef,
} from "@lintel/types";
import { deepFreeze, hash53, stableStringify } from "@lintel/types";
import { buildValidationResult } from "@lintel/rules-engine";
import { compareRoomTrace, modelFingerprint } from "@lintel/design-engine";
import { percentToBasisPoints, toSafeNumber } from "./money.js";
import { isValidRoundingRule, roundRational } from "./rounding.js";
import { priceCabinets, verifyRoomPricing } from "./room-price.js";

/** Semantic version of the quotation engine (M5 Step 7); recorded with every quotation snapshot beside its fingerprint. */
export const QUOTATION_ENGINE_VERSION = "0.1.0";

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

function policyGate(input: { readonly mode: DataClassification; readonly policy: QuotationPolicy; readonly room: ResolvedRoom }, categories: readonly string[]): ValidationMessage[] {
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

/** Product category per exact product version, from the pinned catalog (never from code). */
function categoryLookup(catalog: CatalogSnapshot) {
  return (productId: string, version: string): string | undefined => catalog.products.find((p) => p.productId === productId && p.version === version)?.category;
}

/** Room-level quotation gates shared by priceQuotation and quoteRoom (empty room, unknown products, policy). */
function roomGates(input: { readonly mode: DataClassification; readonly policy: QuotationPolicy; readonly room: ResolvedRoom; readonly catalog: CatalogSnapshot }): ValidationMessage[] {
  const { room } = input;
  const blockers: ValidationMessage[] = [];
  if (room.cabinets.length === 0) blockers.push(block("QUOTATION_EMPTY_ROOM", "Room has no objects to quote", "room"));
  const categoryOf = categoryLookup(input.catalog);
  for (const c of room.cabinets) {
    if (categoryOf(c.trace.product.id, c.trace.product.version) === undefined) blockers.push(block("QUOTATION_PRODUCT_UNKNOWN", `${c.object.objectCode}: product ${c.trace.product.id} v${c.trace.product.version} not in catalog ${input.catalog.catalogVersion}`));
  }
  const categories = [...new Set(room.cabinets.map((c) => categoryOf(c.trace.product.id, c.trace.product.version) ?? ""))].filter((c) => c !== "").sort();
  blockers.push(...policyGate(input, categories));
  return blockers;
}

/**
 * Lines → tax groups → tax per policy → rounding → totals, from exact per-object price snapshots (one per object, in
 * room order). The only place quotation arithmetic happens; shared by priceQuotation and quoteRoom.
 */
function assembleQuotation(input: {
  readonly mode: DataClassification;
  readonly room: ResolvedRoom;
  readonly roomBomId: string;
  readonly roomBoq: RoomBOQ;
  readonly policy: QuotationPolicy;
  readonly catalog: CatalogSnapshot;
  readonly rateCardRef: VersionRef;
  readonly pricingRulesRef: VersionRef;
  readonly snapshots: readonly PriceSnapshot[];
  readonly revision: string;
  readonly createdAt: string;
}): QuotationResult {
  const { mode, room, roomBoq, policy, snapshots } = input;
  const categoryOf = categoryLookup(input.catalog);
  const blockers: ValidationMessage[] = [];
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
    roomBomId: input.roomBomId,
    roomBoqId: roomBoq.roomBoqId,
    policy: JSON.parse(JSON.stringify(policy)) as QuotationPolicy,
    policyRef: { id: policy.policyId, version: policy.version, status: policy.status },
    rateCardRef: input.rateCardRef,
    pricingRulesRef: input.pricingRulesRef,
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
    priceSnapshots: [...snapshots],
  };
  const snapshot = deepFreeze({ ...body, contentHash: hash53(stableStringify(body)) });
  const messages: ValidationMessage[] =
    mode === "TEST_FIXTURE" ? [{ code: "QUOTATION_IS_TEST_FIXTURE", severity: "BLOCKER", message: "TEST_FIXTURE quotation: synthetic rates and policy, never issued to a client" }] : [];
  return { status: "PRICED", snapshot, messages };
}

/**
 * Room quotation (M4): each object priced by `priceCabinet` (immutable price snapshots),
 * line taxable amounts → grouped by applicable tax rate → tax per policy → rounding →
 * totals. Returns an immutable, hash-sealed QuotationSnapshot or UNAVAILABLE with every blocker.
 * Equivalent to priceRoom + quoteRoom (M5 Step 7), which the output API uses to consume an exact pricing snapshot.
 */
export function priceQuotation(input: PriceQuotationInput): QuotationResult {
  const { mode, room, roomBom, roomBoq, rateCard, rules } = input;
  const blockers: ValidationMessage[] = [];
  if (roomBom.roomFingerprint !== room.roomFingerprint || roomBoq.roomFingerprint !== room.roomFingerprint || roomBoq.roomBomId !== roomBom.roomBomId) {
    blockers.push(block("QUOTATION_TRACE_MISMATCH", "Room BOM / BOQ were not derived from this room model", "room"));
  }
  blockers.push(...roomGates(input));
  // Price every object with the existing (M2) engine.
  const priced = priceCabinets({ mode, room, roomBom, roomBoq, rateCard, rules, createdAt: input.createdAt }, (code) => block("QUOTATION_TRACE_MISMATCH", `No BOM/BOQ for ${code}`));
  blockers.push(...priced.blockers);
  if (blockers.length > 0) return { status: "UNAVAILABLE", classification: mode, blockers: buildValidationResult(blockers).messages };
  return assembleQuotation({
    mode, room, roomBomId: roomBom.roomBomId, roomBoq, policy: input.policy, catalog: input.catalog, snapshots: priced.snapshots, revision: input.revision, createdAt: input.createdAt,
    rateCardRef: { id: rateCard.rateCardId, version: rateCard.version, status: rateCard.status },
    pricingRulesRef: { id: rules.ruleSetId, version: rules.version, status: rules.status },
  });
}

export interface QuoteRoomInput {
  readonly mode: DataClassification;
  readonly room: ResolvedRoom;
  readonly roomBoq: RoomBOQ;
  /** An exact, sealed room pricing (priceRoom) of this room, BOM and BOQ. It is consumed, never re-priced. */
  readonly pricing: RoomPriceSnapshot;
  readonly policy: QuotationPolicy;
  readonly catalog: CatalogSnapshot;
  readonly revision: string;
  /** Supplied by the caller (ISO timestamp). */
  readonly createdAt: string;
}

/**
 * Quotation from an existing room pricing (M5 Step 7): the same policy gates, tax, rounding and totals as
 * priceQuotation, but the per-object prices are the exact price snapshots of `pricing` — nothing is re-priced.
 * The pricing must be sealed, of the same classification, and of exactly this room model, BOM and BOQ.
 */
export function quoteRoom(input: QuoteRoomInput): QuotationResult {
  const { mode, room, roomBoq, pricing } = input;
  const blockers: ValidationMessage[] = [];
  if (pricing.roomFingerprint !== room.roomFingerprint || roomBoq.roomFingerprint !== room.roomFingerprint || pricing.roomBoqId !== roomBoq.roomBoqId || pricing.roomBomId !== roomBoq.roomBomId) {
    blockers.push(block("QUOTATION_TRACE_MISMATCH", "Room pricing / BOQ were not derived from this room model", "pricing"));
  }
  if (!verifyRoomPricing(pricing)) blockers.push(block("QUOTATION_PRICING_INVALID", `Room pricing ${pricing.roomPricingId} does not match its seal`, "pricing.contentHash"));
  if (pricing.classification !== mode) blockers.push(block("QUOTATION_CLASSIFICATION_MISMATCH", `Room pricing is ${pricing.classification}; ${mode} quotation refuses it`, "pricing.classification"));
  if (pricing.priceSnapshots.length !== room.cabinets.length) blockers.push(block("QUOTATION_TRACE_MISMATCH", "Room pricing does not price every object of the room", "pricing.priceSnapshots"));
  room.cabinets.forEach((c, i) => {
    const s = pricing.priceSnapshots[i];
    if (s !== undefined && (s.trace.objectId !== c.object.objectId || s.modelFingerprint !== modelFingerprint(c))) {
      blockers.push({ ...block("QUOTATION_TRACE_MISMATCH", `${c.object.objectCode}: the price snapshot is for another object model`), sourceObjectId: c.object.objectId });
    }
  });
  blockers.push(...roomGates(input));
  if (blockers.length > 0) return { status: "UNAVAILABLE", classification: mode, blockers: buildValidationResult(blockers).messages };
  return assembleQuotation({
    mode, room, roomBomId: pricing.roomBomId, roomBoq, policy: input.policy, catalog: input.catalog, snapshots: pricing.priceSnapshots, revision: input.revision,
    createdAt: input.createdAt, rateCardRef: pricing.rateCardRef, pricingRulesRef: pricing.pricingRulesRef,
  });
}

export function verifyQuotation(q: QuotationSnapshot): boolean {
  const { contentHash, ...body } = q;
  return hash53(stableStringify(body)) === contentHash;
}

/** Stale when the room model changed; reports exactly which objects changed, were added or removed. */
export function checkQuotationStaleness(q: QuotationSnapshot, current: ResolvedRoom): QuotationStaleness {
  return compareRoomTrace(q.trace, q.roomFingerprint, current);
}
