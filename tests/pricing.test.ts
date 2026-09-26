/**
 * M2 pricing (PRD §23). TEST_FIXTURE rates are synthetic; expected amounts are
 * computed by hand from the BOM (see comments). PRODUCTION pricing must be unavailable.
 */
import { describe, expect, it } from "vitest";
import type { PricingRuleSet, RateCard } from "@lintel/types";
import {
  isPriceStale,
  LINTEL_PRODUCTION_PRICING_RULES,
  LINTEL_PRODUCTION_RATE_CARD,
  TEST_FIXTURE_PRICING_RULES,
  TEST_FIXTURE_RATE_CARD,
  verifyPriceSnapshot,
} from "@lintel/pricing-engine";
import { fixtureSlice, productionSlice, referenceObject } from "./support/scenario.js";
import { price, priced } from "./support/pricing.js";

const blockerCodes = (r: ReturnType<typeof price>): string[] => (r.status === "UNAVAILABLE" ? r.blockers.map((b) => b.code) : []);

describe("TEST_FIXTURE pricing of the reference cabinet", () => {
  const snap = priced(price(fixtureSlice()));

  it("prices every BOM category exactly (integer paise, half up)", () => {
    const amount = (id: string) => snap.lines.find((l) => l.lineId === id)?.amount;
    expect(amount("PL:MATERIAL:BOARD:BOARD_BWP_18")).toBe(152616); // 1.526156 m² × ₹1000
    expect(amount("PL:MATERIAL:BOARD:BOARD_BACK_6")).toBe(16472); // 0.4118 × ₹400
    expect(amount("PL:MATERIAL:BOARD:BOARD_HDHMR_18")).toBe(38331); // 0.425898 × ₹900 = 38330.82
    expect(amount("PL:MATERIAL:EDGE:EDGE_ABS_0_8MM")).toBe(3756); // 3.13 m × ₹12
    expect(amount("PL:MATERIAL:EDGE:EDGE_ABS_2MM")).toBe(12168); // 4.056 m × ₹30
    expect(amount("PL:FINISH:LAMINATE_WHITE")).toBe(29813); // 0.851796 × ₹350 = 29812.86
    expect(amount("PL:HARDWARE:HETTICH:FIXTURE-HINGE-FO-A")).toBe(60000); // 4 × ₹150
    expect(amount("PL:HARDWARE:HETTICH:FIXTURE-PLATE-A")).toBe(16000); // 4 × ₹40
    expect(amount("PL:MANUFACTURING")).toBe(177875); // 9×120 + 2.363854×250 + 7.186×15 = ₹1778.7535
    expect(amount("PL:WASTAGE:BOARD")).toBe(20742); // 10% of 207419
    expect(amount("PL:WASTAGE:EDGE_BAND")).toBe(796); // 5% of 15924
    expect(amount("PL:WASTAGE:FINISH")).toBe(2385); // 8% of 29813
  });
  it("builds totals: direct → overhead → margin on price → GST", () => {
    expect(snap.totals).toEqual({
      material: 223343,
      finish: 29813,
      hardware: 76000,
      manufacturing: 177875,
      wastage: 23923,
      directCost: 530954,
      overhead: 66369, // 12.5% of 530954 = 66369.25
      totalCost: 597323,
      margin: 281093, // 597323 / 0.68 = 878416.18 → 878416
      sellingPriceExGst: 878416,
      gst: 158115, // 18% = 158114.88
      sellingPriceIncGst: 1036531,
    });
    expect(snap.boqPrices).toEqual([{ boqItemId: "BOQ:dv_001:obj_001", quantity: 1, unitPriceExGst: 878416, amountExGst: 878416 }]);
  });
  it("is labelled TEST_FIXTURE and traces to the design", () => {
    expect(snap.classification).toBe("TEST_FIXTURE");
    expect(snap.rateCardRef).toEqual({ id: "TEST_FIXTURE_RATE_CARD", version: "0.0.1", status: "TEST_FIXTURE" });
    expect(snap.trace.designVersionId).toBe("dv_001");
    expect(snap.trace.dataClassification).toBe("TEST_FIXTURE");
    expect(snap.bomId).toBe("BOM:dv_001:obj_001");
    expect(snap.designBlockerCount).toBeGreaterThan(0);
    const r = price(fixtureSlice());
    expect(r.status === "PRICED" ? r.messages.map((m) => m.code) : []).toEqual(["PRICE_IS_TEST_FIXTURE"]);
  });
  it("supports markup-on-cost as an alternative margin basis", () => {
    const s = priced(price(fixtureSlice(), { rules: { ...TEST_FIXTURE_PRICING_RULES, marginBasis: "MARKUP_ON_COST" } }));
    expect(s.totals.margin).toBe(191143); // 32% of 597323 = 191143.36
    expect(s.totals.sellingPriceExGst).toBe(788466);
  });
});

