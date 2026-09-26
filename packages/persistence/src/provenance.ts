import { createHash } from "node:crypto";
import { MappingError } from "./errors.js";
import { assertNoTestFixture } from "./fixture-guard.js";
import type { RecordLifecycleStatus } from "./envelope.js";
import type { Sha256 } from "./hash.js";
import { contentHash, isSha256 } from "./hash.js";
import type { MapContext } from "./mappers/common.js";
import type { DesignVersionPins } from "./mappers/design.js";
import { pinsFromColumns, pinsToColumns } from "./mappers/design.js";
import type { OutputPurpose } from "./output-purpose.js";
import { outputPurposeProblems } from "./output-purpose.js";
import { ENGINE_BUILD } from "./validation-run.js";

export type SnapshotKind = "BOM" | "BOQ" | "PRICING" | "QUOTATION" | "DRAWING" | "MANUFACTURING_DOCUMENT";

/* ------------------------------------------------------------ engines (Step 6 plan §6) */

/** One fingerprint per output engine (OD-S6-3); `validation` records validation runs only. */
export type EngineName = "validation" | "bom" | "boq" | "pricing" | "quotation" | "drawing" | "manufacturing";

export const ENGINE_OF_KIND: Readonly<Record<SnapshotKind, EngineName>> = {
  BOM: "bom", BOQ: "boq", PRICING: "pricing", QUOTATION: "quotation", DRAWING: "drawing", MANUFACTURING_DOCUMENT: "manufacturing",
};

/** What an engine fingerprint covers (OD-S6-9): the reached source per package, locked externals, entry module, runtime. */
export interface EngineClosure {
  readonly packages: Readonly<Record<string, Sha256>>;
  readonly externals: Readonly<Record<string, string>>;
  readonly entry: Sha256;
  readonly runtime: string;
}

/** Exactly which engine produced a result: human-readable build beside the cryptographic fingerprint. */
export interface EngineProvenance {
  readonly name: EngineName;
  readonly version: string;
  /** Commit SHA / build revision (human-readable; not an input of the fingerprint). */
  readonly build: string;
  /** SHA-256 of { engine, version, closure } (same code + dependency closure ⇔ same fingerprint). */
  readonly fingerprint: Sha256;
  readonly closure: EngineClosure;
}

export function assertEngineProvenance(e: EngineProvenance, expected: EngineName): void {
  if (e.name !== expected) throw new MappingError(`engine ${e.name} cannot produce a ${expected} result`);
  if (e.version.trim() === "") throw new MappingError("engine version is required");
  if (!ENGINE_BUILD.test(e.build)) throw new MappingError("engine build identity (commit SHA / build revision) is required");
  if (!isSha256(e.fingerprint)) throw new MappingError("engine fingerprint must be sha256:<64 hex>");
}

/* ------------------------------------------------------------ canonical hashes (text forms mirror migration 0017) */

const sha256Text = (text: string): Sha256 => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pins whose exact version content an output depends on (engineering pins + the commercial / manufacturing versions chosen per output). */
export type DependencyPin =
  | "construction_standard_version_id" | "planning_standard_version_id" | "edge_band_standard_version_id" | "material_catalog_version_id"
  | "finish_catalog_version_id" | "hardware_catalog_version_id" | "appliance_catalog_version_id" | "product_catalog_version_id"
  | "hettich_dataset_version_id" | "pricing_standard_version_id" | "quotation_policy_version_id" | "manufacturing_standard_version_id";
export type DependencyHashes = Readonly<Partial<Record<DependencyPin, Sha256>>>;
export const COMMERCIAL_PINS: readonly DependencyPin[] = ["pricing_standard_version_id", "quotation_policy_version_id", "manufacturing_standard_version_id"];

/** `design_os.dependency_set_hash`: "key=value" lines sorted by key (code point), LF-joined. */
export function dependencySetHash(hashes: DependencyHashes): Sha256 {
  const lines = Object.entries(hashes).sort(([a], [b]) => byCodePoint(a, b)).map(([k, v]) => `${k}=${v}`);
  return sha256Text(lines.join("\n"));
}

