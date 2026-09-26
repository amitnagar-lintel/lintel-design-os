import type { Sha256 } from "@lintel/persistence";
import { designInputHash, designVersionContentHash, pinsFromColumns } from "@lintel/persistence";
import type { Tx } from "../../common/db/tx.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { assertWritable, versionEtag } from "../../common/http/etag.js";
import { iso } from "../../common/http/format.js";
import type { DesignObjectRow, DesignVersionRow, PinColumn, PinColumns, RelationshipOverrideRow, ValidationRunRow } from "../../infrastructure/persistence/design-versions.repository.js";
import { designVersionsRepository as repo } from "../../infrastructure/persistence/design-versions.repository.js";
import { roomsRepository } from "../../infrastructure/persistence/rooms.repository.js";
import type { ObjectResponse, OverrideResponse, PinName, Pins, PinsInput, VersionResponse, VersionState } from "./design-versions.schemas.js";
import { REQUIRED_PINS } from "./design-versions.schemas.js";

/** API pin name ↔ column. */
export const PIN_MAP: Readonly<Record<PinName, PinColumn>> = {
  constructionStandardVersionId: "construction_standard_version_id",
  planningStandardVersionId: "planning_standard_version_id",
  edgeBandStandardVersionId: "edge_band_standard_version_id",
  materialCatalogVersionId: "material_catalog_version_id",
  finishCatalogVersionId: "finish_catalog_version_id",
  hardwareCatalogVersionId: "hardware_catalog_version_id",
  applianceCatalogVersionId: "appliance_catalog_version_id",
  productCatalogVersionId: "product_catalog_version_id",
  hettichDatasetVersionId: "hettich_dataset_version_id",
};

export function pinsOf(r: PinColumns): Pins {
  return Object.fromEntries(Object.entries(PIN_MAP).map(([name, col]) => [name, r[col]])) as Pins;
}

/** Overlay requested pins on a base; required pins must end up set (400 VALIDATION_FAILED otherwise). */
export function mergePins(base: Partial<Record<PinName, string | null>>, input: PinsInput | undefined): PinColumns {
  const merged: Partial<Record<PinName, string | null | undefined>> = { ...base, ...(input ?? {}) };
  const missing = REQUIRED_PINS.filter((p) => merged[p] === undefined || merged[p] === null);
  if (missing.length > 0) {
    throw new ApiProblem("VALIDATION_FAILED", "every required pin must be an exact version", { errors: missing.map((p) => ({ path: `body.pins.${p}`, code: "required", message: "required pin" })) });
  }
  return Object.fromEntries(Object.entries(PIN_MAP).map(([name, col]) => [col, merged[name as PinName] ?? null])) as PinColumns;
}

export const etagOf = (v: DesignVersionRow): string => versionEtag(v.id, v.row_version);
export const stateOf = (v: DesignVersionRow): VersionState => ({ id: v.id, etag: etagOf(v), rowVersion: v.row_version, inputHash: v.input_hash, inputRevision: v.input_revision, contentHash: v.content_hash });
export const isCurrent = (run: ValidationRunRow, v: DesignVersionRow): boolean => run.input_hash === v.input_hash && run.input_revision === v.input_revision;

export function toVersion(v: DesignVersionRow, latestRun: ValidationRunRow | null): VersionResponse {
  return {
    id: v.id, designId: v.entity_id, projectId: v.project_id, versionNumber: v.version_number, versionLabel: v.version_label, status: v.status,
    basedOnVersionId: v.based_on_version_id, roomRevisionId: v.room_revision_id, pins: pinsOf(v), authoredEngineVersion: v.authored_engine_version,
    inputHash: v.input_hash, inputRevision: v.input_revision, contentHash: v.content_hash, rowVersion: v.row_version, source: v.source, changeReason: v.change_reason,
    createdBy: v.created_by, createdAt: iso(v.created_at), submittedBy: v.submitted_by, submittedAt: iso(v.submitted_at), approvedBy: v.approved_by, approvedAt: iso(v.approved_at),
    effectiveFrom: iso(v.effective_from), lockedBy: v.locked_by, lockedAt: iso(v.locked_at), supersededBy: v.superseded_by, supersededAt: iso(v.superseded_at),
    validation: latestRun === null ? null : { runId: latestRun.id, current: isCurrent(latestRun, v), blockerCount: latestRun.blocker_count, warningCount: latestRun.warning_count, validatedAt: iso(latestRun.created_at) },
  };
}

