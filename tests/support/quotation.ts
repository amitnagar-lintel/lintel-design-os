import type { DataClassification, QuotationPolicy, ResolvedRoom } from "@lintel/types";
import { LINTEL_CATALOG } from "@lintel/catalog-engine";
import { generateRoomBom } from "@lintel/bom-engine";
import { generateRoomBoq } from "@lintel/boq-engine";
import { priceQuotation, TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_QUOTATION_POLICY, TEST_FIXTURE_RATE_CARD } from "@lintel/pricing-engine";
import type { QuotationResult } from "@lintel/pricing-engine";
import type { PricingRuleSet, RateCard } from "@lintel/types";

export const QUOTED_AT = "2026-09-26T00:00:00.000Z";

export function roomCommercials(room: ResolvedRoom) {
  const roomBom = generateRoomBom(room);
  const roomBoq = generateRoomBoq(room, LINTEL_CATALOG, roomBom);
  return { roomBom, roomBoq };
}

export function quote(room: ResolvedRoom, opts: { mode?: DataClassification; policy?: QuotationPolicy; rateCard?: RateCard; rules?: PricingRuleSet } = {}): QuotationResult {
  const { roomBom, roomBoq } = roomCommercials(room);
  return priceQuotation({
    mode: opts.mode ?? "TEST_FIXTURE",
    room,
    roomBom,
    roomBoq,
    rateCard: opts.rateCard ?? TEST_FIXTURE_RATE_CARD,
    rules: opts.rules ?? TEST_FIXTURE_PRICING_RULES,
    policy: opts.policy ?? TEST_FIXTURE_QUOTATION_POLICY,
    catalog: LINTEL_CATALOG,
    revision: "A",
    createdAt: QUOTED_AT,
  });
}

export function quoted(r: QuotationResult) {
  if (r.status !== "PRICED") throw new Error(`expected PRICED, got UNAVAILABLE: ${r.blockers.map((b) => b.code).join(", ")}`);
  return r.snapshot;
}