/** The engineering part of a dependency-hash map (every non-commercial pin). */
export function engineeringDependencyHashes(hashes: DependencyHashes): DependencyHashes {
  return Object.fromEntries(Object.entries(hashes).filter(([k]) => !COMMERCIAL_PINS.includes(k as DependencyPin)));
}

/** `design_os.commercial_input_hash`: one line per chosen commercial version, "<pin>=<id>:<dependency hash>". */
export function commercialInputHash(c: { readonly pricingStandardVersionId: string | null; readonly quotationPolicyVersionId: string | null }, hashes: DependencyHashes): Sha256 | null {
  if (c.pricingStandardVersionId === null) return null;
  let text = `pricing_standard_version_id=${c.pricingStandardVersionId}:${String(hashes.pricing_standard_version_id)}`;
  if (c.quotationPolicyVersionId !== null) text += `\nquotation_policy_version_id=${c.quotationPolicyVersionId}:${String(hashes.quotation_policy_version_id)}`;
  return sha256Text(text);
}

export interface SnapshotFile {
  readonly sequence: number;
  readonly format: string;
  readonly sheetIndex: number | null;
  readonly checksum: Sha256;
  readonly byteSize: number;
  readonly contentType: string;
}

/** `design_os.drawing_file_manifest_hash`: "<sequence>|<format>|<sheet>|<checksum>|<bytes>|<content type>" lines by sequence. */
export function fileManifestHash(files: readonly SnapshotFile[]): Sha256 {
  const lines = [...files].sort((a, b) => a.sequence - b.sequence)
    .map((f) => `${String(f.sequence)}|${f.format}|${f.sheetIndex === null ? "" : String(f.sheetIndex)}|${f.checksum}|${String(f.byteSize)}|${f.contentType}`);
  return sha256Text(lines.join("\n"));
}

/* ------------------------------------------------------------ provenance */

/** Versions chosen when the output is generated (never design-version pins; plan revision 4 §4). */
export interface ChosenVersions {
  readonly pricingStandardVersionId: string | null;
  readonly quotationPolicyVersionId: string | null;
  readonly manufacturingStandardVersionId: string | null;
}
export const NO_CHOSEN_VERSIONS: ChosenVersions = { pricingStandardVersionId: null, quotationPolicyVersionId: null, manufacturingStandardVersionId: null };

export interface SnapshotSources {
  readonly bomSnapshotId?: string;
  readonly boqSnapshotId?: string;
  readonly pricingSnapshotId?: string;
}

/** Upstream snapshots each kind consumes (plan §2); the database checks the same edges. */
export const SOURCES_OF_KIND: Readonly<Record<SnapshotKind, readonly (keyof SnapshotSources)[]>> = {
  BOM: [], BOQ: ["bomSnapshotId"], PRICING: ["bomSnapshotId", "boqSnapshotId"], QUOTATION: ["boqSnapshotId", "pricingSnapshotId"], DRAWING: [], MANUFACTURING_DOCUMENT: [],
};

/** The generating design version, exactly as read in the generation transaction. */
export interface DesignVersionRef {
  readonly versionId: string;
  readonly status: RecordLifecycleStatus;
  readonly contentHash: Sha256;
  /** Engineering input hash and database revision. */
  readonly inputHash: Sha256;
  readonly inputRevision: number;
}

/** What every generated output records (plan §8). */
export interface SnapshotProvenance {
  readonly designVersionId: string;
  readonly designVersionStatus: RecordLifecycleStatus;
  readonly designVersionContentHash: Sha256;
  readonly inputHash: Sha256;
  readonly inputRevision: number;
  /** The 9 exact engineering pins of the design version. */
  readonly pins: DesignVersionPins;
  readonly chosen: ChosenVersions;
  readonly dependencyHashes: DependencyHashes;
  readonly dependencySetHash: Sha256;
  readonly commercialInputHash: Sha256 | null;
  /** OUTPUT_GENERATION validation run of the same execution context (evidence, not an input). */
  readonly validationRunId: string;
  readonly engine: EngineProvenance;
  readonly sources: SnapshotSources;
}

