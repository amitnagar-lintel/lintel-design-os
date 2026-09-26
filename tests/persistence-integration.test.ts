/**
 * M5 step 2: persisting engine inputs and reading them back changes nothing the engines
 * compute, and fixture outputs can never be stored. No database is involved (rows only).
 */
import { describe, expect, it } from "vitest";
import { LINTEL_CATALOG, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT, LINTEL_PLANNING_STANDARD_DRAFT } from "@lintel/catalog-engine";
import { createHettichAdapter, HETTICH_PRODUCTION_DATASET } from "@lintel/hettich-engine";
import { resolveRoom } from "@lintel/design-engine";
import { generateRoomBom } from "@lintel/bom-engine";
import type { VersionMeta } from "@lintel/persistence";
import {
  NO_CHOSEN_VERSIONS,
  assembleCatalogSnapshot,
  buildSnapshotProvenance,
  buildSnapshotRecord,
  constructionStandardFromRows,
  constructionStandardToRows,
  contentHash,
  designObjectFromRow,
  designObjectToRow,
  edgeBandStandardFromRows,
  edgeBandStandardToRows,
  hettichDatasetFromRows,
  hettichDatasetToRows,
  planningStandardFromRows,
  planningStandardToRows,
  roomFromRows,
  roomToRows,
  TestFixturePersistenceError,
} from "@lintel/persistence";
import { DESIGN_VERSION } from "./support/scenario.js";
import { fixtureRoom, KITCHEN, lLayout, productionRoom } from "./support/room.js";

const CTX = { orgId: "org_lintel" };
const T0 = "2026-09-26T10:00:00.000Z";
const meta = (versionId: string): VersionMeta => ({
  entityId: `ent_${versionId}`,
  versionId,
  versionNumber: 1,
  status: "DRAFT",
  sourceRef: null,
  changeReason: "Initial version",
  createdBy: "user_author",
  createdAt: T0,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  effectiveFrom: null,
  lockedBy: null,
  lockedAt: null,
  supersededBy: null,
  supersededAt: null,
});

describe("rows → engine gives exactly the engine result of the original data", () => {
  it("production L-layout room: identical resolved room (108 BLOCKERs, still blocked)", () => {
    const direct = productionRoom();
    const r = roomToRows(KITCHEN, { revisionId: "rr_1", revisionNumber: 1, source: "survey", surveyedBy: "user_site", surveyedAt: T0 }, CTX);
    const objects = lLayout().map((o, i) => designObjectFromRow(designObjectToRow(o, { ...CTX, designVersionId: "dv_001", rowId: `row_${i}`, productVersionId: "prv_1" }), { projectId: KITCHEN.projectId, roomId: KITCHEN.id }));
    const viaRows = resolveRoom({
      designVersion: DESIGN_VERSION,
      room: roomFromRows(r.room, r.revision),
      objects,
      catalog: LINTEL_CATALOG,
      standard: constructionStandardFromRows(constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, meta("csv_1"), CTX)).value,
      edgeBandStandard: edgeBandStandardFromRows(edgeBandStandardToRows(LINTEL_EDGE_BAND_STANDARD_DRAFT, meta("ebv_1"), CTX)).value,
      planning: planningStandardFromRows(planningStandardToRows(LINTEL_PLANNING_STANDARD_DRAFT, meta("psv_1"), CTX)).value,
      adapters: [createHettichAdapter(hettichDatasetFromRows(hettichDatasetToRows(HETTICH_PRODUCTION_DATASET, meta("hdv_1"), CTX, "Hettich intake")).value)],
    });
    expect(viaRows).toEqual(direct);
    expect(viaRows.validation.counts.BLOCKER).toBe(108);
  });
  it("a catalog assembled from pinned releases resolves identically (apart from its release-based catalogVersion)", () => {
    const { catalog } = assembleCatalogSnapshot({
      material: { catalogVersionId: "mcr_1", versionLabel: "1", status: "DRAFT", materials: LINTEL_CATALOG.materials, edgeBands: LINTEL_CATALOG.edgeBands },
      finish: { catalogVersionId: "fcr_1", versionLabel: "1", status: "DRAFT", finishes: LINTEL_CATALOG.finishes },
      hardware: { catalogVersionId: "hcr_1", versionLabel: "1", status: "DRAFT", hardwareRuleSets: LINTEL_CATALOG.hardwareRuleSets },
      product: { catalogVersionId: "pcr_1", versionLabel: "1", status: "DRAFT", products: LINTEL_CATALOG.products, recipes: LINTEL_CATALOG.recipes },
    });
    const direct = productionRoom();
    const assembled = resolveRoom({
      designVersion: DESIGN_VERSION,
      room: KITCHEN,
      objects: lLayout(),
      catalog,
      standard: LINTEL_CONSTRUCTION_STANDARD_DRAFT,
      edgeBandStandard: LINTEL_EDGE_BAND_STANDARD_DRAFT,
      planning: LINTEL_PLANNING_STANDARD_DRAFT,
      adapters: [createHettichAdapter(HETTICH_PRODUCTION_DATASET)],
    });
    expect(assembled.cabinets.map((c) => c.components)).toEqual(direct.cabinets.map((c) => c.components));
    expect(assembled.validation.messages).toEqual(direct.validation.messages);
    expect(assembled.trace.catalogVersion).toBe("MAT:1|FIN:1|HW:1|PRD:1");
  });
});

