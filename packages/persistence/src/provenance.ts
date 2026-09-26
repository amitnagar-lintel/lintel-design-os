import { MappingError } from "./errors.js";
import { assertNoTestFixture } from "./fixture-guard.js";
import type { RecordLifecycleStatus } from "./envelope.js";
import type { Sha256 } from "./hash.js";
import { contentHash } from "./hash.js";
import type { MapContext } from "./mappers/common.js";
import type { DesignVersionPins } from "./mappers/design.js";
import type { OutputPurpose } from "./output-purpose.js";
import { outputPurposeProblems } from "./output-purpose.js";

export type SnapshotKind = "BOM" | "BOQ" | "PRICING" | "QUOTATION" | "DRAWING" | "MANUFACTURING_DOCUMENT";

/**
 * What every generated output records (M5 §6, requirement B). Copied from the DesignVersion
 * pins at generation time; `null` only where the standard does not apply to that output.
 */
export interface SnapshotProvenance {
  readonly designVersionId: string;
  /** Lifecycle/approval provenance: the design version's exact lifecycle and content when the output was generated. */
  readonly designVersionStatus: RecordLifecycleStatus;
  readonly designVersionContentHash: Sha256;
  readonly constructionStandardVersionId: string;
  readonly planningStandardVersionId: string;
  readonly edgeBandStandardVersionId: string;
  readonly manufacturingStandardVersionId: string | null;
  readonly pricingStandardVersionId: string | null;
  readonly quotationPolicyVersionId: string | null;
  readonly materialCatalogVersionId: string;
  readonly finishCatalogVersionId: string;
  readonly hardwareCatalogVersionId: string;
  readonly hettichDatasetVersionId: string;
  readonly applianceCatalogVersionId: string | null;
  readonly productCatalogVersionId: string;
  readonly engineVersion: string;
}

/** The generating design version, as stored (exact lifecycle, never "latest"). */
export interface DesignVersionRef {
  readonly versionId: string;
  readonly status: RecordLifecycleStatus;
  readonly contentHash: Sha256;
}

const USES_PRICING = new Set<SnapshotKind>(["PRICING", "QUOTATION"]);

export function buildSnapshotProvenance(kind: SnapshotKind, designVersion: DesignVersionRef, pins: DesignVersionPins, engineVersion: string): SnapshotProvenance {
  const need = (value: string | null, name: string): string => {
    if (value === null) throw new MappingError(`${kind} snapshot requires the design version to pin ${name}`);
    return value;
  };
  if (engineVersion.trim() === "") throw new MappingError("engine version is required");
  return {
    designVersionId: designVersion.versionId,
    designVersionStatus: designVersion.status,
    designVersionContentHash: designVersion.contentHash,
    constructionStandardVersionId: pins.constructionStandardVersionId,
    planningStandardVersionId: pins.planningStandardVersionId,
    edgeBandStandardVersionId: pins.edgeBandStandardVersionId,
    manufacturingStandardVersionId: kind === "MANUFACTURING_DOCUMENT" ? need(pins.manufacturingStandardVersionId, "a ManufacturingStandard version") : null,
    pricingStandardVersionId: USES_PRICING.has(kind) ? need(pins.pricingStandardVersionId, "a PricingStandard version") : null,
    quotationPolicyVersionId: kind === "QUOTATION" ? need(pins.quotationPolicyVersionId, "a Finance/QuotationPolicy version") : null,
    materialCatalogVersionId: pins.materialCatalogVersionId,
    finishCatalogVersionId: pins.finishCatalogVersionId,
    hardwareCatalogVersionId: pins.hardwareCatalogVersionId,
    hettichDatasetVersionId: pins.hettichDatasetVersionId,
    applianceCatalogVersionId: pins.applianceCatalogVersionId,
    productCatalogVersionId: pins.productCatalogVersionId,
    engineVersion,
  };
}

/** Every recorded provenance reference must equal the design version's pin (the database re-checks this). */
export function provenanceMismatches(p: SnapshotProvenance, designVersion: DesignVersionRef, pins: DesignVersionPins): string[] {
  const out: string[] = [];
  if (p.designVersionId !== designVersion.versionId) out.push(`designVersionId ${p.designVersionId} ≠ ${designVersion.versionId}`);
  if (p.designVersionContentHash !== designVersion.contentHash) out.push(`designVersionContentHash ${p.designVersionContentHash} ≠ ${designVersion.contentHash}`);
  for (const key of Object.keys(pins) as (keyof DesignVersionPins)[]) {
    if (!(key in p)) continue;
    const recorded = p[key as keyof SnapshotProvenance];
    if (recorded !== null && recorded !== pins[key]) out.push(`${key} ${recorded} ≠ pinned ${pins[key] ?? "null"}`);
  }
  return out;
}

/** An immutable, insert-only generated output (M5 §6). */
export interface SnapshotRecord {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  /** PRELIMINARY, FOR_REVIEW or FOR_PRODUCTION; fixed for the snapshot's lifetime (see output-purpose.ts). */
  readonly purpose: OutputPurpose;
  readonly provenance: SnapshotProvenance;
  readonly inputHash: Sha256;
  readonly contentHash: Sha256;
  /** The engine's own `hash53` content hash, when the payload has one (golden parity only). */
  readonly engineHash: string | null;
  readonly blockerCount: number;
  readonly payload: unknown;
  readonly dataClassification: "PRODUCTION";
  readonly createdBy: string;
  readonly createdAt: string;
}

