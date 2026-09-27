import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { LINTEL_CATALOG } from "@lintel/catalog-engine";
import type { SnapshotKind } from "../src/index.js";
import {
  assembleCatalogSnapshot,
  buildSnapshotProvenance,
  buildSnapshotRecord,
  buildValidationRun,
  commercialInputHash,
  contentHash,
  dependencySetHash,
  designInputHash,
  engineeringDependencyHashes,
  fileManifestHash,
  MappingError,
  recordValidationRunArgs,
  snapshotFromRow,
  snapshotIdentity,
  snapshotToRow,
  TestFixturePersistenceError,
  verifySnapshotRecord,
} from "../src/index.js";
import { BUILD, chosenFor, engine, ENGINEERING_HASHES, hashesFor, INPUT, PINS, provenance, sourcesFor } from "./support/provenance.js";

const T0 = "2026-09-26T10:00:00.000Z";
const DV = { versionId: "dv_1", status: "APPROVED" as const, contentHash: contentHash("design version content"), inputHash: INPUT, inputRevision: 3 };
const KINDS: readonly SnapshotKind[] = ["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING", "MANUFACTURING_DOCUMENT"];
const sha = (t: string) => `sha256:${createHash("sha256").update(t, "utf8").digest("hex")}`;

describe("snapshot provenance (plan revision 4 §8)", () => {
  it("records the exact engineering binding, dependency content, validation evidence, engine and sources", () => {
    const p = provenance("QUOTATION");
    expect(p).toMatchObject({
      designVersionId: "dv_1", designVersionStatus: "APPROVED", inputHash: INPUT, inputRevision: 3, pins: PINS,
      chosen: { pricingStandardVersionId: "prv_1", quotationPolicyVersionId: "qpv_1", manufacturingStandardVersionId: null },
      validationRunId: "run_1", engine: { name: "quotation", version: "0.1.0", build: BUILD },
      sources: { boqSnapshotId: "boqSnapshotId_1", pricingSnapshotId: "pricingSnapshotId_1" },
    });
    expect(p.dependencySetHash).toBe(dependencySetHash(p.dependencyHashes));
    expect(p.commercialInputHash).toBe(commercialInputHash(p.chosen, p.dependencyHashes));
  });
  it("commercial and manufacturing versions are chosen per output and apply exactly where consumed", () => {
    for (const k of KINDS) expect([k, provenance(k).commercialInputHash === null]).toEqual([k, !(k === "PRICING" || k === "QUOTATION")]);
    const base = { designVersion: DV, pins: PINS, dependencyHashes: ENGINEERING_HASHES, validationRunId: "r", engine: engine("bom"), sources: {} };
    expect(() => buildSnapshotProvenance("BOM", { ...base, chosen: chosenFor("PRICING"), dependencyHashes: hashesFor(chosenFor("PRICING")) })).toThrow(/does not apply/);
    expect(() => buildSnapshotProvenance("PRICING", { ...base, chosen: chosenFor("BOM"), engine: engine("pricing"), sources: sourcesFor("PRICING") })).toThrow(/is required/);
  });
  it("dependency hashes cover exactly the consumed pins; sources exactly the consumed upstream kinds; the engine matches the kind", () => {
    const base = { designVersion: DV, pins: PINS, chosen: chosenFor("BOQ"), dependencyHashes: ENGINEERING_HASHES, validationRunId: "r", engine: engine("boq"), sources: sourcesFor("BOQ") };
    expect(() => buildSnapshotProvenance("BOQ", { ...base, dependencyHashes: { ...ENGINEERING_HASHES, pricing_standard_version_id: contentHash("pr") } })).toThrow(/cover exactly/);
    const missing = Object.fromEntries(Object.entries(ENGINEERING_HASHES).filter(([k]) => k !== "hettich_dataset_version_id"));
    expect(() => buildSnapshotProvenance("BOQ", { ...base, dependencyHashes: missing })).toThrow(/cover exactly/);
    expect(() => buildSnapshotProvenance("BOQ", { ...base, sources: {} })).toThrow(/requires bomSnapshotId/);
    expect(() => buildSnapshotProvenance("BOQ", { ...base, sources: { bomSnapshotId: "b", pricingSnapshotId: "p" } })).toThrow(/does not consume/);
    expect(() => buildSnapshotProvenance("BOQ", { ...base, engine: engine("bom") })).toThrow(/cannot produce/);
    expect(() => buildSnapshotProvenance("BOQ", { ...base, engine: { ...engine("boq"), build: "abc" } })).toThrow(/build identity/);
  });
  it("the canonical hash text forms are exactly the ones the database uses (migration 0017)", () => {
    expect(dependencySetHash({ b_pin: contentHash("b"), a_pin: contentHash("a") } as never)).toBe(sha(`a_pin=${contentHash("a")}\nb_pin=${contentHash("b")}`));
    expect(commercialInputHash({ pricingStandardVersionId: "p1", quotationPolicyVersionId: null }, { pricing_standard_version_id: contentHash("pr") }))
      .toBe(sha(`pricing_standard_version_id=p1:${contentHash("pr")}`));
    expect(commercialInputHash({ pricingStandardVersionId: null, quotationPolicyVersionId: null }, {})).toBeNull();
    expect(fileManifestHash([
      { sequence: 2, format: "SVG", sheetIndex: 0, checksum: contentHash("s"), byteSize: 9, contentType: "image/svg+xml" },
      { sequence: 1, format: "PDF", sheetIndex: null, checksum: contentHash("p"), byteSize: 7, contentType: "application/pdf" },
    ])).toBe(sha(`1|PDF||${contentHash("p")}|7|application/pdf\n2|SVG|0|${contentHash("s")}|9|image/svg+xml`));
    expect(engineeringDependencyHashes(hashesFor(chosenFor("QUOTATION")))).toEqual(ENGINEERING_HASHES);
  });
});

