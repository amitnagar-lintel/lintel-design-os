/**
 * M5 Step 7 — room pricing (priceRoom) and quotation from an exact room pricing (quoteRoom). TEST_FIXTURE data only.
 * quoteRoom(priceRoom(x)) must be exactly priceQuotation(x): the output API consumes a stored pricing snapshot and
 * never re-prices it.
 */
import { describe, expect, it } from "vitest";
import type { RoomPriceSnapshot } from "@lintel/types";
import { LINTEL_CATALOG } from "@lintel/catalog-engine";
import {
  LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_RATE_CARD, QUOTATION_ENGINE_VERSION, TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_QUOTATION_POLICY, TEST_FIXTURE_RATE_CARD,
  priceCabinet, priceRoom, quoteRoom, verifyRoomPricing,
} from "@lintel/pricing-engine";
import type { RoomPricingResult } from "@lintel/pricing-engine";
import { BOM_ENGINE_VERSION } from "@lintel/bom-engine";
import { BOQ_ENGINE_VERSION } from "@lintel/boq-engine";
import { cabinet, fixtureRoom, lLayout, productionRoom } from "./support/room.js";
import { QUOTED_AT, quote, quoted, roomCommercials } from "./support/quotation.js";

const priced = (r: RoomPricingResult): RoomPriceSnapshot => {
  if (r.status !== "PRICED") throw new Error(`expected PRICED: ${r.blockers.map((b) => b.code).join(", ")}`);
  return r.snapshot;
};
const price = (room = fixtureRoom()) => {
  const { roomBom, roomBoq } = roomCommercials(room);
  return { room, roomBom, roomBoq, result: priceRoom({ mode: "TEST_FIXTURE", room, roomBom, roomBoq, rateCard: TEST_FIXTURE_RATE_CARD, rules: TEST_FIXTURE_PRICING_RULES, createdAt: QUOTED_AT }) };
};
const quoteFrom = (room: ReturnType<typeof fixtureRoom>, roomBoq: ReturnType<typeof roomCommercials>["roomBoq"], pricing: RoomPriceSnapshot) =>
  quoteRoom({ mode: "TEST_FIXTURE", room, roomBoq, pricing, policy: TEST_FIXTURE_QUOTATION_POLICY, catalog: LINTEL_CATALOG, revision: "A", createdAt: QUOTED_AT });

describe("engine versions", () => {
  it("BOM, BOQ and quotation engines have semantic versions", () => {
    expect([BOM_ENGINE_VERSION, BOQ_ENGINE_VERSION, QUOTATION_ENGINE_VERSION]).toEqual(["0.1.0", "0.1.0", "0.1.0"]);
  });
});

