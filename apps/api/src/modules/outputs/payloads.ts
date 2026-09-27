import { z } from "zod";
import type { SnapshotRow } from "@lintel/persistence";
import { contentHash } from "@lintel/persistence";
import { verifyQuotation, verifyRoomPricing } from "@lintel/pricing-engine";
import { verifyDrawing, verifyRoomDrawing } from "@lintel/drawing-engine";
import type { Drawing, QuotationSnapshot, RoomBOM, RoomBOQ, RoomDrawing, RoomPriceSnapshot } from "@lintel/types";
import { deepFreeze } from "@lintel/types";
import { ApiProblem } from "../../common/errors/api-problem.js";
import type { OutputKind } from "./output-context.js";

/**
 * Runtime schemas of the stored output payloads (Step 6 plan §16): Zod mirrors of the engine output types. A stored
 * payload reaches another engine ONLY as `stored JSON → Zod schema → validated domain object → engine`, never through
 * a TypeScript cast; the content hash (and the engine seal where the payload has one) is verified as well — neither
 * check replaces the other. A compile-time equality assertion below fails the typecheck when a schema drifts from its
 * engine type.
 */

const str = z.string();
const num = z.number();
const int = z.number().int();
const paise = z.number().int().refine(Number.isSafeInteger, "paise must be a safe integer");
const strings = z.array(str);

const DataClassification = z.enum(["PRODUCTION", "TEST_FIXTURE"]);
const DataStatus = z.enum(["TEST_FIXTURE", "DRAFT", "APPROVED", "RETIRED"]);
const DesignState = z.enum(["DRAFT", "IN_REVIEW", "CHANGES_REQUIRED", "APPROVED", "LOCKED", "SUPERSEDED"]);
const VersionRef = z.strictObject({ id: str, version: str, status: DataStatus });

const HardwareDatasetRef = z.strictObject({ datasetId: str, classification: DataClassification, manufacturer: str, sourceVersion: str, authoritative: z.boolean() });
const TraceInfo = z.strictObject({
  engineVersion: str, dataClassification: DataClassification, testFixtureSources: strings, designVersionId: str, designVersionStatus: DesignState,
  objectId: str, product: VersionRef, recipe: VersionRef, standard: VersionRef, edgeBandStandard: VersionRef, catalogVersion: str,
  hardwareDatasets: z.array(HardwareDatasetRef),
});
const RoomTrace = z.strictObject({
  engineVersion: str, designVersionId: str, designVersionStatus: DesignState, projectId: str, roomId: str, dataClassification: DataClassification,
  testFixtureSources: strings, planningStandard: VersionRef, catalogVersion: str,
  objects: z.array(z.strictObject({ objectId: str, objectCode: str, modelFingerprint: str })),
  overrides: z.array(z.strictObject({ overrideId: str, version: int })),
});

/* ------------------------------------------------------------ BOM */

const BomBase = { bomItemId: str, description: str, quantity: num, unit: z.enum(["NOS", "M2", "M"]), sourceComponentIds: strings };
const BomItem = z.discriminatedUnion("kind", [
  z.strictObject({ ...BomBase, kind: z.literal("PANEL"), componentType: str, materialId: str, width: num, height: num, thickness: num, grainDirection: str }),
  z.strictObject({ ...BomBase, kind: z.literal("BOARD"), materialId: str, thickness: num, panelCount: int }),
  z.strictObject({ ...BomBase, kind: z.literal("EDGE_BAND"), edgeBandId: str }),
  z.strictObject({ ...BomBase, kind: z.literal("FINISH"), finishId: str }),
  z.strictObject({
    ...BomBase, kind: z.literal("HARDWARE"), status: z.enum(["RESOLVED", "UNRESOLVED"]), manufacturer: str, articleNumber: str.nullable(), category: str,
    sourceRequirementIds: strings, sourceVersion: str.nullable(),
  }),
  z.strictObject({ ...BomBase, kind: z.literal("APPLIANCE"), applianceId: str, manufacturer: str.nullable(), model: str.nullable() }),
]);
const Bom = z.strictObject({ bomId: str, trace: TraceInfo, items: z.array(BomItem), incomplete: z.boolean() });
export const RoomBomPayload = z.strictObject({
  roomBomId: str, trace: RoomTrace, roomFingerprint: str, objectBoms: z.array(Bom),
  totals: z.array(z.strictObject({
    lineId: str, kind: z.enum(["BOARD", "EDGE_BAND", "FINISH", "HARDWARE"]), key: str, description: str, quantity: num, unit: z.enum(["M2", "M", "NOS"]),
    status: z.enum(["RESOLVED", "UNRESOLVED"]), sourceBomItemIds: strings,
  })),
  incomplete: z.boolean(),
});

