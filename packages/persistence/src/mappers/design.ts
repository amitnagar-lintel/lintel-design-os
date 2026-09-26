import type { DesignObject, DesignState, DesignVersion, ParameterValue, RelationshipOverride, RelationshipOverrideType, Room } from "@lintel/types";
import type { RecordStatus, VersionEnvelope } from "../envelope.js";
import { envelopeFromRow, envelopeToRow } from "../envelope.js";
import type { EnvelopeRow } from "../envelope.js";
import { MappingError } from "../errors.js";
import type { Sha256 } from "../hash.js";
import { contentHash } from "../hash.js";
import type { MapContext } from "./common.js";
import { omit } from "./common.js";

/* ------------------------------------------------------------ rooms */

export interface RoomRow {
  readonly id: string;
  readonly org_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly room_type: Room["type"];
}

/** A survey of the room. Insert-only: a new survey is a new revision. */
export interface RoomRevisionRow {
  readonly id: string;
  readonly org_id: string;
  readonly room_id: string;
  readonly revision_number: number;
  readonly length_mm: number;
  readonly width_mm: number;
  readonly height_mm: number;
  readonly wall_thickness_mm: number;
  readonly source: string;
  readonly surveyed_by: string;
  readonly surveyed_at: string;
  readonly content_hash: Sha256;
}

export function roomToRows(
  room: Room,
  revision: { readonly revisionId: string; readonly revisionNumber: number; readonly source: string; readonly surveyedBy: string; readonly surveyedAt: string },
  ctx: MapContext,
): { readonly room: RoomRow; readonly revision: RoomRevisionRow } {
  const dims = { length: room.length, width: room.width, height: room.height, wallThickness: room.wallThickness };
  return {
    room: { id: room.id, org_id: ctx.orgId, project_id: room.projectId, name: room.name, room_type: room.type },
    revision: {
      id: revision.revisionId,
      org_id: ctx.orgId,
      room_id: room.id,
      revision_number: revision.revisionNumber,
      length_mm: room.length,
      width_mm: room.width,
      height_mm: room.height,
      wall_thickness_mm: room.wallThickness,
      source: revision.source,
      surveyed_by: revision.surveyedBy,
      surveyed_at: revision.surveyedAt,
      content_hash: contentHash(dims),
    },
  };
}

export function roomFromRows(room: RoomRow, revision: RoomRevisionRow): Room {
  if (revision.room_id !== room.id) throw new MappingError(`room revision ${revision.id} belongs to room ${revision.room_id}, not ${room.id}`);
  return { id: room.id, projectId: room.project_id, name: room.name, type: room.room_type, length: revision.length_mm, width: revision.width_mm, height: revision.height_mm, wallThickness: revision.wall_thickness_mm };
}

/* ------------------------------------------------------------ design version + pins */

/**
 * Exact versions a DesignVersion pins (M5 §2.3), one typed reference per domain.
 * Never re-pointed after DRAFT; nullable pins are "not applicable yet".
 */
export interface DesignVersionPins {
  readonly constructionStandardVersionId: string;
  readonly planningStandardVersionId: string;
  readonly edgeBandStandardVersionId: string;
  readonly manufacturingStandardVersionId: string | null;
  readonly pricingStandardVersionId: string | null;
  readonly quotationPolicyVersionId: string | null;
  readonly materialCatalogReleaseId: string;
  readonly finishCatalogReleaseId: string;
  readonly hardwareCatalogReleaseId: string;
  readonly hettichDatasetVersionId: string;
  readonly applianceCatalogReleaseId: string | null;
  readonly productCatalogReleaseId: string;
}

export interface DesignVersionRow extends EnvelopeRow {
  readonly org_id: string;
  readonly project_id: string;
  readonly based_on_version_id: string | null;
  readonly room_revision_id: string;
  readonly construction_standard_version_id: string;
  readonly planning_standard_version_id: string;
  readonly edge_band_standard_version_id: string;
  readonly manufacturing_standard_version_id: string | null;
  readonly pricing_standard_version_id: string | null;
  readonly quotation_policy_version_id: string | null;
  readonly material_catalog_release_id: string;
  readonly finish_catalog_release_id: string;
  readonly hardware_catalog_release_id: string;
  readonly hettich_dataset_version_id: string;
  readonly appliance_catalog_release_id: string | null;
  readonly product_catalog_release_id: string;
  readonly authored_engine_version: string;
  readonly input_hash: Sha256;
}