const CHOSEN_PIN: Readonly<Record<keyof ChosenVersions, DependencyPin>> = {
  pricingStandardVersionId: "pricing_standard_version_id",
  quotationPolicyVersionId: "quotation_policy_version_id",
  manufacturingStandardVersionId: "manufacturing_standard_version_id",
};
const USES: Readonly<Record<keyof ChosenVersions, readonly SnapshotKind[]>> = {
  pricingStandardVersionId: ["PRICING", "QUOTATION"],
  quotationPolicyVersionId: ["QUOTATION"],
  manufacturingStandardVersionId: ["MANUFACTURING_DOCUMENT"],
};

export function buildSnapshotProvenance(kind: SnapshotKind, input: {
  readonly designVersion: DesignVersionRef;
  readonly pins: DesignVersionPins;
  readonly chosen: ChosenVersions;
  readonly dependencyHashes: DependencyHashes;
  readonly validationRunId: string;
  readonly engine: EngineProvenance;
  readonly sources: SnapshotSources;
}): SnapshotProvenance {
  assertEngineProvenance(input.engine, ENGINE_OF_KIND[kind]);
  // Chosen versions: present exactly for the kinds that consume them.
  for (const key of Object.keys(CHOSEN_PIN) as (keyof ChosenVersions)[]) {
    const uses = USES[key].includes(kind);
    if (uses !== (input.chosen[key] !== null)) throw new MappingError(`${kind} snapshot: ${key} ${uses ? "is required" : "does not apply"}`);
  }
  // Dependency hashes: exactly the non-null engineering pins plus the chosen versions.
  const pinColumns = pinsToColumns(input.pins) as Record<string, string | null>;
  const expectedKeys = [
    ...Object.entries(pinColumns).filter(([, v]) => v !== null).map(([k]) => k),
    ...(Object.keys(CHOSEN_PIN) as (keyof ChosenVersions)[]).filter((k) => input.chosen[k] !== null).map((k) => CHOSEN_PIN[k]),
  ].sort(byCodePoint);
  const actualKeys = Object.keys(input.dependencyHashes).sort(byCodePoint);
  if (expectedKeys.join() !== actualKeys.join()) throw new MappingError(`${kind} snapshot: dependency hashes must cover exactly ${expectedKeys.join(", ")}`);
  for (const [k, v] of Object.entries(input.dependencyHashes)) if (!isSha256(v)) throw new MappingError(`dependency hash of ${k} must be sha256:<64 hex>`);
  const required = SOURCES_OF_KIND[kind];
  for (const key of Object.keys(input.sources) as (keyof SnapshotSources)[]) {
    if (!required.includes(key)) throw new MappingError(`${kind} snapshot does not consume ${key}`);
  }
  for (const key of required) if (input.sources[key] === undefined) throw new MappingError(`${kind} snapshot requires ${key}`);
  return {
    designVersionId: input.designVersion.versionId,
    designVersionStatus: input.designVersion.status,
    designVersionContentHash: input.designVersion.contentHash,
    inputHash: input.designVersion.inputHash,
    inputRevision: input.designVersion.inputRevision,
    pins: input.pins,
    chosen: input.chosen,
    dependencyHashes: input.dependencyHashes,
    dependencySetHash: dependencySetHash(input.dependencyHashes),
    commercialInputHash: commercialInputHash(input.chosen, input.dependencyHashes),
    validationRunId: input.validationRunId,
    engine: input.engine,
    sources: input.sources,
  };
}

/* ------------------------------------------------------------ records */

export type DrawingType = "WALL_INTERNAL_ELEVATION" | "ROOM_PANEL_SCHEDULE" | "FRONT_ELEVATION" | "SIDE_SECTION" | "CABINET_INTERNAL_ELEVATION" | "PANEL_SCHEDULE";
export const ROOM_DRAWING_TYPES: readonly DrawingType[] = ["WALL_INTERNAL_ELEVATION", "ROOM_PANEL_SCHEDULE"];