/* ------------------------------------------------------------ BOQ */

const BoqItem = z.strictObject({
  boqItemId: str, sourceObjectId: str, productId: str, itemCode: str, description: str, unit: z.literal("NOS"), quantity: num,
  measures: z.strictObject({ width: num, height: num, depth: num }), linkedBomId: str,
});
const Boq = z.strictObject({ boqId: str, trace: TraceInfo, items: z.array(BoqItem) });
export const RoomBoqPayload = z.strictObject({ roomBoqId: str, trace: RoomTrace, roomFingerprint: str, roomBomId: str, objectBoqs: z.array(Boq), items: z.array(BoqItem) });

/* ------------------------------------------------------------ pricing */

const Rate = num.nullable();
const RateCard = z.strictObject({
  rateCardId: str, version: str, status: DataStatus, classification: DataClassification, currency: z.literal("INR"), effectiveFrom: str.nullable(), source: str,
  boardPerM2: z.record(str, Rate), edgeBandPerM: z.record(str, Rate), finishPerM2: z.record(str, Rate), hardwarePerUnit: z.record(str, Rate),
});
const PricingRuleSet = z.strictObject({
  ruleSetId: str, version: str, status: DataStatus, classification: DataClassification, source: str, manufacturingCost: str.nullable(),
  wastagePercent: z.strictObject({ board: num.nullable(), edgeBand: num.nullable(), finish: num.nullable() }),
  overheadPercent: num.nullable(), marginBasis: z.enum(["MARKUP_ON_COST", "MARGIN_ON_PRICE"]).nullable(), marginPercent: num.nullable(), gstPercent: num.nullable(),
});
const PriceTotals = z.strictObject({
  material: paise, finish: paise, hardware: paise, manufacturing: paise, wastage: paise, directCost: paise, overhead: paise, totalCost: paise, margin: paise,
  sellingPriceExGst: paise, gst: paise, sellingPriceIncGst: paise,
});
const PriceSnapshot = z.strictObject({
  priceSnapshotId: str, classification: DataClassification, currency: z.literal("INR"), createdAt: str, trace: TraceInfo, modelFingerprint: str, bomId: str, boqId: str,
  rateCard: RateCard, rateCardRef: VersionRef, pricingRules: PricingRuleSet, pricingRulesRef: VersionRef,
  lines: z.array(z.strictObject({
    lineId: str, category: z.enum(["MATERIAL", "FINISH", "HARDWARE", "MANUFACTURING", "WASTAGE", "OVERHEAD", "MARGIN", "GST"]), description: str,
    sourceBomItemIds: strings, quantity: num, unit: z.enum(["M2", "M", "NOS", "PAISE", "LUMP"]), rate: num.nullable(), amount: paise,
  })),
  totals: PriceTotals,
  boqPrices: z.array(z.strictObject({ boqItemId: str, quantity: num, unitPriceExGst: paise, amountExGst: paise })),
  designBlockerCount: int,
  contentHash: str,
});
export const RoomPricingPayload = z.strictObject({
  roomPricingId: str, classification: DataClassification, currency: z.literal("INR"), createdAt: str, trace: RoomTrace, roomFingerprint: str, roomBomId: str, roomBoqId: str,
  rateCardRef: VersionRef, pricingRulesRef: VersionRef, priceSnapshots: z.array(PriceSnapshot), totals: PriceTotals, contentHash: str,
});

/* ------------------------------------------------------------ quotation */