export interface DesignVersionRecord {
  /** `entityId` is the design id; `versionId` the design version id. */
  readonly envelope: VersionEnvelope;
  readonly projectId: string;
  readonly basedOnVersionId: string | null;
  readonly roomRevisionId: string;
  readonly pins: DesignVersionPins;
  readonly authoredEngineVersion: string;
  readonly inputHash: Sha256;
}

export function pinsToColumns(p: DesignVersionPins) {
  return {
    construction_standard_version_id: p.constructionStandardVersionId,
    planning_standard_version_id: p.planningStandardVersionId,
    edge_band_standard_version_id: p.edgeBandStandardVersionId,
    manufacturing_standard_version_id: p.manufacturingStandardVersionId,
    pricing_standard_version_id: p.pricingStandardVersionId,
    quotation_policy_version_id: p.quotationPolicyVersionId,
    material_catalog_release_id: p.materialCatalogReleaseId,
    finish_catalog_release_id: p.finishCatalogReleaseId,
    hardware_catalog_release_id: p.hardwareCatalogReleaseId,
    hettich_dataset_version_id: p.hettichDatasetVersionId,
    appliance_catalog_release_id: p.applianceCatalogReleaseId,
    product_catalog_release_id: p.productCatalogReleaseId,
  } as const;
}

export function pinsFromColumns(r: ReturnType<typeof pinsToColumns>): DesignVersionPins {
  return {
    constructionStandardVersionId: r.construction_standard_version_id,
    planningStandardVersionId: r.planning_standard_version_id,
    edgeBandStandardVersionId: r.edge_band_standard_version_id,
    manufacturingStandardVersionId: r.manufacturing_standard_version_id,
    pricingStandardVersionId: r.pricing_standard_version_id,
    quotationPolicyVersionId: r.quotation_policy_version_id,
    materialCatalogReleaseId: r.material_catalog_release_id,
    finishCatalogReleaseId: r.finish_catalog_release_id,
    hardwareCatalogReleaseId: r.hardware_catalog_release_id,
    hettichDatasetVersionId: r.hettich_dataset_version_id,
    applianceCatalogReleaseId: r.appliance_catalog_release_id,
    productCatalogReleaseId: r.product_catalog_release_id,
  };
}

export function designVersionToRow(d: DesignVersionRecord, ctx: MapContext): DesignVersionRow {
  return {
    ...envelopeToRow(d.envelope),
    org_id: ctx.orgId,
    project_id: d.projectId,
    based_on_version_id: d.basedOnVersionId,
    room_revision_id: d.roomRevisionId,
    ...pinsToColumns(d.pins),
    authored_engine_version: d.authoredEngineVersion,
    input_hash: d.inputHash,
  };
}

export function designVersionFromRow(r: DesignVersionRow): DesignVersionRecord {
  return {
    envelope: envelopeFromRow(r),
    projectId: r.project_id,
    basedOnVersionId: r.based_on_version_id,
    roomRevisionId: r.room_revision_id,
    pins: pinsFromColumns(r),
    authoredEngineVersion: r.authored_engine_version,
    inputHash: r.input_hash,
  };
}

/** Persisted lifecycle → engine DesignState. CHANGES_REQUIRED is never produced (D2). */
export function designStateFromRecord(s: RecordStatus): DesignState {
  return s;
}

/** Engine DesignState → persisted lifecycle. CHANGES_REQUIRED is a decision, not a status, and is refused (D2). */
export function recordStatusFromDesignState(s: DesignState): RecordStatus {
  if (s === "CHANGES_REQUIRED") throw new MappingError("CHANGES_REQUIRED is recorded as a REQUEST_CHANGES decision, never persisted as a status (D2)");
  return s;
}

export function engineDesignVersion(d: DesignVersionRecord): DesignVersion {
  return { designVersionId: d.envelope.versionId, designId: d.envelope.entityId, projectId: d.projectId, versionNumber: d.envelope.versionNumber, status: designStateFromRecord(d.envelope.status) };
}

/* ------------------------------------------------------------ design objects */

const QUARTER_TURNS = new Set([0, 90, 180, 270]);