describe("immutability (PRD §23: old quotations never change)", () => {
  const slice = fixtureSlice();
  const snap = priced(price(slice));

  it("is deeply frozen and hash-sealed", () => {
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.totals)).toBe(true);
    expect(Object.isFrozen(snap.rateCard.boardPerM2)).toBe(true);
    expect(verifyPriceSnapshot(snap)).toBe(true);
    expect(() => {
      (snap.totals as { sellingPriceIncGst: number }).sellingPriceIncGst = 1;
    }).toThrow(TypeError);
  });
  it("detects tampering with a copied snapshot", () => {
    const copy = structuredClone(snap);
    (copy.totals as { gst: number }).gst += 1;
    expect(verifyPriceSnapshot(copy)).toBe(false);
  });
  it("embeds the exact rates used: a later rate change does not alter it", () => {
    const newRates: RateCard = { ...TEST_FIXTURE_RATE_CARD, version: "0.0.2", boardPerM2: { ...TEST_FIXTURE_RATE_CARD.boardPerM2, BOARD_BWP_18: 2000 } };
    const repriced = priced(price(slice, { rateCard: newRates }));
    expect(repriced.totals.sellingPriceIncGst).toBeGreaterThan(snap.totals.sellingPriceIncGst);
    expect(snap.rateCard.boardPerM2.BOARD_BWP_18).toBe(1000);
    expect(snap.totals.sellingPriceIncGst).toBe(1036531);
    expect(verifyPriceSnapshot(snap)).toBe(true);
  });
  it("detects a stale price when the model changes", () => {
    expect(isPriceStale(snap, slice.resolved)).toBe(false);
    expect(isPriceStale(snap, fixtureSlice(referenceObject({ dimensions: { width: 750 } })).resolved)).toBe(true);
  });
  it("is deterministic", () => {
    expect(priced(price(fixtureSlice()))).toEqual(snap);
  });
});

describe("price follows design changes (PRD §43)", () => {
  const base = priced(price(fixtureSlice())).totals;
  it("Test B: width 750 increases material, manufacturing and price", () => {
    const t = priced(price(fixtureSlice(referenceObject({ dimensions: { width: 750 } })))).totals;
    expect(t.material).toBeGreaterThan(base.material);
    expect(t.manufacturing).toBeGreaterThan(base.manufacturing);
    expect(t.sellingPriceIncGst).toBeGreaterThan(base.sellingPriceIncGst);
  });
  it("Test C: one shutter halves hinge cost", () => {
    const t = priced(price(fixtureSlice(referenceObject({ parameters: { shutterCount: 1 } })))).totals;
    expect(t.hardware).toBe(38000); // 2 × 150 + 2 × 40
  });
  it("Test D: inset uses the inset article rate", () => {
    const s = priced(price(fixtureSlice(referenceObject({ parameters: { frontType: "INSET" } }))));
    expect(s.lines.find((l) => l.lineId === "PL:HARDWARE:HETTICH:FIXTURE-HINGE-IN-A")?.amount).toBe(68000); // 4 × 170
  });
  it("Test E: carcass material change reprices the board", () => {
    const s = priced(price(fixtureSlice(referenceObject({ parameters: { material: "BOARD_HDHMR_18" } }))));
    expect(s.lines.find((l) => l.lineId === "PL:MATERIAL:BOARD:BOARD_HDHMR_18")?.amount).toBe(175685); // 1.952054 × ₹900 = 175684.86
    expect(s.lines.some((l) => l.lineId === "PL:MATERIAL:BOARD:BOARD_BWP_18")).toBe(false);
  });
});