const Rounding = z.strictObject({ mode: z.enum(["HALF_UP", "HALF_EVEN", "DOWN", "UP"]), incrementPaise: int }).nullable();
const QuotationPolicy = z.strictObject({
  policyId: str, version: str, status: DataStatus, classification: DataClassification, source: str,
  taxRates: z.record(str, num.nullable()), taxRateByProductCategory: z.record(str, str.nullable()), taxPolicy: z.enum(["PER_LINE", "PER_RATE_GROUP"]).nullable(),
  rounding: z.strictObject({ tax: Rounding, grandTotal: Rounding }), discountPolicy: z.strictObject({ mode: z.literal("NONE") }).nullable(),
});
export const QuotationPayload = z.strictObject({
  quotationId: str, revision: str, classification: DataClassification, currency: z.literal("INR"), createdAt: str, trace: RoomTrace, roomFingerprint: str,
  roomBomId: str, roomBoqId: str, policy: QuotationPolicy, policyRef: VersionRef, rateCardRef: VersionRef, pricingRulesRef: VersionRef,
  lines: z.array(z.strictObject({
    lineNo: int, lineId: str, boqItemId: str, objectId: str, objectCode: str, productId: str, description: str, quantity: num, unitPriceExGst: paise,
    taxableAmount: paise, taxRateId: str, taxPercent: num, lineTax: paise.nullable(), priceSnapshotId: str, priceSnapshotHash: str,
  })),
  taxGroups: z.array(z.strictObject({ taxRateId: str, percent: num, taxableAmount: paise, taxAmount: paise, lineNos: z.array(int) })),
  totals: z.strictObject({ taxableAmount: paise, discountAmount: paise, taxAmount: paise, totalBeforeRounding: paise, roundingAdjustment: paise, grandTotal: paise }),
  priceSnapshots: z.array(PriceSnapshot),
  contentHash: str,
});

/* ------------------------------------------------------------ drawings (cabinet and room) */

const Layer = z.enum(["BORDER", "TITLE_BLOCK", "VISIBLE", "HIDDEN", "DIMENSION", "ANNOTATION", "TABLE", "WATERMARK"]);
const Primitive = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line"), layer: Layer, x1: num, y1: num, x2: num, y2: num, dashed: z.boolean(), weight: z.enum(["THIN", "MEDIUM", "THICK"]) }),
  z.strictObject({ kind: z.literal("text"), layer: Layer, x: num, y: num, text: str, size: num, anchor: z.enum(["start", "middle", "end"]), bold: z.boolean(), rotate: num }),
]);
const Sheet = z.strictObject({ sheetNumber: int, paper: z.strictObject({ name: z.literal("A3"), width: num, height: num }), primitives: z.array(Primitive) });
const DrawingStatus = z.enum(["PRELIMINARY", "FOR_REVIEW", "FOR_PRODUCTION"]);
const TitleBlock = z.strictObject({
  projectId: str, projectCode: str, room: str, drawingNumber: str, drawingTitle: str, revision: str, date: str, designer: str, checker: str, scale: str,
  approvalStatus: DrawingStatus, sourceDesignVersionId: str, sourceDesignVersionStatus: DesignState, modelFingerprint: str, dataClassification: DataClassification,
});
const CabinetDrawing = z.strictObject({
  drawingId: str, type: z.enum(["FRONT_ELEVATION", "PANEL_SCHEDULE", "SIDE_SECTION", "CABINET_INTERNAL_ELEVATION"]), titleBlock: TitleBlock, status: DrawingStatus,
  watermark: str.nullable(), trace: TraceInfo, modelFingerprint: str, componentIds: strings, notes: strings, sheets: z.array(Sheet), contentHash: str,
});
const RoomDrawingPayload = z.strictObject({
  drawingId: str, type: z.enum(["WALL_INTERNAL_ELEVATION", "ROOM_PANEL_SCHEDULE"]), wallId: z.enum(["A", "B", "C", "D"]).nullable(), titleBlock: TitleBlock, status: DrawingStatus,
  watermark: str.nullable(), trace: RoomTrace, modelFingerprint: str, objectIds: strings, notes: strings, sheets: z.array(Sheet), contentHash: str,
});
export const DrawingPayload = z.union([CabinetDrawing, RoomDrawingPayload]);

/* ------------------------------------------------------------ drift guard (compile time) */

