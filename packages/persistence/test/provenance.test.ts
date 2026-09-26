import { describe, expect, it } from "vitest";
import { LINTEL_CATALOG } from "@lintel/catalog-engine";
import type { DesignVersionPins, SnapshotKind } from "../src/index.js";
import {
  assembleCatalogSnapshot,
  buildSnapshotProvenance,
  buildSnapshotRecord,
  contentHash,
  designInputHash,
  MappingError,
  provenanceMismatches,
  snapshotFromRow,
  snapshotToRow,
  TestFixturePersistenceError,
  verifySnapshotRecord,
} from "../src/index.js";

const PINS: DesignVersionPins = {
  constructionStandardVersionId: "csv_1",
  planningStandardVersionId: "psv_1",
  edgeBandStandardVersionId: "ebv_1",
  manufacturingStandardVersionId: null,
  pricingStandardVersionId: "prv_1",
  quotationPolicyVersionId: "qpv_1",
  materialCatalogVersionId: "mcr_1",
  finishCatalogVersionId: "fcr_1",
  hardwareCatalogVersionId: "hcr_1",
  hettichDatasetVersionId: "hdv_1",
  applianceCatalogVersionId: null,
  productCatalogVersionId: "pcr_1",
};
const INPUT = contentHash("inputs");
const DV = { versionId: "dv_1", status: "APPROVED" as const, contentHash: contentHash("design version content") };
const T0 = "2026-09-26T10:00:00.000Z";

describe("snapshot provenance (requirement B)", () => {
  it("records every standard, catalog release, Hettich dataset and the engine version", () => {
    const p = buildSnapshotProvenance("QUOTATION", DV, PINS, "0.1.0+abc123");
    expect(p).toEqual({
      designVersionId: "dv_1",
      designVersionStatus: "APPROVED",
      designVersionContentHash: DV.contentHash,
      constructionStandardVersionId: "csv_1",
      planningStandardVersionId: "psv_1",
      edgeBandStandardVersionId: "ebv_1",
      manufacturingStandardVersionId: null,
      pricingStandardVersionId: "prv_1",
      quotationPolicyVersionId: "qpv_1",
      materialCatalogVersionId: "mcr_1",
      finishCatalogVersionId: "fcr_1",
      hardwareCatalogVersionId: "hcr_1",
      hettichDatasetVersionId: "hdv_1",
      applianceCatalogVersionId: null,
      productCatalogVersionId: "pcr_1",
      engineVersion: "0.1.0+abc123",
    });
  });
  it("pricing / finance / manufacturing references apply only where relevant", () => {
    const bom = buildSnapshotProvenance("BOM", DV, PINS, "e");
    expect([bom.pricingStandardVersionId, bom.quotationPolicyVersionId, bom.manufacturingStandardVersionId]).toEqual([null, null, null]);
    expect(buildSnapshotProvenance("PRICING", DV, PINS, "e").quotationPolicyVersionId).toBeNull();
    expect(() => buildSnapshotProvenance("PRICING", DV, { ...PINS, pricingStandardVersionId: null }, "e")).toThrow(MappingError);
    expect(() => buildSnapshotProvenance("QUOTATION", DV, { ...PINS, quotationPolicyVersionId: null }, "e")).toThrow(MappingError);
    expect(() => buildSnapshotProvenance("MANUFACTURING_DOCUMENT", DV, PINS, "e")).toThrow(MappingError);
  });
  it("provenance must equal the design version's pins", () => {
    const kinds: SnapshotKind[] = ["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING"];
    for (const k of kinds) expect(provenanceMismatches(buildSnapshotProvenance(k, DV, PINS, "e"), DV, PINS)).toEqual([]);
    const p = buildSnapshotProvenance("BOM", DV, PINS, "e");
    expect(provenanceMismatches(p, DV, { ...PINS, edgeBandStandardVersionId: "ebv_2" })).toEqual(["edgeBandStandardVersionId ebv_1 ≠ pinned ebv_2"]);
    expect(provenanceMismatches(p, { ...DV, versionId: "dv_2" }, PINS)).toEqual(["designVersionId dv_1 ≠ dv_2"]);
    expect(provenanceMismatches(p, { ...DV, contentHash: contentHash("edited") }, PINS)[0]).toContain("designVersionContentHash");
  });
});