/**
 * Seal an engine output for storage. TEST_FIXTURE outputs are refused (requirement E);
 * the content hash is computed here, never accepted from a caller. The output purpose must be
 * allowed for the kind and the design version's lifecycle state (FOR_PRODUCTION also needs 0 BLOCKERs).
 */
export function buildSnapshotRecord(input: {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly purpose: OutputPurpose;
  readonly provenance: SnapshotProvenance;
  readonly inputHash: Sha256;
  readonly payload: unknown;
  readonly blockerCount: number;
  readonly createdBy: string;
  readonly createdAt: string;
}): SnapshotRecord {
  assertNoTestFixture(`${input.kind} snapshot ${input.snapshotId}`, input.payload);
  if (!Number.isInteger(input.blockerCount) || input.blockerCount < 0) throw new MappingError("blockerCount must be a non-negative integer");
  const purposeProblems = outputPurposeProblems(input.kind, input.purpose, input.provenance.designVersionStatus, input.blockerCount);
  if (purposeProblems.length > 0) throw new MappingError(`${input.kind} ${input.purpose} output refused: ${purposeProblems.map((p) => `${p.code}: ${p.message}`).join("; ")}`);
  const p = input.payload;
  const engineHash = p !== null && typeof p === "object" && typeof (p as { contentHash?: unknown }).contentHash === "string" ? (p as { contentHash: string }).contentHash : null;
  return { ...input, contentHash: contentHash(input.payload), engineHash, dataClassification: "PRODUCTION" };
}

/** False when the stored payload no longer matches its content hash. */
export function verifySnapshotRecord(r: SnapshotRecord): boolean {
  return contentHash(r.payload) === r.contentHash;
}

export interface SnapshotRow {
  readonly id: string;
  readonly org_id: string;
  readonly kind: SnapshotKind;
  readonly purpose: OutputPurpose;
  readonly design_version_id: string;
  readonly design_version_status: RecordLifecycleStatus;
  readonly design_version_content_hash: Sha256;
  readonly construction_standard_version_id: string;
  readonly planning_standard_version_id: string;
  readonly edge_band_standard_version_id: string;
  readonly manufacturing_standard_version_id: string | null;
  readonly pricing_standard_version_id: string | null;
  readonly quotation_policy_version_id: string | null;
  readonly material_catalog_version_id: string;
  readonly finish_catalog_version_id: string;
  readonly hardware_catalog_version_id: string;
  readonly hettich_dataset_version_id: string;
  readonly appliance_catalog_version_id: string | null;
  readonly product_catalog_version_id: string;
  readonly engine_version: string;
  readonly input_hash: Sha256;
  readonly content_hash: Sha256;
  readonly engine_hash: string | null;
  readonly blocker_count: number;
  readonly payload: unknown;
  readonly data_classification: "PRODUCTION";
  readonly created_by: string;
  readonly created_at: string;
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
    construction_standard_version_id: p.constructionStandardVersionId,
    planning_standard_version_id: p.planningStandardVersionId,
    edge_band_standard_version_id: p.edgeBandStandardVersionId,
    manufacturing_standard_version_id: p.manufacturingStandardVersionId,
    pricing_standard_version_id: p.pricingStandardVersionId,
    quotation_policy_version_id: p.quotationPolicyVersionId,
    material_catalog_version_id: p.materialCatalogVersionId,
    finish_catalog_version_id: p.finishCatalogVersionId,
    hardware_catalog_version_id: p.hardwareCatalogVersionId,
    hettich_dataset_version_id: p.hettichDatasetVersionId,
    appliance_catalog_version_id: p.applianceCatalogVersionId,
    product_catalog_version_id: p.productCatalogVersionId,
    engine_version: p.engineVersion,
    input_hash: r.inputHash,
    content_hash: r.contentHash,
    engine_hash: r.engineHash,
    blocker_count: r.blockerCount,
    payload: r.payload,
    data_classification: r.dataClassification,
    created_by: r.createdBy,
    created_at: r.createdAt,
  };
}

export function snapshotFromRow(row: SnapshotRow): SnapshotRecord {
  return {
    snapshotId: row.id,
    kind: row.kind,
    purpose: row.purpose,
    provenance: {
      designVersionId: row.design_version_id,
      designVersionStatus: row.design_version_status,
      designVersionContentHash: row.design_version_content_hash,
      constructionStandardVersionId: row.construction_standard_version_id,
      planningStandardVersionId: row.planning_standard_version_id,
      edgeBandStandardVersionId: row.edge_band_standard_version_id,
      manufacturingStandardVersionId: row.manufacturing_standard_version_id,
      pricingStandardVersionId: row.pricing_standard_version_id,
      quotationPolicyVersionId: row.quotation_policy_version_id,
      materialCatalogVersionId: row.material_catalog_version_id,
      finishCatalogVersionId: row.finish_catalog_version_id,
      hardwareCatalogVersionId: row.hardware_catalog_version_id,
      hettichDatasetVersionId: row.hettich_dataset_version_id,
      applianceCatalogVersionId: row.appliance_catalog_version_id,
      productCatalogVersionId: row.product_catalog_version_id,
      engineVersion: row.engine_version,
    },
    inputHash: row.input_hash,
    contentHash: row.content_hash,
    engineHash: row.engine_hash,
    blockerCount: row.blocker_count,
    payload: row.payload,
    dataClassification: row.data_classification,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
