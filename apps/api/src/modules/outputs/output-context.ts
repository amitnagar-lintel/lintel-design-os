import type {
  ChosenVersions, DependencyHashes, DependencyPin, DesignVersionPins, DesignVersionRef, EngineName, EngineProvenance, PricingStandardRows, QuotationPolicyRows,
  Sha256, SnapshotKind,
} from "@lintel/persistence";
import { COMMERCIAL_PINS, dependencySetHash, engineeringDependencyHashes, pinsFromColumns } from "@lintel/persistence";
import type { CatalogSnapshot, DesignVersion, ResolvedRoom } from "@lintel/types";
import { deepFreeze } from "@lintel/types";
import type { Tx } from "../../common/db/tx.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import type { EngineManifest } from "../../infrastructure/engines/engine-manifest.js";
import { engineProvenance } from "../../infrastructure/engines/engine-manifest.js";
import { designInputsRepository } from "../../infrastructure/persistence/design-inputs.repository.js";
import type { DesignVersionRow } from "../../infrastructure/persistence/design-versions.repository.js";
import { designVersionsRepository } from "../../infrastructure/persistence/design-versions.repository.js";
import { outputsRepository } from "../../infrastructure/persistence/outputs.repository.js";
import { roomsRepository } from "../../infrastructure/persistence/rooms.repository.js";
import { computeInputHash } from "../design-versions/design-content.js";
import type { EngineeringRows } from "./engines/validation.js";
import { engineeringModel, resolveEngineeringModel } from "./engines/validation.js";

/** The output kinds generated at Step 7 checkpoint 2 (drawings follow at checkpoint 3; manufacturing is deferred). */
export type OutputKind = Extract<SnapshotKind, "BOM" | "BOQ" | "PRICING" | "QUOTATION" | "DRAWING">;
export type OutputEngine = Extract<EngineName, "validation" | "bom" | "boq" | "pricing" | "quotation" | "drawing">;
const OUTPUT_ENGINES: readonly OutputEngine[] = ["validation", "bom", "boq", "pricing", "quotation", "drawing"];

/** The exact commercial versions a request names (never a design pin, never "latest"). */
export interface CommercialChoice {
  readonly pricingStandardVersionId: string | null;
  readonly quotationPolicyVersionId: string | null;
}

/**
 * One output-generation request's immutable execution context (Step 6 plan revision 4 §7.2, Clarification A): the exact
 * engineering inputs read once, the explicitly chosen commercial versions, the room resolved ONCE, and the running
 * engines' identities. The OUTPUT_GENERATION validation run and every output generated in the request (the requested
 * one and any upstream one) are derived from this one object; nothing re-reads or re-resolves after it is built.
 */
export interface OutputExecutionContext {
  readonly orgId: string;
  readonly actorId: string;
  /** Transaction timestamp (UTC ISO): every engine's `createdAt` in this request. */
  readonly createdAt: string;
  readonly version: DesignVersionRow;
  readonly ref: DesignVersionRef;
  readonly pins: DesignVersionPins;
  readonly engineering: {
    readonly rows: EngineeringRows;
    /** Content hashes of the exact engineering versions (computed by the database). */
    readonly dependencyHashes: DependencyHashes;
    readonly dependencySetHash: Sha256;
  };
  readonly commercial: {
    readonly chosen: ChosenVersions;
    /** Content hashes of the chosen commercial versions only. */
    readonly dependencyHashes: DependencyHashes;
    readonly pricingStandard: PricingStandardRows | null;
    readonly quotationPolicy: QuotationPolicyRows | null;
  };
  readonly catalog: CatalogSnapshot;
  /** The design version as the engines see it (mapped once from the same row; drawings apply their guard to it). */
  readonly designVersion: DesignVersion;
  /** Drawing title-block facts from records (never from the request): project code, room, designer, checker. */
  readonly records: { readonly projectCode: string; readonly roomName: string; readonly designer: string; readonly checker: string };
  /** `resolveRoom` of exactly these inputs, computed once; its `validation` is the OUTPUT_GENERATION evidence. */
  readonly resolved: ResolvedRoom;
  readonly engines: Readonly<Record<OutputEngine, EngineProvenance>>;
}

/** The running engines' identities (fingerprint from the manifest built for this code; build from the deployment). */
export function outputEngines(manifest: EngineManifest, build: string): Readonly<Record<OutputEngine, EngineProvenance>> {
  return Object.fromEntries(OUTPUT_ENGINES.map((name) => [name, engineProvenance(manifest, name, build)])) as Record<OutputEngine, EngineProvenance>;
}