describe("snapshot records", () => {
  const productionPayload = { trace: { dataClassification: "PRODUCTION", testFixtureSources: [] }, items: [{ qty: 2 }], contentHash: "0d8691345c4075" };
  const rec = (kind: SnapshotKind, over: Partial<Parameters<typeof buildSnapshotRecord>[0]> = {}) => buildSnapshotRecord({
    snapshotId: "snap_1", kind, purpose: "PRELIMINARY", provenance: provenance(kind), payload: productionPayload, blockerCount: 26, warningCount: 1, outputComplete: true,
    validationBlockerCount: 26, createdBy: "u", createdAt: T0,
    ...(kind === "QUOTATION" ? { revisionNumber: 1 } : {}),
    ...(kind === "DRAWING"
      ? { drawing: { drawingType: "WALL_INTERNAL_ELEVATION" as const, wallId: "A" as const, objectLineageId: null, cutXMm: null, drawingNumber: "D-101", drawingRevision: "A", fileManifestHash: contentHash("files") } }
      : {}),
    ...over,
  });
  it("are sealed with SHA-256, keep the engine seal and round-trip through rows for every kind", () => {
    for (const k of KINDS) {
      const r = rec(k);
      expect(r.contentHash).toBe(contentHash(productionPayload));
      expect(r.engineSeal).toBe("0d8691345c4075");
      expect(verifySnapshotRecord(r)).toBe(true);
      expect(snapshotFromRow(snapshotToRow(r, { orgId: "org_lintel" }))).toEqual(r);
    }
    expect(verifySnapshotRecord({ ...rec("BOM"), payload: { ...productionPayload, items: [{ qty: 3 }] } })).toBe(false);
  });
  it("rows carry exactly the kind's own columns", () => {
    const keys = (k: SnapshotKind) => Object.keys(snapshotToRow(rec(k), { orgId: "o" }));
    expect(keys("BOM")).not.toContain("bom_snapshot_id");
    expect(keys("BOQ")).toContain("bom_snapshot_id");
    expect(keys("QUOTATION")).toEqual(expect.arrayContaining(["boq_snapshot_id", "pricing_snapshot_id", "revision_number"]));
    expect(keys("DRAWING")).toEqual(expect.arrayContaining(["drawing_type", "drawing_scope", "wall_id", "file_manifest_hash"]));
  });
  it("the natural identity is inputs, dependency content, engine, purpose, sources and drawing parameters, never the creation time", () => {
    const a = snapshotIdentity(snapshotToRow(rec("PRICING"), { orgId: "o" }));
    expect(snapshotIdentity(snapshotToRow(rec("PRICING", { snapshotId: "other", createdAt: "2027-01-01T00:00:00.000Z" }), { orgId: "o" }))).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(["bom_snapshot_id", "boq_snapshot_id", "commercial_input_hash", "dependency_set_hash", "design_version_id", "engine_fingerprint",
      "input_hash", "input_revision", "org_id", "purpose"]);
    expect(Object.keys(snapshotIdentity(snapshotToRow(rec("DRAWING"), { orgId: "o" })))).toEqual(expect.arrayContaining(["drawing_type", "wall_id", "object_lineage_id", "drawing_number", "drawing_revision"]));
  });
  it("FOR_PRODUCTION needs 0 BLOCKERs in the output and its validation evidence, and a complete output", () => {
    const prod = { purpose: "FOR_PRODUCTION" as const, blockerCount: 0, validationBlockerCount: 0 };
    expect(rec("BOM", prod).purpose).toBe("FOR_PRODUCTION");
    expect(() => rec("BOM", { ...prod, validationBlockerCount: 1 })).toThrow(/VALIDATION_BLOCKERS/);
    expect(() => rec("BOM", { ...prod, outputComplete: false })).toThrow(/complete output/);
    expect(() => rec("BOM", { ...prod, blockerCount: 2 })).toThrow(MappingError);
  });
  it("kind-specific fields apply exactly to their kind; drawing parameters are checked", () => {
    expect(() => rec("BOM", { revisionNumber: 1 })).toThrow(/revisionNumber/);
    const d = { drawingType: "FRONT_ELEVATION" as const, wallId: null, objectLineageId: "lin_1", cutXMm: null, drawingNumber: "D-1", drawingRevision: "A", fileManifestHash: contentHash("f") };
    expect(rec("DRAWING", { drawing: d }).drawing).toEqual(d);
    expect(() => rec("DRAWING", { drawing: { ...d, objectLineageId: null } })).toThrow(/objectLineageId/);
    expect(() => rec("DRAWING", { drawing: { ...d, cutXMm: 250 } })).toThrow(/cutXMm/);
    expect(() => rec("DRAWING", { drawing: { ...d, drawingNumber: "d 1" } })).toThrow(/drawing number/);
  });
  it("refuses TEST_FIXTURE outputs", () => {
    const fixture = { trace: { dataClassification: "TEST_FIXTURE", testFixtureSources: ["construction standard TEST_FIXTURE_CONSTRUCTION_STANDARD"] } };
    expect(() => rec("BOM", { payload: fixture })).toThrow(TestFixturePersistenceError);
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
    appliance: { catalogVersionId: "acr_1", versionLabel: "2026.1", status: "APPROVED" as const, appliances: LINTEL_CATALOG.appliances },
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

describe("validation runs (trust boundary)", () => {
  const validation = (blockers: number, fixture = false) => ({
    messages: [
      ...Array.from({ length: blockers }, (_, i) => ({ code: `B${i}`, severity: "BLOCKER" as const, message: "blocked" })),
      ...(fixture ? [{ code: "TEST_FIXTURE_DATA_IN_USE", severity: "BLOCKER" as const, message: "fixture" }] : []),
    ],
    counts: { INFO: 0, WARNING: 0, ERROR: 0, BLOCKER: blockers + (fixture ? 1 : 0) },
    canApprove: blockers === 0 && !fixture,
  });
  it("carries the purpose, the engine's own counts, the exact engine provenance and a SHA-256 of the result", () => {
    const e = engine("validation");
    for (const purpose of ["APPROVAL", "OUTPUT_GENERATION"] as const) {
      const r = buildValidationRun({ purpose, designVersionId: "dv_1", inputHash: INPUT, engine: e, validation: validation(2) });
      expect(r).toMatchObject({ purpose, designVersionId: "dv_1", inputHash: INPUT, engine: e, blockerCount: 2, warningCount: 0 });
      expect(r.contentHash).toBe(contentHash({ messages: validation(2).messages, counts: validation(2).counts }));
      expect(recordValidationRunArgs(r)).toEqual([purpose, "dv_1", INPUT, "validation", "0.1.0", BUILD, e.fingerprint, JSON.stringify(e.closure), 2, 0,
        JSON.stringify(validation(2).messages), r.contentHash]);
    }
  });
  it("requires a known purpose and the validation engine's provenance, and refuses results produced from TEST_FIXTURE inputs", () => {
    const base = { purpose: "APPROVAL" as const, designVersionId: "dv_1", inputHash: INPUT, engine: engine("validation"), validation: validation(0) };
    expect(() => buildValidationRun({ ...base, engine: engine("bom") })).toThrow(MappingError);
    expect(() => buildValidationRun({ ...base, engine: { ...engine("validation"), version: " " } })).toThrow(MappingError);
    for (const build of ["", " ", "abc", "-leading-dash", "has space in it"]) {
      expect(() => buildValidationRun({ ...base, engine: { ...engine("validation"), build } })).toThrow(MappingError);
    }
    expect(() => buildValidationRun({ ...base, purpose: "LATEST" as "APPROVAL" })).toThrow(MappingError);
    expect(() => buildValidationRun({ ...base, validation: validation(0, true) })).toThrow(TestFixturePersistenceError);
  });
});