/** A drawing snapshot's parameters (part of its natural identity) and its sealed file manifest. */
export interface DrawingIdentity {
  readonly drawingType: DrawingType;
  readonly wallId: "A" | "B" | "C" | "D" | null;
  readonly objectLineageId: string | null;
  readonly cutXMm: number | null;
  readonly drawingNumber: string;
  readonly drawingRevision: string;
  readonly fileManifestHash: Sha256;
}

/** An immutable, insert-only generated output (plan §8). */
export interface SnapshotRecord {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  /** PRELIMINARY, FOR_REVIEW or FOR_PRODUCTION; fixed for the snapshot's lifetime (see output-purpose.ts). */
  readonly purpose: OutputPurpose;
  readonly provenance: SnapshotProvenance;
  readonly contentHash: Sha256;
  /** The engine's own `hash53` payload seal, when the payload has one (parity only; never authoritative). */
  readonly engineSeal: string | null;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly outputComplete: boolean;
  readonly payload: unknown;
  readonly dataClassification: "PRODUCTION";
  readonly createdBy: string;
  readonly createdAt: string;
  readonly revisionNumber?: number;
  readonly drawing?: DrawingIdentity;
}

/**
 * Seal an engine output for storage. TEST_FIXTURE outputs are refused (requirement E); the content hash is computed
 * here, never accepted from a caller. The purpose must be allowed for the kind and the design version's lifecycle
 * state; FOR_PRODUCTION also needs 0 BLOCKERs in the output and in its validation evidence, and a complete output.
 */
export function buildSnapshotRecord(input: {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly purpose: OutputPurpose;
  readonly provenance: SnapshotProvenance;
  readonly payload: unknown;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly outputComplete: boolean;
  /** BLOCKERs of the OUTPUT_GENERATION validation run referenced by the provenance. */
  readonly validationBlockerCount: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly revisionNumber?: number;
  readonly drawing?: DrawingIdentity;
}): SnapshotRecord {
  assertNoTestFixture(`${input.kind} snapshot ${input.snapshotId}`, input.payload);
  for (const [name, n] of [["blockerCount", input.blockerCount], ["warningCount", input.warningCount], ["validationBlockerCount", input.validationBlockerCount]] as const) {
    if (!Number.isInteger(n) || n < 0) throw new MappingError(`${name} must be a non-negative integer`);
  }
  if ((input.kind === "QUOTATION") !== (input.revisionNumber !== undefined)) throw new MappingError("revisionNumber applies exactly to QUOTATION snapshots");
  if ((input.kind === "DRAWING") !== (input.drawing !== undefined)) throw new MappingError("drawing identity applies exactly to DRAWING snapshots");
  if (input.drawing !== undefined) assertDrawingIdentity(input.drawing);
  const problems = outputPurposeProblems(input.kind, input.purpose, input.provenance.designVersionStatus, input.blockerCount).map((p) => `${p.code}: ${p.message}`);
  if (input.purpose === "FOR_PRODUCTION" && input.validationBlockerCount > 0) problems.push(`VALIDATION_BLOCKERS: the validation evidence has ${String(input.validationBlockerCount)} BLOCKER(s)`);
  if (input.purpose === "FOR_PRODUCTION" && !input.outputComplete) problems.push("PRODUCTION_GUARD_FAILED: FOR_PRODUCTION requires a complete output");
  if (problems.length > 0) throw new MappingError(`${input.kind} ${input.purpose} output refused: ${problems.join("; ")}`);
  const p = input.payload;
  const engineSeal = p !== null && typeof p === "object" && typeof (p as { contentHash?: unknown }).contentHash === "string" ? (p as { contentHash: string }).contentHash : null;
  return {
    snapshotId: input.snapshotId, kind: input.kind, purpose: input.purpose, provenance: input.provenance,
    contentHash: contentHash(input.payload), engineSeal, blockerCount: input.blockerCount, warningCount: input.warningCount, outputComplete: input.outputComplete,
    payload: input.payload, dataClassification: "PRODUCTION", createdBy: input.createdBy, createdAt: input.createdAt,
    ...(input.revisionNumber === undefined ? {} : { revisionNumber: input.revisionNumber }),
    ...(input.drawing === undefined ? {} : { drawing: input.drawing }),
  };
}