describe("snapshots", () => {
  const PINS = {
    constructionStandardVersionId: "csv_1",
    planningStandardVersionId: "psv_1",
    edgeBandStandardVersionId: "ebv_1",
    materialCatalogVersionId: "mcr_1",
    finishCatalogVersionId: "fcr_1",
    hardwareCatalogVersionId: "hcr_1",
    hettichDatasetVersionId: "hdv_1",
    applianceCatalogVersionId: null,
    productCatalogVersionId: "pcr_1",
  };
  const hashes = Object.fromEntries(["construction_standard_version_id", "planning_standard_version_id", "edge_band_standard_version_id", "material_catalog_version_id",
    "finish_catalog_version_id", "hardware_catalog_version_id", "hettich_dataset_version_id", "product_catalog_version_id"].map((k) => [k, contentHash(k)]));
  const engine = { name: "bom" as const, version: "0.1.0", build: "0000000000000000000000000000000000000000", fingerprint: contentHash("bom engine"),
    closure: { packages: {}, externals: {}, entry: contentHash("entry"), runtime: "node-22" } };
  const provenanceOf = () => buildSnapshotProvenance("BOM", {
    designVersion: { versionId: "dv_001", status: "DRAFT", contentHash: contentHash("dv"), inputHash: contentHash("inputs"), inputRevision: 1 },
    pins: PINS, chosen: NO_CHOSEN_VERSIONS, dependencyHashes: hashes, validationRunId: "run_1", engine, sources: {},
  });
  it("a PRODUCTION room BOM (blocked) can be sealed with full provenance", () => {
    const room = productionRoom();
    const bom = generateRoomBom(room);
    const rec = buildSnapshotRecord({ snapshotId: "snap_1", kind: "BOM", purpose: "PRELIMINARY", provenance: provenanceOf(), payload: bom, blockerCount: room.validation.counts.BLOCKER, warningCount: 0, outputComplete: !bom.incomplete, validationBlockerCount: room.validation.counts.BLOCKER, createdBy: "u", createdAt: T0 });
    expect(rec.contentHash).toBe(contentHash(bom));
    expect(rec.provenance.pins.edgeBandStandardVersionId).toBe("ebv_1");
  });
  it("a TEST_FIXTURE room BOM is refused", () => {
    const bom = generateRoomBom(fixtureRoom());
    expect(() =>
      buildSnapshotRecord({ snapshotId: "snap_2", kind: "BOM", purpose: "PRELIMINARY", provenance: provenanceOf(), payload: bom, blockerCount: 1, warningCount: 0, outputComplete: true, validationBlockerCount: 1, createdBy: "u", createdAt: T0 }),
    ).toThrow(TestFixturePersistenceError);
  });
});
