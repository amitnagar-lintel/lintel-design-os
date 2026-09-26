import { z } from "zod";
import { Millimetres, PositiveMillimetres } from "../../common/http/measures.js";
import { LifecycleStatus, Reason, Sha256Hash, TransitionAction, Uuid } from "../../common/http/schemas.js";

/** The 12 exact pins (M5 §2.3). Required pins are never null; manufacturing, pricing, quotation policy and appliance may be. */
export const REQUIRED_PINS = [
  "constructionStandardVersionId", "planningStandardVersionId", "edgeBandStandardVersionId", "materialCatalogVersionId",
  "finishCatalogVersionId", "hardwareCatalogVersionId", "productCatalogVersionId", "hettichDatasetVersionId",
] as const;
export const OPTIONAL_PINS = ["manufacturingStandardVersionId", "pricingStandardVersionId", "quotationPolicyVersionId", "applianceCatalogVersionId"] as const;
export type PinName = (typeof REQUIRED_PINS)[number] | (typeof OPTIONAL_PINS)[number];

export const PinsInput = z.strictObject({
  constructionStandardVersionId: Uuid.optional(),
  planningStandardVersionId: Uuid.optional(),
  edgeBandStandardVersionId: Uuid.optional(),
  materialCatalogVersionId: Uuid.optional(),
  finishCatalogVersionId: Uuid.optional(),
  hardwareCatalogVersionId: Uuid.optional(),
  productCatalogVersionId: Uuid.optional(),
  hettichDatasetVersionId: Uuid.optional(),
  manufacturingStandardVersionId: Uuid.nullable().optional(),
  pricingStandardVersionId: Uuid.nullable().optional(),
  quotationPolicyVersionId: Uuid.nullable().optional(),
  applianceCatalogVersionId: Uuid.nullable().optional(),
});
export type PinsInput = z.infer<typeof PinsInput>;
export const Pins = z.strictObject(Object.fromEntries([...REQUIRED_PINS.map((p) => [p, Uuid]), ...OPTIONAL_PINS.map((p) => [p, Uuid.nullable()])]) as Record<PinName, z.ZodType<string | null>>);
export type Pins = Readonly<Record<PinName, string | null>>;

const Label = z.string().trim().min(1).max(100).nullable();
const Source = z.string().trim().min(1).max(200);

/**
 * A new DesignVersion. With `basedOnVersionId` it copies that version's pins, room revision, objects (same lineage)
 * and override history; any given pin / room revision replaces the copied one. Without it, every required pin is needed.
 */
export const VersionCreate = z.strictObject({
  basedOnVersionId: Uuid.optional(),
  roomRevisionId: Uuid.optional(),
  pins: PinsInput.optional(),
  versionLabel: Label.optional(),
  changeReason: Reason,
  source: Source.optional(),
});
export type VersionCreate = z.infer<typeof VersionCreate>;

/** Draft metadata / room revision / pins. Never the lifecycle: status changes only through /transitions. */
export const VersionUpdate = z.strictObject({ roomRevisionId: Uuid.optional(), pins: PinsInput.optional(), versionLabel: Label.optional(), changeReason: Reason.optional(), source: Source.optional() })
  .refine((o) => Object.keys(o).length > 0, "at least one field");
export type VersionUpdate = z.infer<typeof VersionUpdate>;

export const TransitionRequest = z.strictObject({ action: TransitionAction, reason: Reason, expectedContentHash: Sha256Hash.optional() })
  .refine((o) => o.action !== "APPROVE" || o.expectedContentHash !== undefined, { message: "APPROVE requires expectedContentHash (the content you reviewed)", path: ["expectedContentHash"] });
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const VersionId = z.strictObject({ versionId: Uuid });
export const DesignIdParam = z.strictObject({ designId: Uuid });

export const ValidationSummary = z.strictObject({ runId: Uuid, current: z.boolean(), blockerCount: z.number().int(), warningCount: z.number().int(), validatedAt: z.string() });
export const VersionResponse = z.strictObject({
  id: Uuid, designId: Uuid, projectId: Uuid, versionNumber: z.number().int(), versionLabel: z.string().nullable(), status: LifecycleStatus,
  basedOnVersionId: Uuid.nullable(), roomRevisionId: Uuid, pins: Pins, authoredEngineVersion: z.string(),
  inputHash: Sha256Hash, inputRevision: z.number().int(), contentHash: Sha256Hash, rowVersion: z.number().int(),
  source: z.string(), changeReason: z.string(),
  createdBy: Uuid, createdAt: z.string(), submittedBy: Uuid.nullable(), submittedAt: z.string().nullable(), approvedBy: Uuid.nullable(), approvedAt: z.string().nullable(),
  effectiveFrom: z.string().nullable(), lockedBy: Uuid.nullable(), lockedAt: z.string().nullable(), supersededBy: Uuid.nullable(), supersededAt: z.string().nullable(),
  validation: ValidationSummary.nullable(),
});
export type VersionResponse = z.infer<typeof VersionResponse>;