function assertDrawingIdentity(d: DrawingIdentity): void {
  const room = ROOM_DRAWING_TYPES.includes(d.drawingType);
  if ((d.drawingType === "WALL_INTERNAL_ELEVATION") !== (d.wallId !== null)) throw new MappingError("wallId applies exactly to WALL_INTERNAL_ELEVATION");
  if (room === (d.objectLineageId !== null)) throw new MappingError("objectLineageId applies exactly to cabinet (object) drawings");
  if (d.cutXMm !== null && d.drawingType !== "SIDE_SECTION") throw new MappingError("cutXMm applies only to SIDE_SECTION");
  if (!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(d.drawingNumber) || !/^[A-Z0-9]{1,4}$/.test(d.drawingRevision)) throw new MappingError("invalid drawing number or revision");
  if (!isSha256(d.fileManifestHash)) throw new MappingError("fileManifestHash must be sha256:<64 hex>");
}

/** False when the stored payload no longer matches its content hash. */
export function verifySnapshotRecord(r: SnapshotRecord): boolean {
  return contentHash(r.payload) === r.contentHash;
}

/* ------------------------------------------------------------ rows */

type PinColumns = ReturnType<typeof pinsToColumns>;

export interface SnapshotRow extends PinColumns {
  readonly id: string;
  readonly org_id: string;
  readonly kind: SnapshotKind;
  readonly purpose: OutputPurpose;
  readonly design_version_id: string;
  readonly design_version_status: RecordLifecycleStatus;
  readonly design_version_content_hash: Sha256;
  readonly input_hash: Sha256;
  readonly input_revision: number;
  readonly pricing_standard_version_id: string | null;
  readonly quotation_policy_version_id: string | null;
  readonly manufacturing_standard_version_id: string | null;
  readonly dependency_hashes: DependencyHashes;
  readonly dependency_set_hash: Sha256;
  readonly commercial_input_hash: Sha256 | null;
  readonly validation_run_id: string;
  readonly engine_name: EngineName;
  readonly engine_version: string;
  readonly engine_build: string;
  readonly engine_fingerprint: Sha256;
  readonly engine_closure: EngineClosure;
  readonly engine_seal: string | null;
  readonly content_hash: Sha256;
  readonly blocker_count: number;
  readonly warning_count: number;
  readonly output_complete: boolean;
  readonly payload: unknown;
  readonly data_classification: "PRODUCTION";
  readonly created_by: string;
  readonly created_at: string;
  // kind-specific (present only on the tables that have them)
  readonly bom_snapshot_id?: string;
  readonly boq_snapshot_id?: string;
  readonly pricing_snapshot_id?: string;
  readonly revision_number?: number;
  readonly drawing_type?: DrawingType;
  readonly drawing_scope?: "ROOM" | "OBJECT";
  readonly wall_id?: "A" | "B" | "C" | "D" | null;
  readonly object_lineage_id?: string | null;
  /** numeric: the database driver may return it as text. */
  readonly cut_x_mm?: number | string | null;
  readonly drawing_number?: string;
  readonly drawing_revision?: string;
  readonly file_manifest_hash?: Sha256;
}

const SOURCE_COLUMN: Readonly<Record<keyof SnapshotSources, "bom_snapshot_id" | "boq_snapshot_id" | "pricing_snapshot_id">> = {
  bomSnapshotId: "bom_snapshot_id", boqSnapshotId: "boq_snapshot_id", pricingSnapshotId: "pricing_snapshot_id",
};

