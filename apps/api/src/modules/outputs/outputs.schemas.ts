import { z } from "zod";
import { OutputPurpose, Sha256Hash, Uuid } from "../../common/http/schemas.js";
import { Pins, ValidationMessage } from "../design-versions/design-versions.schemas.js";

/**
 * Output generation requests (Step 6 plan revision 4 §16). A request names only the purpose, the exact commercial
 * versions it wants (Pricing / Quotation) and, to reproduce an earlier output, exact upstream snapshots. It can never
 * carry quantities, prices, rates, tax, totals, hashes, engine fields, blocker counts, createdAt, or anything that
 * means "latest": the server resolves every dependency by exact natural identity.
 */
const Base = z.strictObject({ purpose: OutputPurpose.default("PRELIMINARY") });
export const BomGenerateRequest = Base.extend({ sources: z.strictObject({}).optional() });
export const BoqGenerateRequest = Base.extend({ sources: z.strictObject({ bomSnapshotId: Uuid.optional() }).optional() });
export const PricingGenerateRequest = Base.extend({
  pricingStandardVersionId: Uuid,
  sources: z.strictObject({ bomSnapshotId: Uuid.optional(), boqSnapshotId: Uuid.optional() }).optional(),
});
export const QuotationGenerateRequest = Base.extend({
  pricingStandardVersionId: Uuid,
  quotationPolicyVersionId: Uuid,
  sources: z.strictObject({ boqSnapshotId: Uuid.optional(), pricingSnapshotId: Uuid.optional() }).optional(),
});
/**
 * Drawings (plan §12.5): one endpoint, the six engine drawing types. Room drawings take the wall (elevation) or nothing
 * (schedule); cabinet drawings take the object's lineage id (the engine object id). The drawing number and revision
 * are part of the output's natural identity. Designer, checker, project, room and date come from records.
 */
const DrawingNumber = z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/, "1-40 characters of A-Z, 0-9 and -, starting with a letter or digit");
const DrawingRevision = z.string().regex(/^[A-Z0-9]{1,4}$/, "1-4 characters of A-Z and 0-9");
const DrawingBase = { purpose: OutputPurpose.default("PRELIMINARY"), drawingNumber: DrawingNumber, drawingRevision: DrawingRevision };
const ObjectLineageId = z.string().trim().min(1).max(128);
export const DrawingGenerateRequest = z.discriminatedUnion("drawingType", [
  z.strictObject({ ...DrawingBase, drawingType: z.literal("WALL_INTERNAL_ELEVATION"), wallId: z.enum(["A", "B", "C", "D"]) }),
  z.strictObject({ ...DrawingBase, drawingType: z.literal("ROOM_PANEL_SCHEDULE") }),
  z.strictObject({ ...DrawingBase, drawingType: z.enum(["FRONT_ELEVATION", "CABINET_INTERNAL_ELEVATION", "PANEL_SCHEDULE"]), objectLineageId: ObjectLineageId }),
  z.strictObject({ ...DrawingBase, drawingType: z.literal("SIDE_SECTION"), objectLineageId: ObjectLineageId, cutXMm: z.number().positive().max(10000).optional() }),
]);
export type DrawingGenerateRequest = z.infer<typeof DrawingGenerateRequest>;
export type GenerateRequest =
  | z.infer<typeof BomGenerateRequest> | z.infer<typeof BoqGenerateRequest> | z.infer<typeof PricingGenerateRequest> | z.infer<typeof QuotationGenerateRequest> | DrawingGenerateRequest;

export const SnapshotIdParam = z.strictObject({ snapshotId: Uuid });

const Kind = z.enum(["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING"]);
const DrawingType = z.enum(["WALL_INTERNAL_ELEVATION", "ROOM_PANEL_SCHEDULE", "FRONT_ELEVATION", "SIDE_SECTION", "CABINET_INTERNAL_ELEVATION", "PANEL_SCHEDULE"]);
/** One file of a drawing snapshot, in manifest order. */
export const SnapshotFileResponse = z.strictObject({
  sequence: z.number().int(), format: z.string(), sheetIndex: z.number().int().nullable(), fileId: Uuid, contentType: z.string(), byteSize: z.number().int(), checksum: Sha256Hash,
});
export type SnapshotFileResponse = z.infer<typeof SnapshotFileResponse>;
export const SnapshotFiles = z.strictObject({ items: z.array(SnapshotFileResponse) });
const StalenessReason = z.enum(["ENGINEERING_INPUTS_CHANGED", "DEPENDENCY_CONTENT_CHANGED", "COMMERCIAL_CONTENT_CHANGED", "ENGINE_CHANGED", "SOURCE_STALE"]);
const Newer = z.strictObject({ pin: z.string(), versionId: Uuid });
export const Staleness = z.strictObject({
  stale: z.boolean(),
  reasons: z.array(StalenessReason),
  advisories: z.strictObject({ designSuperseded: z.boolean(), newerSurveyAvailable: z.boolean(), newerDependencyVersions: z.array(Newer), newerCommercialVersions: z.array(Newer) }),
});
export const Engine = z.strictObject({
  name: z.string(), version: z.string(), build: z.string(), fingerprint: Sha256Hash,
  closure: z.strictObject({ packages: z.record(z.string(), Sha256Hash), externals: z.record(z.string(), z.string()), entry: Sha256Hash, runtime: z.string() }),
});
export const SnapshotSummary = z.strictObject({ kind: Kind, id: Uuid, purpose: OutputPurpose, contentHash: Sha256Hash });