export interface DesignObjectRow {
  /** Row identity (new for every design version copy). */
  readonly id: string;
  readonly org_id: string;
  readonly design_version_id: string;
  readonly object_code: string;
  /** Stable identity across design versions (copy-on-write) = the engine `objectId`. */
  readonly lineage_id: string;
  readonly object_type: DesignObject["objectType"];
  readonly product_code: string;
  readonly x_mm: number;
  readonly y_mm: number;
  readonly z_mm: number;
  /** Quarter turns only (M4); the schema has no X/Z rotation columns. */
  readonly rotation_y: 0 | 90 | 180 | 270;
  readonly width_mm: number;
  readonly height_mm: number;
  readonly depth_mm: number;
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly status: DesignObject["status"];
}

export function designObjectToRow(o: DesignObject, ctx: MapContext & { readonly designVersionId: string; readonly rowId: string }): DesignObjectRow {
  const t = o.transform;
  if (t.rotationX !== 0 || t.rotationZ !== 0) throw new MappingError(`${o.objectCode}: only rotation about the vertical axis can be persisted`);
  if (!QUARTER_TURNS.has(t.rotationY)) throw new MappingError(`${o.objectCode}: rotation ${t.rotationY}° is not a quarter turn (ROTATION_UNSUPPORTED)`);
  return {
    id: ctx.rowId,
    org_id: ctx.orgId,
    design_version_id: ctx.designVersionId,
    object_code: o.objectCode,
    lineage_id: o.objectId,
    object_type: o.objectType,
    product_code: o.productId,
    x_mm: t.x,
    y_mm: t.y,
    z_mm: t.z,
    rotation_y: t.rotationY as 0 | 90 | 180 | 270,
    width_mm: o.dimensions.width,
    height_mm: o.dimensions.height,
    depth_mm: o.dimensions.depth,
    parameters: o.parameters,
    status: o.status,
  };
}

export function designObjectFromRow(r: DesignObjectRow, ctx: { readonly projectId: string; readonly roomId: string }): DesignObject {
  return {
    objectId: r.lineage_id,
    objectCode: r.object_code,
    projectId: ctx.projectId,
    roomId: ctx.roomId,
    objectType: r.object_type,
    productId: r.product_code,
    transform: { x: r.x_mm, y: r.y_mm, z: r.z_mm, rotationX: 0, rotationY: r.rotation_y, rotationZ: 0 },
    dimensions: { width: r.width_mm, height: r.height_mm, depth: r.depth_mm },
    parameters: r.parameters,
    status: r.status,
  };
}

/* ------------------------------------------------------------ relationship overrides (audited, versioned, M4) */

export interface RelationshipOverrideRow {
  readonly org_id: string;
  readonly design_version_id: string;
  readonly override_code: string;
  readonly version: number;
  readonly kind: RelationshipOverrideType;
  readonly object_ids: readonly string[];
  readonly reason: string;
  readonly created_by: string;
  readonly created_at: string;
}

export function overrideToRow(o: RelationshipOverride, ctx: MapContext & { readonly designVersionId: string }): RelationshipOverrideRow {
  if (o.reason.trim() === "") throw new MappingError(`override ${o.overrideId}: a reason is required`);
  return { org_id: ctx.orgId, design_version_id: ctx.designVersionId, override_code: o.overrideId, version: o.version, kind: o.type, object_ids: o.objectIds, reason: o.reason, created_by: o.author, created_at: o.createdAt };
}

export function overrideFromRow(r: RelationshipOverrideRow): RelationshipOverride {
  return { overrideId: r.override_code, version: r.version, type: r.kind, objectIds: r.object_ids, reason: r.reason, author: r.created_by, createdAt: r.created_at };
}

/**
 * Hash of everything a design version's engine result depends on: room survey, objects,
 * overrides and pins. A validation run is valid only for the input hash it was made for.
 */
export function designInputHash(input: {
  readonly roomRevision: Pick<RoomRevisionRow, "id" | "content_hash">;
  readonly objects: readonly DesignObjectRow[];
  readonly overrides: readonly RelationshipOverrideRow[];
  readonly pins: DesignVersionPins;
}): Sha256 {
  // Row ids differ between copies of the same content; they are not inputs.
  const objects = input.objects.map((o) => omit(o, "id", "org_id", "design_version_id"));
  const overrides = input.overrides.map((o) => omit(o, "org_id", "design_version_id"));
  return contentHash({
    roomRevision: input.roomRevision,
    objects: objects.sort((a, b) => (a.object_code < b.object_code ? -1 : 1)),
    overrides: overrides.sort((a, b) => (a.override_code < b.override_code ? -1 : 1)),
    pins: input.pins,
  });
}
