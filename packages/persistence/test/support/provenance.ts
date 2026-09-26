/** Shared builders for persistence tests: 9 engineering pins, per-engine provenance, dependency hashes. */
import type { ChosenVersions, DependencyHashes, DesignVersionPins, EngineName, EngineProvenance, RecordLifecycleStatus, SnapshotKind, SnapshotProvenance, SnapshotSources } from "../../src/index.js";
import { buildSnapshotProvenance, contentHash, ENGINE_OF_KIND, NO_CHOSEN_VERSIONS, SOURCES_OF_KIND } from "../../src/index.js";

export const PINS: DesignVersionPins = {
  constructionStandardVersionId: "csv_1", planningStandardVersionId: "psv_1", edgeBandStandardVersionId: "ebv_1", materialCatalogVersionId: "mcr_1",
  finishCatalogVersionId: "fcr_1", hardwareCatalogVersionId: "hcr_1", hettichDatasetVersionId: "hdv_1", applianceCatalogVersionId: null, productCatalogVersionId: "pcr_1",
};
export const BUILD = "3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a90";
export const INPUT = contentHash("inputs");

export function engine(name: EngineName, fingerprintSeed = "v1"): EngineProvenance {
  return {
    name, version: "0.1.0", build: BUILD, fingerprint: contentHash({ name, fingerprintSeed }),
    closure: { packages: { [`@lintel/${name}-engine`]: contentHash(`${name}-src`) }, externals: {}, entry: contentHash(`${name}-entry`), runtime: "node-22" },
  };
}

export const ENGINEERING_HASHES: DependencyHashes = {
  construction_standard_version_id: contentHash("cs"), planning_standard_version_id: contentHash("ps"), edge_band_standard_version_id: contentHash("eb"),
  material_catalog_version_id: contentHash("mc"), finish_catalog_version_id: contentHash("fc"), hardware_catalog_version_id: contentHash("hc"),
  product_catalog_version_id: contentHash("pc"), hettich_dataset_version_id: contentHash("hd"),
};

export function chosenFor(kind: SnapshotKind): ChosenVersions {
  return {
    ...NO_CHOSEN_VERSIONS,
    ...(kind === "PRICING" || kind === "QUOTATION" ? { pricingStandardVersionId: "prv_1" } : {}),
    ...(kind === "QUOTATION" ? { quotationPolicyVersionId: "qpv_1" } : {}),
    ...(kind === "MANUFACTURING_DOCUMENT" ? { manufacturingStandardVersionId: "msv_1" } : {}),
  };
}

export function hashesFor(chosen: ChosenVersions): DependencyHashes {
  return {
    ...ENGINEERING_HASHES,
    ...(chosen.pricingStandardVersionId === null ? {} : { pricing_standard_version_id: contentHash("pr") }),
    ...(chosen.quotationPolicyVersionId === null ? {} : { quotation_policy_version_id: contentHash("qp") }),
    ...(chosen.manufacturingStandardVersionId === null ? {} : { manufacturing_standard_version_id: contentHash("ms") }),
  };
}

export function sourcesFor(kind: SnapshotKind): SnapshotSources {
  return Object.fromEntries(SOURCES_OF_KIND[kind].map((k) => [k, `${k}_1`]));
}

export function provenance(kind: SnapshotKind, status: RecordLifecycleStatus = "APPROVED"): SnapshotProvenance {
  const chosen = chosenFor(kind);
  return buildSnapshotProvenance(kind, {
    designVersion: { versionId: "dv_1", status, contentHash: contentHash("design version content"), inputHash: INPUT, inputRevision: 3 },
    pins: PINS, chosen, dependencyHashes: hashesFor(chosen), validationRunId: "run_1", engine: engine(ENGINE_OF_KIND[kind]), sources: sourcesFor(kind),
  });
}