function kindColumns(r: SnapshotRecord): Partial<SnapshotRow> {
  const out: Record<string, unknown> = {};
  for (const key of SOURCES_OF_KIND[r.kind]) out[SOURCE_COLUMN[key]] = r.provenance.sources[key];
  if (r.revisionNumber !== undefined) out.revision_number = r.revisionNumber;
  const d = r.drawing;
  if (d !== undefined) {
    Object.assign(out, {
      drawing_type: d.drawingType, drawing_scope: ROOM_DRAWING_TYPES.includes(d.drawingType) ? "ROOM" : "OBJECT", wall_id: d.wallId,
      object_lineage_id: d.objectLineageId, cut_x_mm: d.cutXMm, drawing_number: d.drawingNumber, drawing_revision: d.drawingRevision,
      file_manifest_hash: d.fileManifestHash,
    });
  }
  return out;
}

export function snapshotToRow(r: SnapshotRecord, ctx: MapContext): SnapshotRow {
  const p = r.provenance;
  return {
    id: r.snapshotId,
    org_id: ctx.orgId,
    kind: r.kind,
    purpose: r.purpose,
    design_version_id: p.designVersionId,
    design_version_status: p.designVersionStatus,
    design_version_content_hash: p.designVersionContentHash,
    input_hash: p.inputHash,
    input_revision: p.inputRevision,
    ...pinsToColumns(p.pins),
    pricing_standard_version_id: p.chosen.pricingStandardVersionId,
    quotation_policy_version_id: p.chosen.quotationPolicyVersionId,
    manufacturing_standard_version_id: p.chosen.manufacturingStandardVersionId,
    dependency_hashes: p.dependencyHashes,
    dependency_set_hash: p.dependencySetHash,
    commercial_input_hash: p.commercialInputHash,
    validation_run_id: p.validationRunId,
    engine_name: p.engine.name,
    engine_version: p.engine.version,
    engine_build: p.engine.build,
    engine_fingerprint: p.engine.fingerprint,
    engine_closure: p.engine.closure,
    engine_seal: r.engineSeal,
    content_hash: r.contentHash,
    blocker_count: r.blockerCount,
    warning_count: r.warningCount,
    output_complete: r.outputComplete,
    payload: r.payload,
    data_classification: r.dataClassification,
    created_by: r.createdBy,
    created_at: r.createdAt,
    ...kindColumns(r),
  };
}

export function snapshotFromRow(row: SnapshotRow): SnapshotRecord {
  const sources: Record<string, string> = {};
  for (const key of SOURCES_OF_KIND[row.kind]) {
    const v = row[SOURCE_COLUMN[key]];
    if (v === undefined) throw new MappingError(`${row.kind} snapshot row ${row.id} lacks ${SOURCE_COLUMN[key]}`);
    sources[key] = v;
  }
  const drawing: DrawingIdentity | undefined = row.kind !== "DRAWING" ? undefined : {
    drawingType: row.drawing_type as DrawingType, wallId: row.wall_id ?? null, objectLineageId: row.object_lineage_id ?? null,
    cutXMm: row.cut_x_mm === undefined || row.cut_x_mm === null ? null : Number(row.cut_x_mm),
    drawingNumber: row.drawing_number as string, drawingRevision: row.drawing_revision as string, fileManifestHash: row.file_manifest_hash as Sha256,
  };
  return {
    snapshotId: row.id,
    kind: row.kind,
    purpose: row.purpose,
    provenance: {
      designVersionId: row.design_version_id,
      designVersionStatus: row.design_version_status,
      designVersionContentHash: row.design_version_content_hash,
      inputHash: row.input_hash,
      inputRevision: row.input_revision,
      pins: pinsFromColumns(row),
      chosen: {
        pricingStandardVersionId: row.pricing_standard_version_id,
        quotationPolicyVersionId: row.quotation_policy_version_id,
        manufacturingStandardVersionId: row.manufacturing_standard_version_id,
      },
      dependencyHashes: row.dependency_hashes,
      dependencySetHash: row.dependency_set_hash,
      commercialInputHash: row.commercial_input_hash,
      validationRunId: row.validation_run_id,
      engine: { name: row.engine_name, version: row.engine_version, build: row.engine_build, fingerprint: row.engine_fingerprint, closure: row.engine_closure },
      sources,
    },
    contentHash: row.content_hash,
    engineSeal: row.engine_seal,
    blockerCount: row.blocker_count,
    warningCount: row.warning_count,
    outputComplete: row.output_complete,
    payload: row.payload,
    dataClassification: row.data_classification,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(row.revision_number === undefined ? {} : { revisionNumber: row.revision_number }),
    ...(drawing === undefined ? {} : { drawing }),
  };
}