describe("snapshot records", () => {
  const productionPayload = { trace: { dataClassification: "PRODUCTION", testFixtureSources: [] }, items: [{ qty: 2 }], contentHash: "0d8691345c4075" };
  it("are sealed with SHA-256, keep the engine hash and round-trip through rows", () => {
    const r = buildSnapshotRecord({ snapshotId: "snap_1", kind: "BOM", provenance: buildSnapshotProvenance("BOM", DV, PINS, "e"), inputHash: INPUT, payload: productionPayload, blockerCount: 26, createdBy: "u", createdAt: T0 });
    expect(r.contentHash).toBe(contentHash(productionPayload));
    expect(r.engineHash).toBe("0d8691345c4075");
    expect(verifySnapshotRecord(r)).toBe(true);
    expect(snapshotFromRow(snapshotToRow(r, { orgId: "org_lintel" }))).toEqual(r);
    expect(verifySnapshotRecord({ ...r, payload: { ...productionPayload, items: [{ qty: 3 }] } })).toBe(false);
  });
  it("refuses TEST_FIXTURE outputs", () => {
    const fixture = { trace: { dataClassification: "TEST_FIXTURE", testFixtureSources: ["construction standard TEST_FIXTURE_CONSTRUCTION_STANDARD"] } };
    expect(() => buildSnapshotRecord({ snapshotId: "s", kind: "BOM", provenance: buildSnapshotProvenance("BOM", DV, PINS, "e"), inputHash: INPUT, payload: fixture, blockerCount: 1, createdBy: "u", createdAt: T0 })).toThrow(
      TestFixturePersistenceError,
    );
  });
});

describe("design input hash", () => {
  const obj = (id: string, code: string) => ({
    id,
    org_id: "o",
    design_version_id: "dv",
    object_code: code,
    lineage_id: `lin_${code}`,
    object_type: "BASE_CABINET" as const,
    product_code: "KIT_BASE_STANDARD",
    product_version_id: "prv_1",
    x_mm: 0,
    y_mm: 0,
    z_mm: 0,
    rotation_y: 0 as const,
    width_mm: 600,
    height_mm: 720,
    depth_mm: 560,
    parameters: {},
    status: "DRAFT" as const,
  });
  const base = { roomRevision: { id: "rr_1", content_hash: INPUT }, overrides: [], pins: PINS };
  it("is independent of row ids and order (copy-on-write versions of the same content match)", () => {
    const a = designInputHash({ ...base, objects: [obj("r1", "A"), obj("r2", "B")] });
    expect(designInputHash({ ...base, objects: [obj("r9", "B"), obj("r8", "A")] })).toBe(a);
  });
  it("changes when a pin changes (e.g. a new EdgeBandStandard version)", () => {
    const a = designInputHash({ ...base, objects: [obj("r1", "A")] });
    expect(designInputHash({ ...base, pins: { ...PINS, edgeBandStandardVersionId: "ebv_2" }, objects: [obj("r1", "A")] })).not.toBe(a);
  });
});

describe("catalog assembly from pinned per-domain catalog versions", () => {
  const releases = (status: "APPROVED" | "DRAFT") => ({
    material: { catalogVersionId: "mcr_1", versionLabel: "2026.1", status, materials: [...LINTEL_CATALOG.materials].reverse(), edgeBands: LINTEL_CATALOG.edgeBands },
    finish: { catalogVersionId: "fcr_1", versionLabel: "2026.1", status: "APPROVED" as const, finishes: LINTEL_CATALOG.finishes },
    hardware: { catalogVersionId: "hcr_1", versionLabel: "2026.1", status: "APPROVED" as const, hardwareRuleSets: LINTEL_CATALOG.hardwareRuleSets },
    product: { catalogVersionId: "pcr_1", versionLabel: "2026.1", status: "APPROVED" as const, products: LINTEL_CATALOG.products, recipes: LINTEL_CATALOG.recipes },
  });
  it("is deterministic and contains exactly the pinned items", () => {
    const a = assembleCatalogSnapshot(releases("APPROVED"));
    expect(a.catalog.catalogVersion).toBe("MAT:2026.1|FIN:2026.1|HW:2026.1|PRD:2026.1");
    expect([...a.catalog.materials].map((m) => m.materialId)).toEqual([...LINTEL_CATALOG.materials].map((m) => m.materialId).sort());
    expect(assembleCatalogSnapshot(releases("APPROVED"))).toEqual(a);
    expect(a.problems).toEqual([]);
  });
  it("reports unapproved releases", () => {
    expect(assembleCatalogSnapshot(releases("DRAFT")).problems).toEqual(["material catalog version mcr_1 is DRAFT"]);
  });
});