describe("priceRoom", () => {
  it("prices every object with priceCabinet, in room order, and the room totals are the exact sum of the object totals", () => {
    const { room, roomBom, roomBoq, result } = price();
    const p = priced(result);
    expect(p.priceSnapshots.map((s) => s.trace.objectId)).toEqual(room.cabinets.map((c) => c.object.objectId));
    room.cabinets.forEach((c, i) => {
      const alone = priceCabinet({ mode: "TEST_FIXTURE", resolved: c, bom: roomBom.objectBoms[i] as never, boq: roomBoq.objectBoqs[i] as never, rateCard: TEST_FIXTURE_RATE_CARD, rules: TEST_FIXTURE_PRICING_RULES, createdAt: QUOTED_AT });
      expect(alone.status === "PRICED" ? alone.snapshot : null).toEqual(p.priceSnapshots[i]);
    });
    for (const k of Object.keys(p.totals) as (keyof typeof p.totals)[]) expect(p.totals[k]).toBe(p.priceSnapshots.reduce((a, s) => a + s.totals[k], 0));
    expect([p.roomFingerprint, p.roomBomId, p.roomBoqId]).toEqual([room.roomFingerprint, roomBom.roomBomId, roomBoq.roomBoqId]);
    expect(verifyRoomPricing(p)).toBe(true);
    expect(result.status === "PRICED" ? result.messages.map((m) => m.code) : []).toEqual(["PRICE_IS_TEST_FIXTURE"]);
  });
  it("is deterministic and sealed: a tampered room pricing or object price fails verification", () => {
    const a = priced(price().result);
    expect(priced(price().result)).toEqual(a);
    expect(verifyRoomPricing({ ...a, totals: { ...a.totals, sellingPriceExGst: a.totals.sellingPriceExGst + 1 } })).toBe(false);
    const s0 = a.priceSnapshots[0];
    if (s0 === undefined) throw new Error("fixture");
    expect(verifyRoomPricing({ ...a, priceSnapshots: [{ ...s0, totals: { ...s0.totals, margin: s0.totals.margin + 1 } }, ...a.priceSnapshots.slice(1)] })).toBe(false);
  });
  it("PRODUCTION mode with the real (NULL) Lintel rate card and rules is UNAVAILABLE with structured blockers — nothing priced at zero", () => {
    const room = productionRoom();
    const { roomBom, roomBoq } = roomCommercials(room);
    const r = priceRoom({ mode: "PRODUCTION", room, roomBom, roomBoq, rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES, createdAt: QUOTED_AT });
    expect(r.status).toBe("UNAVAILABLE");
    const codes = r.status === "UNAVAILABLE" ? new Set(r.blockers.map((b) => b.code)) : new Set();
    for (const c of ["PRICING_RATE_CARD_NOT_APPROVED", "PRICING_RULES_NOT_APPROVED", "PRICING_DESIGN_BLOCKED"]) expect([c, codes.has(c)]).toEqual([c, true]);
    expect(r.status === "UNAVAILABLE" && r.blockers.every((b) => b.severity === "BLOCKER" && b.sourceObjectId !== undefined)).toBe(true);
  });
  it("refuses a BOM / BOQ of another room model and an empty room", () => {
    const { room, roomBoq } = price();
    const other = roomCommercials(fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 0 })]));
    const r = priceRoom({ mode: "TEST_FIXTURE", room, roomBom: other.roomBom, roomBoq, rateCard: TEST_FIXTURE_RATE_CARD, rules: TEST_FIXTURE_PRICING_RULES, createdAt: QUOTED_AT });
    expect(r.status === "UNAVAILABLE" ? r.blockers.map((b) => b.code) : []).toContain("PRICING_TRACE_MISMATCH");
    const empty = fixtureRoom([]);
    const e = roomCommercials(empty);
    const re = priceRoom({ mode: "TEST_FIXTURE", room: empty, roomBom: e.roomBom, roomBoq: e.roomBoq, rateCard: TEST_FIXTURE_RATE_CARD, rules: TEST_FIXTURE_PRICING_RULES, createdAt: QUOTED_AT });
    expect(re.status === "UNAVAILABLE" ? re.blockers.map((b) => b.code) : []).toContain("PRICING_EMPTY_ROOM");
  });
});

describe("quoteRoom consumes an exact room pricing and never re-prices", () => {
  it("quoteRoom(priceRoom(x)) is exactly priceQuotation(x)", () => {
    const { room, roomBoq, result } = price();
    expect(quoted(quoteFrom(room, roomBoq, priced(result)))).toEqual(quoted(quote(room)));
  });
  it("works from a pricing read back from storage (JSON round trip), with identical content", () => {
    const { room, roomBoq, result } = price();
    const stored = JSON.parse(JSON.stringify(priced(result))) as RoomPriceSnapshot;
    expect(verifyRoomPricing(stored)).toBe(true);
    expect(quoted(quoteFrom(room, roomBoq, stored))).toEqual(quoted(quote(room)));
  });
  it("the quotation lines carry the exact price snapshots of the pricing", () => {
    const { room, roomBoq, result } = price();
    const p = priced(result);
    const q = quoted(quoteFrom(room, roomBoq, p));
    expect(q.priceSnapshots).toEqual(p.priceSnapshots);
    expect(q.lines.map((l) => l.priceSnapshotHash)).toEqual(p.priceSnapshots.map((s) => s.contentHash));
    expect([q.rateCardRef, q.pricingRulesRef, q.roomBomId]).toEqual([p.rateCardRef, p.pricingRulesRef, p.roomBomId]);
  });
  it("refuses a tampered pricing, a pricing of another room model, or another classification", () => {
    const { room, roomBoq, result } = price();
    const p = priced(result);
    const codes = (r: ReturnType<typeof quoteRoom>) => (r.status === "UNAVAILABLE" ? r.blockers.map((b) => b.code) : []);
    expect(codes(quoteFrom(room, roomBoq, { ...p, totals: { ...p.totals, gst: 0 } }))).toContain("QUOTATION_PRICING_INVALID");
    const moved = fixtureRoom(lLayout().slice(0, 3));
    expect(codes(quoteFrom(moved, roomCommercials(moved).roomBoq, p))).toContain("QUOTATION_TRACE_MISMATCH");
    expect(codes(quoteRoom({ mode: "PRODUCTION", room, roomBoq, pricing: p, policy: TEST_FIXTURE_QUOTATION_POLICY, catalog: LINTEL_CATALOG, revision: "A", createdAt: QUOTED_AT })))
      .toContain("QUOTATION_CLASSIFICATION_MISMATCH");
  });
});
