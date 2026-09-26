/** M4 commit 2 — combined BOM, BOQ and quotation (TEST_FIXTURE data). */
import { describe, expect, it } from "vitest";
import type { QuotationPolicy } from "@lintel/types";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_RATE_CARD, TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_QUOTATION_POLICY, checkQuotationStaleness, verifyQuotation } from "@lintel/pricing-engine";
import { cabinet, fixtureRoom, lLayout, productionRoom } from "./support/room.js";
import { quote, quoted, roomCommercials } from "./support/quotation.js";

const codes = (r: ReturnType<typeof quote>): string[] => (r.status === "UNAVAILABLE" ? r.blockers.map((b) => b.code) : []);

describe("room BOM", () => {
  const room = fixtureRoom();
  const { roomBom } = roomCommercials(room);
  it("keeps every object BOM intact, in room order", () => {
    expect(roomBom.objectBoms.map((b) => b.trace.objectId)).toEqual(["obj_001", "obj_002", "obj_003", "obj_004"]);
    expect(roomBom.incomplete).toBe(false);
  });
  it("room totals equal the sum of object BOM lines and trace to them", () => {
    for (const t of roomBom.totals) {
      const sources = roomBom.objectBoms.flatMap((b) => b.items).filter((i) => t.sourceBomItemIds.includes(i.bomItemId));
      expect(sources).toHaveLength(t.sourceBomItemIds.length);
      const sum = sources.reduce((a, i) => a + i.quantity, 0);
      expect(t.quantity).toBeCloseTo(sum, 6);
    }
    const hinges = roomBom.totals.find((t) => t.key === "HETTICH:FIXTURE-HINGE-FO-A");
    expect(hinges?.quantity).toBe(16); // 4 cabinets × 2 shutters × 2 hinges
  });
});

describe("room BOQ", () => {
  it("has one line per object, each linked to its object BOM, and links to the room BOM", () => {
    const { roomBom, roomBoq } = roomCommercials(fixtureRoom());
    expect(roomBoq.items.map((i) => i.description)).toEqual(["600 Base Cabinet", "750 Base Cabinet", "600 Base Cabinet", "600 Base Cabinet"]);
    expect(roomBoq.items.map((i) => i.linkedBomId)).toEqual(roomBom.objectBoms.map((b) => b.bomId));
    expect(roomBoq.roomBomId).toBe(roomBom.roomBomId);
  });
});

describe("TEST_FIXTURE quotation (tax on rate-group total)", () => {
  const room = fixtureRoom();
  const q = quoted(quote(room));
  it("prices every object with its own immutable price snapshot", () => {
    expect(q.lines.map((l) => [l.lineNo, l.objectCode, l.taxRateId, l.taxPercent, l.lineTax])).toEqual([
      [1, "OBJ-KIT-001", "TEST_RATE_18", 18, null],
      [2, "OBJ-KIT-002", "TEST_RATE_18", 18, null],
      [3, "OBJ-KIT-003", "TEST_RATE_18", 18, null],
      [4, "OBJ-KIT-004", "TEST_RATE_18", 18, null],
    ]);
    expect(q.lines[0]?.taxableAmount).toBe(878416); // = M2 reference cabinet price ex GST
    q.lines.forEach((l, i) => {
      expect(l.priceSnapshotHash).toBe(q.priceSnapshots[i]?.contentHash);
      expect(l.taxableAmount).toBe(q.priceSnapshots[i]?.totals.sellingPriceExGst);
    });
  });
  it("aggregates by tax rate, computes tax once per group, then rounds the grand total", () => {
    const taxable = q.lines.reduce((a, l) => a + l.taxableAmount, 0);
    const tax = Math.floor((taxable * 18 + 50) / 100); // half up, independent check
    expect(q.taxGroups).toEqual([{ taxRateId: "TEST_RATE_18", percent: 18, taxableAmount: taxable, taxAmount: tax, lineNos: [1, 2, 3, 4] }]);
    const before = taxable + tax;
    const grand = Math.floor((before + 50) / 100) * 100;
    expect(q.totals).toEqual({ taxableAmount: taxable, discountAmount: 0, taxAmount: tax, totalBeforeRounding: before, roundingAdjustment: grand - before, grandTotal: grand });
    expect(Math.abs(q.totals.roundingAdjustment)).toBeLessThanOrEqual(50);
  });
  it("PER_LINE policy rounds tax per line (alternative policy, same engine)", () => {
    const perLine: QuotationPolicy = { ...TEST_FIXTURE_QUOTATION_POLICY, taxPolicy: "PER_LINE" };
    const s = quoted(quote(room, { policy: perLine }));
    expect(s.lines.every((l) => l.lineTax !== null)).toBe(true);
    expect(s.taxGroups[0]?.taxAmount).toBe(s.lines.reduce((a, l) => a + (l.lineTax ?? 0), 0));
  });
  it("is sealed, frozen, deterministic and embeds the policy and snapshots", () => {
    expect(verifyQuotation(q)).toBe(true);
    expect(Object.isFrozen(q.totals)).toBe(true);
    const copy = structuredClone(q);
    (copy.totals as { grandTotal: number }).grandTotal += 100;
    expect(verifyQuotation(copy)).toBe(false);
    expect(quoted(quote(fixtureRoom([...lLayout()].reverse())))).toEqual(q);
    expect(q.policyRef).toEqual({ id: "TEST_FIXTURE_QUOTATION_POLICY", version: "0.0.1", status: "TEST_FIXTURE" });
    expect(q.quotationId).toBe("QUO:dv_001:room_001:RA");
  });
  it("detects exactly which object made it stale", () => {
    expect(checkQuotationStaleness(q, room)).toEqual({ stale: false, reasons: [], changedObjectIds: [] });
    const changed = fixtureRoom(lLayout().map((o) => (o.objectCode === "OBJ-KIT-002" ? cabinet("OBJ-KIT-002", 750, { x: 600 }, { material: "BOARD_HDHMR_18" }) : o)));
    expect(checkQuotationStaleness(q, changed)).toMatchObject({ stale: true, changedObjectIds: ["obj_002"], reasons: ["Object changed: OBJ-KIT-002"] });
    const removed = fixtureRoom(lLayout().filter((o) => o.objectCode !== "OBJ-KIT-004"));
    expect(checkQuotationStaleness(q, removed).reasons).toContain("Object removed: OBJ-KIT-004");
    const moved = fixtureRoom(lLayout().map((o) => (o.objectCode === "OBJ-KIT-004" ? cabinet("OBJ-KIT-004", 600, { x: 0, z: 1300, rotationY: 90 }) : o)));
    expect(checkQuotationStaleness(q, moved).reasons).toEqual(["Room layout changed (placement, planning standard or overrides)"]);
  });
});

