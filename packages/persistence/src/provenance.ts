import { MappingError } from "./errors.js";
import { assertNoTestFixture } from "./fixture-guard.js";
import type { Sha256 } from "./hash.js";
import { contentHash } from "./hash.js";
import type { MapContext } from "./mappers/common.js";
import type { DesignVersionPins } from "./mappers/design.js";

export type SnapshotKind = "BOM" | "BOQ" | "PRICING" | "QUOTATION" | "DRAWING" | "MANUFACTURING_DOCUMENT";

/**
 * What every generated output records (M5 §6, requirement B). Copied from the DesignVersion
 * pins at generation time; `null` only where the standard does not apply to that output.
 */
export interface SnapshotProvenance {
  readonly designVersionId: string;
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
  readonly productCatalogReleaseId: string;
  readonly engineVersion: string;
}

const USES_PRICING = new Set<SnapshotKind>(["PRICING", "QUOTATION"]);

export function buildSnapshotProvenance(kind: SnapshotKind, designVersionId: string, pins: DesignVersionPins, engineVersion: string): SnapshotProvenance {
  const need = (value: string | null, name: string): string => {
    if (value === null) throw new MappingError(`${kind} snapshot requires the design version to pin ${name}`);
    return value;
  };
  if (engineVersion.trim() === "") throw new MappingError("engine version is required");
  return {
    designVersionId,
    constructionStandardVersionId: pins.constructionStandardVersionId,
    planningStandardVersionId: pins.planningStandardVersionId,
    edgeBandStandardVersionId: pins.edgeBandStandardVersionId,
    manufacturingStandardVersionId: kind === "MANUFACTURING_DOCUMENT" ? need(pins.manufacturingStandardVersionId, "a ManufacturingStandard version") : null,
    pricingStandardVersionId: USES_PRICING.has(kind) ? need(pins.pricingStandardVersionId, "a PricingStandard version") : null,
    quotationPolicyVersionId: kind === "QUOTATION" ? need(pins.quotationPolicyVersionId, "a Finance/QuotationPolicy version") : null,
    materialCatalogReleaseId: pins.materialCatalogReleaseId,
    finishCatalogReleaseId: pins.finishCatalogReleaseId,
    hardwareCatalogReleaseId: pins.hardwareCatalogReleaseId,
    hettichDatasetVersionId: pins.hettichDatasetVersionId,
    productCatalogReleaseId: pins.productCatalogReleaseId,
    engineVersion,
  };
}

/** Every recorded provenance reference must equal the design version's pin (the database re-checks this). */
export function provenanceMismatches(p: SnapshotProvenance, designVersionId: string, pins: DesignVersionPins): string[] {
  const out: string[] = [];
  if (p.designVersionId !== designVersionId) out.push(`designVersionId ${p.designVersionId} ≠ ${designVersionId}`);
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
 * the content hash is computed here, never accepted from a caller.
 */
export function buildSnapshotRecord(input: {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly provenance: SnapshotProvenance;
  readonly inputHash: Sha256;
  readonly payload: unknown;
  readonly blockerCount: number;
  readonly createdBy: string;
  readonly createdAt: string;
}): SnapshotRecord {
  assertNoTestFixture(`${input.kind} snapshot ${input.snapshotId}`, input.payload);
  if (!Number.isInteger(input.blockerCount) || input.blockerCount < 0) throw new MappingError("blockerCount must be a non-negative integer");
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
  readonly design_version_id: string;
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
  readonly product_catalog_release_id: string;
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
    design_version_id: p.designVersionId,
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
    product_catalog_release_id: p.productCatalogReleaseId,
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
    provenance: {
      designVersionId: row.design_version_id,
      constructionStandardVersionId: row.construction_standard_version_id,
      planningStandardVersionId: row.planning_standard_version_id,
      edgeBandStandardVersionId: row.edge_band_standard_version_id,
      manufacturingStandardVersionId: row.manufacturing_standard_version_id,
      pricingStandardVersionId: row.pricing_standard_version_id,
      quotationPolicyVersionId: row.quotation_policy_version_id,
      materialCatalogReleaseId: row.material_catalog_release_id,
      finishCatalogReleaseId: row.finish_catalog_release_id,
      hardwareCatalogReleaseId: row.hardware_catalog_release_id,
      hettichDatasetVersionId: row.hettich_dataset_version_id,
      productCatalogReleaseId: row.product_catalog_release_id,
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