type DeepMutable<T> = T extends readonly (infer U)[] ? DeepMutable<U>[] : T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Each schema's output type must equal its engine type exactly (a `false` here is a typecheck error). */
export type PayloadSchemasMatchEngineTypes = [
  Same<z.infer<typeof RoomBomPayload>, DeepMutable<RoomBOM>>,
  Same<z.infer<typeof RoomBoqPayload>, DeepMutable<RoomBOQ>>,
  Same<z.infer<typeof RoomPricingPayload>, DeepMutable<RoomPriceSnapshot>>,
  Same<z.infer<typeof QuotationPayload>, DeepMutable<QuotationSnapshot>>,
  Same<z.infer<typeof CabinetDrawing>, DeepMutable<Drawing>>,
  Same<z.infer<typeof RoomDrawingPayload>, DeepMutable<RoomDrawing>>,
] extends [true, true, true, true, true, true] ? true : never;
export const PAYLOAD_SCHEMAS_MATCH_ENGINE_TYPES: PayloadSchemasMatchEngineTypes = true;

/* ------------------------------------------------------------ the only way from a stored row to an engine input */

export interface PayloadOf {
  readonly BOM: RoomBOM;
  readonly BOQ: RoomBOQ;
  readonly PRICING: RoomPriceSnapshot;
  readonly QUOTATION: QuotationSnapshot;
  readonly DRAWING: Drawing | RoomDrawing;
}
const SCHEMA: { readonly [K in OutputKind]: z.ZodType<DeepMutable<PayloadOf[K]>> } = {
  BOM: RoomBomPayload, BOQ: RoomBoqPayload, PRICING: RoomPricingPayload, QUOTATION: QuotationPayload, DRAWING: DrawingPayload,
};
/** The engine's own seal over its payload, where it has one (checked in addition to the content hash). */
const SEAL: { readonly [K in OutputKind]?: (p: PayloadOf[K]) => boolean } = {
  PRICING: verifyRoomPricing, QUOTATION: verifyQuotation, DRAWING: (d) => ("wallId" in d ? verifyRoomDrawing(d) : verifyDrawing(d)),
};

export class StoredPayloadError extends Error {
  constructor(readonly kind: OutputKind, readonly snapshotId: string, readonly reason: "SCHEMA" | "CONTENT_HASH" | "ENGINE_SEAL", readonly issues: readonly string[] = []) {
    super(`${kind} snapshot ${snapshotId}: stored payload failed ${reason === "SCHEMA" ? "schema validation" : reason === "CONTENT_HASH" ? "its content hash" : "its engine seal"}${issues.length > 0 ? ` (${issues.join("; ")})` : ""}`);
    this.name = "StoredPayloadError";
  }
}

/**
 * Stored payload → validated, frozen domain object. Throws StoredPayloadError when the JSON does not match the engine
 * type exactly (missing / extra field, wrong type, bad nested object, unknown enum value), when the payload no longer
 * matches the snapshot's content hash, or when the engine's own seal fails.
 */
export function parseStoredPayload<K extends OutputKind>(kind: K, row: Pick<SnapshotRow, "id" | "payload" | "content_hash">): PayloadOf[K] {
  const parsed = SCHEMA[kind].safeParse(row.payload);
  if (!parsed.success) throw new StoredPayloadError(kind, row.id, "SCHEMA", parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  // The same definition as verifySnapshotRecord: SHA-256 of the canonical payload.
  if (contentHash(parsed.data) !== row.content_hash) throw new StoredPayloadError(kind, row.id, "CONTENT_HASH");
  const value = parsed.data as PayloadOf[K];
  const seal = SEAL[kind] as ((p: PayloadOf[K]) => boolean) | undefined;
  if (seal !== undefined && !seal(value)) throw new StoredPayloadError(kind, row.id, "ENGINE_SEAL");
  return deepFreeze(value);
}

/** The API problem for a stored output that failed its checks (never passed on to an engine). */
export function storedPayloadProblem(e: StoredPayloadError): ApiProblem {
  return new ApiProblem("STORED_OUTPUT_INVALID", e.message, { context: { kind: e.kind, snapshotId: e.snapshotId, reason: e.reason } });
}