describe("refusals", () => {
  it("NULL finance fields make the quotation unavailable", () => {
    const nulls: QuotationPolicy = { ...TEST_FIXTURE_QUOTATION_POLICY, taxPolicy: null, rounding: { tax: null, grandTotal: null }, discountPolicy: null, taxRates: { TEST_RATE_18: null } };
    expect(codes(quote(fixtureRoom(), { policy: nulls }))).toEqual(expect.arrayContaining(["QUOTATION_POLICY_UNVERIFIED", "QUOTATION_TAX_RATE_UNVERIFIED"]));
  });
  it("a tax rate that disagrees with the pricing rules is refused", () => {
    const other: QuotationPolicy = { ...TEST_FIXTURE_QUOTATION_POLICY, taxRates: { TEST_RATE_18: 12 } };
    expect(codes(quote(fixtureRoom(), { policy: other }))).toContain("QUOTATION_TAX_RATE_CONFLICT");
  });
  it("classifications are never mixed", () => {
    expect(codes(quote(fixtureRoom(), { policy: LINTEL_PRODUCTION_QUOTATION_POLICY }))).toContain("QUOTATION_CLASSIFICATION_MISMATCH");
    expect(codes(quote(fixtureRoom(), { mode: "PRODUCTION", rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES, policy: LINTEL_PRODUCTION_QUOTATION_POLICY }))).toContain("QUOTATION_TEST_FIXTURE_DESIGN_DATA");
  });
  it("a blocked object blocks the whole quotation (nothing priced at zero)", () => {
    const withBad = [...lLayout(), cabinet("OBJ-KIT-005", 600, { x: 1950 }, { material: "NOT_A_MATERIAL" })];
    expect(codes(quote(fixtureRoom(withBad)))).toContain("PRICING_BOM_INCOMPLETE");
  });
  it("PRODUCTION quotation is unavailable until finance, pricing and design data are approved", () => {
    const r = quote(productionRoom(), { mode: "PRODUCTION", rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES, policy: LINTEL_PRODUCTION_QUOTATION_POLICY });
    expect(r.status).toBe("UNAVAILABLE");
    expect(codes(r)).toEqual(expect.arrayContaining(["QUOTATION_POLICY_NOT_APPROVED", "QUOTATION_ROOM_BLOCKED", "QUOTATION_POLICY_UNVERIFIED", "QUOTATION_TAX_RATE_UNVERIFIED", "PRICING_RATE_CARD_NOT_APPROVED", "PRICING_BOM_INCOMPLETE"]));
  });
  it("uses TEST_FIXTURE pricing rules with the same rate as the fixture policy", () => {
    expect(TEST_FIXTURE_PRICING_RULES.gstPercent).toBe(TEST_FIXTURE_QUOTATION_POLICY.taxRates.TEST_RATE_18);
  });
});