/** Every generated output's provenance envelope (plan §16). The payload is the engine result verbatim. */
export const SnapshotEnvelope = z.strictObject({
  id: Uuid,
  kind: Kind,
  purpose: OutputPurpose,
  designVersionId: Uuid,
  designVersionStatus: z.string(),
  designVersionContentHash: Sha256Hash,
  input: z.strictObject({ hash: Sha256Hash, revision: z.number().int() }),
  engineeringPins: Pins,
  commercial: z.strictObject({ pricingStandardVersionId: Uuid, quotationPolicyVersionId: Uuid.nullable(), inputHash: Sha256Hash }).nullable(),
  dependencyHashes: z.record(z.string(), Sha256Hash),
  dependencySetHash: Sha256Hash,
  validationRun: z.strictObject({ id: Uuid, purpose: z.literal("OUTPUT_GENERATION"), blockerCount: z.number().int(), warningCount: z.number().int(), engine: Engine }),
  sources: z.strictObject({ bomSnapshotId: Uuid.optional(), boqSnapshotId: Uuid.optional(), pricingSnapshotId: Uuid.optional() }),
  engine: Engine.extend({ seal: z.string().nullable() }),
  contentHash: Sha256Hash,
  blockerCount: z.number().int(),
  warningCount: z.number().int(),
  outputComplete: z.boolean(),
  dataClassification: z.literal("PRODUCTION"),
  qualifiesForIssue: z.boolean(),
  qualifiesForRelease: z.boolean(),
  revisionNumber: z.number().int().optional(),
  drawing: z.strictObject({
    drawingType: DrawingType, scope: z.enum(["ROOM", "OBJECT"]), wallId: z.enum(["A", "B", "C", "D"]).nullable(), objectLineageId: z.string().nullable(), cutXMm: z.number().nullable(),
    drawingNumber: z.string(), drawingRevision: z.string(), fileManifestHash: Sha256Hash, files: z.array(SnapshotFileResponse),
  }).optional(),
  staleness: Staleness,
  createdBy: Uuid,
  createdAt: z.string(),
});
export type SnapshotEnvelope = z.infer<typeof SnapshotEnvelope>;
/** Payload: the engine output type (RoomBOM, RoomBOQ, RoomPriceSnapshot, QuotationSnapshot). Zod mirrors come with OpenAPI (checkpoint 3). */
export const Snapshot = SnapshotEnvelope.extend({ payload: z.unknown() });
export type Snapshot = z.infer<typeof Snapshot>;

export const GenerateResponse = z.strictObject({ status: z.literal("AVAILABLE"), snapshot: Snapshot, reused: z.boolean(), dependencies: z.array(SnapshotSummary) });
export const UnavailableResponse = z.strictObject({ status: z.literal("UNAVAILABLE"), kind: Kind, blockers: z.array(ValidationMessage), snapshot: z.null(), dependencies: z.array(SnapshotSummary) });

/** A design version's outputs graph (no payloads): readable snapshots, OUTPUT_GENERATION runs and the edges. */
export const OutputsGraph = z.strictObject({
  designVersionId: Uuid,
  designVersionStatus: z.string(),
  nodes: z.array(SnapshotEnvelope),
  validationRuns: z.array(z.strictObject({
    id: Uuid, inputHash: Sha256Hash, inputRevision: z.number().int(), blockerCount: z.number().int(), warningCount: z.number().int(),
    engine: z.strictObject({ name: z.string(), version: z.string(), build: z.string(), fingerprint: Sha256Hash }), createdAt: z.string(),
  })),
  edges: z.array(z.union([
    z.strictObject({ from: Uuid, to: Uuid, relation: z.literal("SOURCE"), source: z.string() }),
    z.strictObject({ from: Uuid, to: Uuid, relation: z.literal("EVIDENCE") }),
  ])),
  hiddenKinds: z.array(Kind),
});

/** Files: a short-lived signed URL (never persisted). */
export const FileIdParam = z.strictObject({ fileId: Uuid });
export const FileUrlQuery = z.strictObject({ disposition: z.enum(["inline", "attachment"]).default("attachment") });
export const FileUrlResponse = z.strictObject({
  fileId: Uuid, url: z.url(), expiresAt: z.string(), expiresInSeconds: z.number().int(), contentType: z.string(), byteSize: z.number().int(), checksum: Sha256Hash,
});

export const DetailedStaleness = Staleness.extend({
  /** Engine comparators on the current model (compareRoomTrace / checkQuotationStaleness). */
  model: z.strictObject({ stale: z.boolean(), reasons: z.array(z.string()), changedObjectIds: z.array(z.string()) }),
});
