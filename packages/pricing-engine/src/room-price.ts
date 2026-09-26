import type {
  DataClassification, PriceSnapshot, PriceTotals, PricingRuleSet, RateCard, ResolvedRoom, RoomBOM, RoomBOQ, RoomPriceSnapshot, ValidationMessage,
} from "@lintel/types";
import { deepFreeze, hash53, stableStringify } from "@lintel/types";
import { buildValidationResult } from "@lintel/rules-engine";
import { toSafeNumber } from "./money.js";
import { priceCabinet, verifyPriceSnapshot } from "./price.js";

export interface PriceRoomInput {
  readonly mode: DataClassification;
  readonly room: ResolvedRoom;
  readonly roomBom: RoomBOM;
  readonly roomBoq: RoomBOQ;
  readonly rateCard: RateCard;
  readonly rules: PricingRuleSet;
  /** Supplied by the caller (ISO timestamp). */
  readonly createdAt: string;
}

export type RoomPricingResult =
  | { readonly status: "PRICED"; readonly snapshot: RoomPriceSnapshot; readonly messages: readonly ValidationMessage[] }
  | { readonly status: "UNAVAILABLE"; readonly classification: DataClassification; readonly blockers: readonly ValidationMessage[] };

const block = (code: string, message: string, path?: string): ValidationMessage => (path === undefined ? { code, severity: "BLOCKER", message } : { code, severity: "BLOCKER", message, path });

/**
 * Price every object of the room with `priceCabinet` (the M2 engine, unchanged), in room order. Per-object blockers
 * are prefixed with the object code and carry the object id. Shared by `priceRoom` and `priceQuotation`.
 */
export function priceCabinets(input: PriceRoomInput, missing: (objectCode: string) => ValidationMessage): { snapshots: PriceSnapshot[]; blockers: ValidationMessage[] } {
  const { mode, room, roomBom, roomBoq, rateCard, rules } = input;
  const snapshots: PriceSnapshot[] = [];
  const blockers: ValidationMessage[] = [];
  room.cabinets.forEach((c, i) => {
    const bom = roomBom.objectBoms[i];
    const boq = roomBoq.objectBoqs[i];
    if (bom === undefined || boq === undefined) {
      blockers.push(missing(c.object.objectCode));
      return;
    }
    const r = priceCabinet({ mode, resolved: c, bom, boq, rateCard, rules, createdAt: input.createdAt });
    if (r.status === "UNAVAILABLE") for (const b of r.blockers) blockers.push({ ...b, message: `${c.object.objectCode}: ${b.message}`, sourceObjectId: c.object.objectId });
    else snapshots.push(r.snapshot);
  });
  return { snapshots, blockers };
}

const TOTAL_KEYS: readonly (keyof PriceTotals)[] = [
  "material", "finish", "hardware", "manufacturing", "wastage", "directCost", "overhead", "totalCost", "margin", "sellingPriceExGst", "gst", "sellingPriceIncGst",
];

/**
 * Room pricing (M5 Step 7, OD-S6-4): every object priced by `priceCabinet` from the room's BOM (cost) and BOQ
 * (selling-price spread), with the room totals as the exact sum of the object totals. Nothing is priced at zero:
 * any object that cannot be priced makes the room UNAVAILABLE with every blocker. Pure; the caller supplies createdAt.
 */
export function priceRoom(input: PriceRoomInput): RoomPricingResult {
  const { mode, room, roomBom, roomBoq, rateCard, rules } = input;
  const blockers: ValidationMessage[] = [];
  if (roomBom.roomFingerprint !== room.roomFingerprint || roomBoq.roomFingerprint !== room.roomFingerprint || roomBoq.roomBomId !== roomBom.roomBomId) {
    blockers.push(block("PRICING_TRACE_MISMATCH", "Room BOM / BOQ were not derived from this room model", "room"));
  }
  if (room.cabinets.length === 0) blockers.push(block("PRICING_EMPTY_ROOM", "Room has no objects to price", "room"));
  const priced = priceCabinets(input, (code) => block("PRICING_TRACE_MISMATCH", `No BOM/BOQ for ${code}`));
  blockers.push(...priced.blockers);
  if (blockers.length > 0) return { status: "UNAVAILABLE", classification: mode, blockers: buildValidationResult(blockers).messages };

  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, toSafeNumber(priced.snapshots.reduce((a, s) => a + BigInt(s.totals[k]), 0n))])) as unknown as PriceTotals;
  const body: Omit<RoomPriceSnapshot, "contentHash"> = {
    roomPricingId: `PRICING:${room.trace.designVersionId}:${room.room.id}:${rateCard.rateCardId}@${rateCard.version}:${rules.ruleSetId}@${rules.version}`,
    classification: mode,
    currency: "INR",
    createdAt: input.createdAt,
    trace: JSON.parse(JSON.stringify(room.trace)) as RoomPriceSnapshot["trace"],
    roomFingerprint: room.roomFingerprint,
    roomBomId: roomBom.roomBomId,
    roomBoqId: roomBoq.roomBoqId,
    rateCardRef: { id: rateCard.rateCardId, version: rateCard.version, status: rateCard.status },
    pricingRulesRef: { id: rules.ruleSetId, version: rules.version, status: rules.status },
    priceSnapshots: priced.snapshots,
    totals,
  };
  const snapshot = deepFreeze({ ...body, contentHash: hash53(stableStringify(body)) });
  const messages: ValidationMessage[] =
    mode === "TEST_FIXTURE" ? [{ code: "PRICE_IS_TEST_FIXTURE", severity: "BLOCKER", message: "TEST_FIXTURE room pricing: synthetic rates and rules, never a production price" }] : [];
  return { status: "PRICED", snapshot, messages };
}

/** False when the room pricing (or any object price snapshot in it) no longer matches its seal. */
export function verifyRoomPricing(p: RoomPriceSnapshot): boolean {
  const { contentHash, ...body } = p;
  return hash53(stableStringify(body)) === contentHash && p.priceSnapshots.every(verifyPriceSnapshot);
}