/* ------------------------------------------------------------ natural identity (plan §9) */

/**
 * The natural identity of the output that would be generated from this provenance (before any engine runs), exactly
 * the columns snapshotIdentity() returns for the stored row: used to find an existing compatible snapshot first.
 */
export function provenanceIdentity(input: {
  readonly kind: SnapshotKind;
  readonly orgId: string;
  readonly purpose: OutputPurpose;
  readonly provenance: SnapshotProvenance;
  readonly drawing?: Omit<DrawingIdentity, "fileManifestHash">;
}): Readonly<Record<string, unknown>> {
  const p = input.provenance;
  const row: Record<string, unknown> = {
    kind: input.kind, org_id: input.orgId, design_version_id: p.designVersionId, purpose: input.purpose, input_hash: p.inputHash, input_revision: p.inputRevision,
    dependency_set_hash: p.dependencySetHash, engine_fingerprint: p.engine.fingerprint, commercial_input_hash: p.commercialInputHash,
    manufacturing_standard_version_id: p.chosen.manufacturingStandardVersionId,
  };
  for (const key of SOURCES_OF_KIND[input.kind]) row[SOURCE_COLUMN[key]] = p.sources[key];
  const d = input.drawing;
  if (d !== undefined) {
    Object.assign(row, {
      drawing_type: d.drawingType, drawing_scope: ROOM_DRAWING_TYPES.includes(d.drawingType) ? "ROOM" : "OBJECT", wall_id: d.wallId,
      object_lineage_id: d.objectLineageId, cut_x_mm: d.cutXMm, drawing_number: d.drawingNumber, drawing_revision: d.drawingRevision,
    });
  }
  return snapshotIdentity(row as unknown as SnapshotRow);
}

/**
 * The columns of a snapshot's natural identity, exactly as the unique index of its table: the same inputs, dependency
 * content, engine, purpose, sources (and drawing parameters) are the same output. Used for the exact lookup that
 * replaces any notion of "latest".
 */
export function snapshotIdentity(row: SnapshotRow): Readonly<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    org_id: row.org_id, design_version_id: row.design_version_id, purpose: row.purpose, input_hash: row.input_hash, input_revision: row.input_revision,
    dependency_set_hash: row.dependency_set_hash, engine_fingerprint: row.engine_fingerprint,
  };
  switch (row.kind) {
    case "BOM": return base;
    case "BOQ": return { ...base, bom_snapshot_id: row.bom_snapshot_id };
    case "PRICING": return { ...base, commercial_input_hash: row.commercial_input_hash, bom_snapshot_id: row.bom_snapshot_id, boq_snapshot_id: row.boq_snapshot_id };
    case "QUOTATION": return { ...base, commercial_input_hash: row.commercial_input_hash, boq_snapshot_id: row.boq_snapshot_id, pricing_snapshot_id: row.pricing_snapshot_id };
    case "DRAWING": return {
      ...base, drawing_type: row.drawing_type, drawing_scope: row.drawing_scope, wall_id: row.wall_id ?? null, object_lineage_id: row.object_lineage_id ?? null,
      cut_x_mm: row.cut_x_mm ?? null, drawing_number: row.drawing_number, drawing_revision: row.drawing_revision,
    };
    case "MANUFACTURING_DOCUMENT": return { ...base, manufacturing_standard_version_id: row.manufacturing_standard_version_id };
  }
}