describe("refusals — nothing priced at zero, no substitution", () => {
  it("a missing rate makes pricing unavailable", () => {
    const rest = Object.fromEntries(Object.entries(TEST_FIXTURE_RATE_CARD.boardPerM2).filter(([k]) => k !== "BOARD_BACK_6"));
    const r = price(fixtureSlice(), { rateCard: { ...TEST_FIXTURE_RATE_CARD, boardPerM2: rest } });
    expect(blockerCodes(r)).toEqual(["PRICING_RATE_MISSING"]);
  });
  it("a NULL / UNVERIFIED rate or rule makes pricing unavailable", () => {
    const r = price(fixtureSlice(), {
      rateCard: { ...TEST_FIXTURE_RATE_CARD, finishPerM2: { LAMINATE_WHITE: null } },
      rules: { ...TEST_FIXTURE_PRICING_RULES, gstPercent: null },
    });
    expect(blockerCodes(r)).toEqual(["PRICING_RATE_UNVERIFIED", "PRICING_RULE_UNVERIFIED"]);
  });
  it("rejects imprecise rates and impossible margins", () => {
    const r = price(fixtureSlice(), {
      rateCard: { ...TEST_FIXTURE_RATE_CARD, edgeBandPerM: { ...TEST_FIXTURE_RATE_CARD.edgeBandPerM, EDGE_ABS_2MM: 30.005 } },
      rules: { ...TEST_FIXTURE_PRICING_RULES, marginPercent: 100 },
    });
    expect(blockerCodes(r)).toEqual(["PRICING_RATE_INVALID", "PRICING_RULE_INVALID"]);
  });
  it("a cabinet with an unresolved material is never priced (regression: omitted panels made the BOM look complete)", () => {
    const s = fixtureSlice(referenceObject({ parameters: { material: "NOT_A_MATERIAL" } }));
    expect(s.bom.incomplete).toBe(true);
    expect(blockerCodes(price(s))).toContain("PRICING_BOM_INCOMPLETE");
  });
  it("an incomplete BOM (unresolved hinges) is never priced", () => {
    expect(blockerCodes(price(productionSlice()))).toContain("PRICING_BOM_INCOMPLETE");
  });
  it("PRODUCTION pricing refuses TEST_FIXTURE rate cards and rules", () => {
    const r = price(fixtureSlice(), { mode: "PRODUCTION" });
    expect(blockerCodes(r)).toEqual(expect.arrayContaining(["PRICING_CLASSIFICATION_MISMATCH", "PRICING_TEST_FIXTURE_DESIGN_DATA", "PRICING_RATE_CARD_NOT_APPROVED"]));
  });
  it("TEST_FIXTURE pricing refuses PRODUCTION rate cards (no mixing either way)", () => {
    const r = price(fixtureSlice(), { rateCard: LINTEL_PRODUCTION_RATE_CARD });
    expect(blockerCodes(r)).toContain("PRICING_CLASSIFICATION_MISMATCH");
  });
  it("fixture data mislabelled as approved is refused", () => {
    const r = price(fixtureSlice(), { rateCard: { ...TEST_FIXTURE_RATE_CARD, status: "APPROVED" } });
    expect(blockerCodes(r)).toContain("PRICING_DATA_MISLABELLED");
  });
  it("even an APPROVED production card cannot price a TEST_FIXTURE design", () => {
    const approvedCard: RateCard = { ...TEST_FIXTURE_RATE_CARD, rateCardId: "HYPOTHETICAL", classification: "PRODUCTION", status: "APPROVED" };
    const approvedRules: PricingRuleSet = { ...TEST_FIXTURE_PRICING_RULES, ruleSetId: "HYPOTHETICAL", classification: "PRODUCTION", status: "APPROVED" };
    const r = price(fixtureSlice(), { mode: "PRODUCTION", rateCard: approvedCard, rules: approvedRules });
    expect(blockerCodes(r)).toEqual(["PRICING_DESIGN_BLOCKED", "PRICING_TEST_FIXTURE_DESIGN_DATA"]);
  });
});

describe("PRODUCTION pricing is unavailable until the production catalog is approved", () => {
  const r = price(productionSlice(), { mode: "PRODUCTION", rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES });
  it("returns UNAVAILABLE with every reason, and no snapshot", () => {
    expect(r.status).toBe("UNAVAILABLE");
    expect(blockerCodes(r)).toEqual(
      expect.arrayContaining(["PRICING_RATE_CARD_NOT_APPROVED", "PRICING_RULES_NOT_APPROVED", "PRICING_DESIGN_BLOCKED", "PRICING_BOM_INCOMPLETE", "PRICING_RATE_UNVERIFIED", "PRICING_RULE_UNVERIFIED"]),
    );
  });
  it("production rate card and rules contain no invented values", () => {
    const rates = [LINTEL_PRODUCTION_RATE_CARD.boardPerM2, LINTEL_PRODUCTION_RATE_CARD.edgeBandPerM, LINTEL_PRODUCTION_RATE_CARD.finishPerM2, LINTEL_PRODUCTION_RATE_CARD.hardwarePerUnit].flatMap((t) => Object.values(t));
    expect(rates.every((v) => v === null)).toBe(true);
    const rules = LINTEL_PRODUCTION_PRICING_RULES;
    expect([rules.manufacturingCost, rules.overheadPercent, rules.marginBasis, rules.marginPercent, rules.gstPercent, ...Object.values(rules.wastagePercent)].every((v) => v === null)).toBe(true);
  });
});