/** The parent version state returned with every draft-content write (its ETag guards the whole draft). */
export const VersionState = z.strictObject({ id: Uuid, etag: z.string(), rowVersion: z.number().int(), inputHash: Sha256Hash, inputRevision: z.number().int(), contentHash: Sha256Hash });
export type VersionState = z.infer<typeof VersionState>;

/* ------------------------------------------------------------ objects */

export const ObjectInput = z.strictObject({
  objectCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, "1-64 characters: letters, digits, _ . -"),
  /** Stable identity across design versions (the engine objectId). Generated when absent; never changes. */
  lineageId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/).optional(),
  objectType: z.literal("BASE_CABINET"),
  productCode: z.string().trim().min(1).max(100),
  /** The exact product VERSION; it must belong to the version's pinned product catalog. */
  productVersionId: Uuid,
  position: z.strictObject({ xMm: Millimetres, yMm: Millimetres, zMm: Millimetres }),
  /** Quarter turns about the vertical axis only. */
  rotationY: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  dimensions: z.strictObject({ widthMm: PositiveMillimetres, heightMm: PositiveMillimetres, depthMm: PositiveMillimetres }),
  parameters: z.record(z.string().min(1).max(64), z.union([z.number(), z.string().max(200)])).refine((o) => Object.keys(o).length <= 50, "at most 50 parameters").default({}),
});
export type ObjectInput = z.infer<typeof ObjectInput>;
/** objectCode, lineageId and objectType are immutable; productCode and productVersionId change together. */
export const ObjectUpdate = z.strictObject({
  product: z.strictObject({ productCode: z.string().trim().min(1).max(100), productVersionId: Uuid }).optional(),
  position: ObjectInput.shape.position.optional(),
  rotationY: ObjectInput.shape.rotationY.optional(),
  dimensions: ObjectInput.shape.dimensions.optional(),
  parameters: z.record(z.string().min(1).max(64), z.union([z.number(), z.string().max(200)])).refine((o) => Object.keys(o).length <= 50, "at most 50 parameters").optional(),
}).refine((o) => Object.keys(o).length > 0, "at least one field");
export type ObjectUpdate = z.infer<typeof ObjectUpdate>;
export const ObjectId = z.strictObject({ objectId: Uuid });
export const ObjectResponse = z.strictObject({
  id: Uuid, designVersionId: Uuid, objectCode: z.string(), lineageId: z.string(), objectType: z.literal("BASE_CABINET"), productCode: z.string(), productVersionId: Uuid,
  position: z.strictObject({ xMm: z.number(), yMm: z.number(), zMm: z.number() }), rotationY: z.number().int(),
  dimensions: z.strictObject({ widthMm: z.number(), heightMm: z.number(), depthMm: z.number() }), parameters: z.record(z.string(), z.union([z.number(), z.string()])),
  status: z.enum(["DRAFT", "APPROVED"]),
});
export type ObjectResponse = z.infer<typeof ObjectResponse>;

/* ------------------------------------------------------------ relationship overrides */

export const OverrideKind = z.enum(["INTENTIONAL_GAP", "FILLER", "END_PANEL", "SHARED_SIDE", "SPECIAL_CORNER"]);
/** Each POST appends a new version of the override (history is kept and audited). objectIds are lineage ids. */
export const OverrideCreate = z.strictObject({
  overrideCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
  kind: OverrideKind,
  objectIds: z.array(z.string().min(1).max(128)).min(1).max(20),
  reason: Reason,
});
export type OverrideCreate = z.infer<typeof OverrideCreate>;
export const OverrideParams = z.strictObject({ versionId: Uuid, overrideCode: z.string().min(1).max(64) });
export const OverrideResponse = z.strictObject({ overrideCode: z.string(), version: z.number().int(), kind: OverrideKind, objectIds: z.array(z.string()), reason: z.string(), createdBy: Uuid, createdAt: z.string() });
export type OverrideResponse = z.infer<typeof OverrideResponse>;

/* ------------------------------------------------------------ validation */

/** Runs the engine on the version's current exact inputs. The body is empty: counts always come from the engine. */
export const ValidationRequest = z.strictObject({});
export const RunId = z.strictObject({ runId: Uuid });
export const ValidationMessage = z.strictObject({ code: z.string(), severity: z.string(), message: z.string() }).catchall(z.unknown());
export const ValidationRunResponse = z.strictObject({
  id: Uuid, designVersionId: Uuid, inputHash: Sha256Hash, inputRevision: z.number().int(), engineVersion: z.string(), engineBuild: z.string().nullable(), engineHash: z.string(), contentHash: Sha256Hash,
  blockerCount: z.number().int(), warningCount: z.number().int(), canApprove: z.boolean(), current: z.boolean(), messages: z.array(ValidationMessage),
  createdBy: Uuid, createdAt: z.string(),
});
export type ValidationRunResponse = z.infer<typeof ValidationRunResponse>;
