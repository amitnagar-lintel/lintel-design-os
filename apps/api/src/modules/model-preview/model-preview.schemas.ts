import { z } from "zod";
import { LifecycleStatus, Sha256Hash, Uuid } from "../../common/http/schemas.js";

const Vec = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
/** Axis-aligned box: `min` corner and `size`, in millimetres. Room coordinates: x along wall A, z into the room, y up. */
export const Box = z.strictObject({ min: Vec, size: Vec });
const Severity = z.enum(["INFO", "WARNING", "ERROR", "BLOCKER"]);

export const ModelMessage = z.strictObject({
  code: z.string(), severity: Severity, message: z.string(),
  /** The object's lineage id (the engine's object identity), or null for room-level messages. */
  lineageId: Uuid.nullable(), componentId: z.string().nullable(), ruleId: z.string().nullable(), path: z.string().nullable(),
});
export type ModelMessage = z.infer<typeof ModelMessage>;
const Counts = z.strictObject({ INFO: z.number().int(), WARNING: z.number().int(), ERROR: z.number().int(), BLOCKER: z.number().int() });

export const ModelComponent = z.strictObject({
  componentId: z.string(),
  componentType: z.string(),
  /** Finished panel dimensions in the panel's face frame. */
  dimensions: z.strictObject({ width: z.number(), height: z.number(), thickness: z.number() }),
  /** Placed box in room coordinates. */
  box: Box,
  materialId: z.string(),
  finishId: z.string().nullable(),
  finishedFaces: z.number().int(),
  grainDirection: z.string(),
  /**
   * This component's own along-wall range (mm from the object's placement wall's left end), computed the exact
   * same way as the object's own `placement.alongWall` (`@lintel/geometry-engine`'s `wallFrame`/`relativeToWall`)
   * — never the object's placement wall's `box.min.x`, which only equals the along-wall coordinate for walls A/C
   * (for B/D the along-wall axis is `box.z`). Elevation renders every component from this field, whatever wall
   * it's on, instead of re-deriving (and risking re-deriving wrong) the room-axis-to-wall-axis mapping itself.
   * `null` only when the object itself has no placement (see the object's own `messages`).
   */
  alongWall: z.strictObject({ start: z.number(), end: z.number() }).nullable(),
});

/**
 * Design Studio Slice 5 step 6: a semantic countertop opening (never a boolean subtraction — see
 * `@lintel/types`'s `CutoutFeature`). `position` is an offset from the cabinet footprint's own centre, in the
 * cabinet's local frame; `{ xMm: 0, zMm: 0 }` (centred) is the only value this slice ever produces.
 */
export const ModelCutout = z.strictObject({
  cutoutId: z.string(),
  target: z.enum(["COUNTERTOP", "CABINET_TOP", "CABINET_BACK"]),
  shape: z.literal("RECTANGLE"),
  widthMm: z.number(),
  depthMm: z.number(),
  position: z.strictObject({ xMm: z.number(), zMm: z.number() }),
  cornerRadiusMm: z.number().nullable(),
  clearance: z.array(z.strictObject({
    ruleId: z.string(), zone: z.enum(["INSTALLATION", "VENTILATION", "STRUCTURAL_EXCLUSION"]), axis: z.enum(["TOP", "BOTTOM", "LEFT", "RIGHT", "FRONT", "BACK"]),
    minMm: z.number().nullable(), maxMm: z.number().nullable(),
  })),
  sourceApplianceId: z.string().nullable(),
  edgeTreatment: z.record(z.string(), z.string()).nullable(),
});
export type ModelCutout = z.infer<typeof ModelCutout>;

export const ModelObject = z.strictObject({
  /** The object row of THIS version (the id the object edit routes take). */
  objectId: Uuid,
  /** Stable identity of the object across design versions: the engine's object id and the UI's selection key. */
  lineageId: Uuid,
  objectCode: z.string(),
  objectType: z.string(),
  productCode: z.string(),
  productVersionId: Uuid,
  /** Resolved parameter values and whether each came from the product DEFAULT or the OBJECT. */
  parameters: z.record(z.string(), z.union([z.number(), z.string()])),
  parameterSources: z.record(z.string(), z.enum(["DEFAULT", "OBJECT"])),
  dimensions: z.strictObject({ width: z.number(), height: z.number(), depth: z.number() }),
  transform: z.strictObject({ x: z.number(), y: z.number(), z: z.number(), rotationY: z.number() }),
  /** Placement in the room, or null when the object could not be placed (see its messages). */
  placement: z.strictObject({
    wallId: z.enum(["A", "B", "C", "D"]), rotationY: z.number(), envelope: Box,
    alongWall: z.strictObject({ start: z.number(), end: z.number() }), distanceToWall: z.number(),
  }).nullable(),
  components: z.array(ModelComponent),
  cutouts: z.array(ModelCutout),
  validation: z.strictObject({ counts: Counts, canApprove: z.boolean() }),
  messages: z.array(ModelMessage),
});
export type ModelObject = z.infer<typeof ModelObject>;

/** GET /design-versions/{id}/model — the engine-resolved model of exactly this version's inputs (nothing persisted). */
export const ModelPreviewResponse = z.strictObject({
  designVersion: z.strictObject({ id: Uuid, designId: Uuid, projectId: Uuid, versionNumber: z.number().int(), status: LifecycleStatus, inputHash: Sha256Hash, inputRevision: z.number().int(), contentHash: Sha256Hash }),
  /** The exact pinned engineering versions the model was resolved with. */
  pins: z.record(z.string(), Uuid.nullable()),
  /** TEST_FIXTURE when any input is test-fixture data (never production). */
  dataClassification: z.enum(["PRODUCTION", "TEST_FIXTURE"]),
  testFixtureSources: z.array(z.string()),
  engine: z.strictObject({ name: z.literal("validation"), version: z.string(), fingerprint: Sha256Hash, build: z.string() }),
  /** Room fingerprint from the engine: identical inputs + engine ⇔ identical model. */
  modelFingerprint: z.string(),
  room: z.strictObject({
    id: Uuid, name: z.string(), length: z.number(), width: z.number(), height: z.number(), wallThickness: z.number(),
    walls: z.array(z.strictObject({
      wallId: z.enum(["A", "B", "C", "D"]), start: z.strictObject({ x: z.number(), z: z.number() }), end: z.strictObject({ x: z.number(), z: z.number() }),
      length: z.number(), height: z.number(), thickness: z.number(),
    })),
  }),
  objects: z.array(ModelObject),
  runs: z.array(z.strictObject({ runId: z.string(), wallId: z.enum(["A", "B", "C", "D"]), lineageIds: z.array(Uuid), start: z.number(), end: z.number(), length: z.number() })),
  relationships: z.array(z.strictObject({
    relationshipId: z.string(), type: z.string(), source: z.enum(["DERIVED", "OVERRIDE"]), lineageIds: z.array(z.string()), wallIds: z.array(z.string()),
    gap: z.number().nullable(), touching: z.boolean().nullable(), overrideIds: z.array(z.string()),
  })),
  /** Every engine message (object and room level); BLOCKER prevents approval and production output. */
  validation: z.strictObject({ counts: Counts, canApprove: z.boolean(), messages: z.array(ModelMessage) }),
});
export type ModelPreviewResponse = z.infer<typeof ModelPreviewResponse>;
