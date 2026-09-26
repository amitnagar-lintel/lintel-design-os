import type { DataClassification, PricingResult, PricingRuleSet, RateCard } from "@lintel/types";
import { priceCabinet, TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_RATE_CARD } from "@lintel/pricing-engine";
import type { SliceResult } from "./scenario.js";

export const PRICED_AT = "2026-09-26T00:00:00.000Z";

export function price(slice: SliceResult, opts: { mode?: DataClassification; rateCard?: RateCard; rules?: PricingRuleSet } = {}): PricingResult {
  return priceCabinet({
    mode: opts.mode ?? "TEST_FIXTURE",
    resolved: slice.resolved,
    bom: slice.bom,
    boq: slice.boq,
    rateCard: opts.rateCard ?? TEST_FIXTURE_RATE_CARD,
    rules: opts.rules ?? TEST_FIXTURE_PRICING_RULES,
    createdAt: PRICED_AT,
  });
}

export function priced(result: PricingResult) {
  if (result.status !== "PRICED") throw new Error(`expected PRICED, got UNAVAILABLE: ${result.blockers.map((b) => b.code).join(", ")}`);
  return result.snapshot;
}