export const toObject = (o: DesignObjectRow): ObjectResponse => ({
  id: o.id, designVersionId: o.design_version_id, objectCode: o.object_code, lineageId: o.lineage_id, objectType: o.object_type, productCode: o.product_code,
  productVersionId: o.product_version_id, position: { xMm: o.x_mm, yMm: o.y_mm, zMm: o.z_mm }, rotationY: o.rotation_y,
  dimensions: { widthMm: o.width_mm, heightMm: o.height_mm, depthMm: o.depth_mm }, parameters: { ...o.parameters }, status: o.status,
});
export const toOverride = (o: RelationshipOverrideRow): OverrideResponse => ({
  overrideCode: o.override_code, version: o.version, kind: o.kind, objectIds: [...o.object_ids], reason: o.reason, createdBy: o.created_by, createdAt: iso(o.created_at),
});

/**
 * Lock a design version for a draft write and check its preconditions in the approved order: lifecycle first (only a
 * DRAFT is editable: LOCKED → RECORD_LOCKED, other states → RECORD_NOT_EDITABLE, whatever the ETag), then If-Match
 * against the whole-draft ETag "<id>:<row_version>". Concurrent draft writes serialize on this row lock.
 */
export async function lockDraft(tx: Tx, versionId: string, ifMatch: string | undefined): Promise<DesignVersionRow> {
  const v = await repo.get(tx, versionId, "update");
  if (v === null) throw new ApiProblem("NOT_FOUND");
  assertWritable({ ifMatch, currentEtag: etagOf(v), lifecycle: v.status });
  return v;
}

/** The input hash from the exact rows (room survey, objects, override history, pins) — the persistence definition. */
export async function computeInputHash(tx: Tx, v: DesignVersionRow): Promise<{ inputHash: Sha256; objects: DesignObjectRow[]; overrides: RelationshipOverrideRow[] }> {
  const revision = await roomsRepository.revision(tx, v.room_revision_id);
  if (revision === null) throw new ApiProblem("INTERNAL", "room revision not readable");
  const objects = await repo.objects(tx, v.id);
  const overrides = await repo.overrides(tx, v.id);
  // Required pins are NOT NULL in the database, so the persistence pin type holds.
  const pins = pinsFromColumns(v as Parameters<typeof pinsFromColumns>[0]);
  const inputHash = designInputHash({ roomRevision: { id: revision.id, content_hash: revision.content_hash as Sha256 }, objects, overrides, pins });
  return { inputHash, objects, overrides };
}

export function contentHashOf(v: Pick<DesignVersionRow, "room_revision_id" | "based_on_version_id" | "version_label" | "change_reason" | "source" | "authored_engine_version">, inputHash: Sha256): Sha256 {
  return designVersionContentHash({
    inputHash, roomRevisionId: v.room_revision_id, basedOnVersionId: v.based_on_version_id, versionLabel: v.version_label,
    changeReason: v.change_reason, source: v.source, authoredEngineVersion: v.authored_engine_version,
  });
}

/**
 * After any draft change: recompute the input hash and content hash from the exact stored rows (in the same
 * transaction) and store them. The database independently bumps input_revision; row_version (the ETag) moves too.
 */
export async function refreshHashes(tx: Tx, versionId: string): Promise<DesignVersionRow> {
  const v = await repo.get(tx, versionId);
  if (v === null) throw new ApiProblem("NOT_FOUND");
  const { inputHash } = await computeInputHash(tx, v);
  const contentHash = contentHashOf(v, inputHash);
  if (inputHash === v.input_hash && contentHash === v.content_hash) return v;
  const next = await repo.setHashes(tx, versionId, inputHash, contentHash);
  if (next === null) throw new ApiProblem("NOT_FOUND");
  return next;
}