/**
 * Build the context inside the caller's REPEATABLE READ transaction: every row is read from the transaction's one
 * snapshot, and the stored input hash must equal the hash of the rows actually read. The design version row is not
 * locked here (a caller-side FOR SHARE is subject to the UPDATE policy, which output roles do not pass): before the
 * first write, design_os.record_validation_run() takes FOR SHARE on it, so a concurrent input change either fails that
 * lock (REPEATABLE READ → 409 CONCURRENT_MODIFICATION) or waits for this transaction to commit.
 */
export async function buildOutputExecutionContext(tx: Tx, input: {
  readonly orgId: string;
  readonly actorId: string;
  readonly versionId: string;
  readonly commercial: CommercialChoice;
  readonly engines: Readonly<Record<OutputEngine, EngineProvenance>>;
}): Promise<OutputExecutionContext> {
  const v = await designVersionsRepository.get(tx, input.versionId);
  if (v === null) throw new ApiProblem("NOT_FOUND");
  if (!(await outputsRepository.hasPermission(tx, "reference.read"))) throw new ApiProblem("PERMISSION_DENIED", "output generation reads the pinned reference data (reference.read)");
  const { inputHash, objects, overrides } = await computeInputHash(tx, v);
  if (inputHash !== v.input_hash) throw new ApiProblem("VALIDATION_INPUT_MISMATCH", "the stored input hash does not match the stored inputs");
  const revision = await roomsRepository.revision(tx, v.room_revision_id);
  const room = revision === null ? null : await roomsRepository.get(tx, revision.room_id);
  if (revision === null || room === null) throw new ApiProblem("INTERNAL", "room survey not readable");
  const pins = pinsFromColumns(v as Parameters<typeof pinsFromColumns>[0]);
  const pinned = await designInputsRepository.pinned(tx, {
    construction_standard_version_id: pins.constructionStandardVersionId, planning_standard_version_id: pins.planningStandardVersionId,
    edge_band_standard_version_id: pins.edgeBandStandardVersionId, material_catalog_version_id: pins.materialCatalogVersionId,
    finish_catalog_version_id: pins.finishCatalogVersionId, hardware_catalog_version_id: pins.hardwareCatalogVersionId,
    product_catalog_version_id: pins.productCatalogVersionId, hettich_dataset_version_id: pins.hettichDatasetVersionId,
  });

  // Dependency content: engineering pins + exactly the chosen commercial versions of this organization.
  const { pricingStandardVersionId, quotationPolicyVersionId } = input.commercial;
  const all = await outputsRepository.dependencyHashes(tx, v.id, pricingStandardVersionId, quotationPolicyVersionId) as DependencyHashes;
  const missing = [
    ...(pricingStandardVersionId !== null && all.pricing_standard_version_id === undefined ? ["pricingStandardVersionId"] : []),
    ...(quotationPolicyVersionId !== null && all.quotation_policy_version_id === undefined ? ["quotationPolicyVersionId"] : []),
  ];
  if (missing.length > 0) {
    throw new ApiProblem("COMMERCIAL_VERSION_NOT_FOUND", undefined, { errors: missing.map((m) => ({ path: `body.${m}`, code: "not_found", message: "no such version in this organization" })) });
  }
  const commercialRows = await designInputsRepository.commercial(tx, pricingStandardVersionId, quotationPolicyVersionId);
  const engineeringHashes = engineeringDependencyHashes(all);
  const commercialHashes = Object.fromEntries(Object.entries(all).filter(([k]) => COMMERCIAL_PINS.includes(k as DependencyPin))) as DependencyHashes;

  const rows: EngineeringRows = { version: v, room, revision, objects, overrides, pinned };
  const model = engineeringModel(rows);
  const resolved = resolveEngineeringModel(model);
  const createdAt = await outputsRepository.now(tx);
  const people = await outputsRepository.titleBlockRecords(tx, v.id);

  return deepFreeze({
    orgId: input.orgId,
    actorId: input.actorId,
    createdAt,
    version: v,
    ref: { versionId: v.id, status: v.status, contentHash: v.content_hash as Sha256, inputHash, inputRevision: v.input_revision },
    pins,
    engineering: { rows, dependencyHashes: engineeringHashes, dependencySetHash: dependencySetHash(engineeringHashes) },
    commercial: {
      chosen: { pricingStandardVersionId, quotationPolicyVersionId, manufacturingStandardVersionId: null },
      dependencyHashes: commercialHashes,
      pricingStandard: commercialRows.pricingStandard as unknown as PricingStandardRows | null,
      quotationPolicy: commercialRows.quotationPolicy as unknown as QuotationPolicyRows | null,
    },
    catalog: model.catalog,
    designVersion: model.input.designVersion,
    records: { projectCode: people.project_code, roomName: room.name, designer: people.designer, checker: people.checker ?? "-" },
    resolved,
    engines: input.engines,
  });
}
