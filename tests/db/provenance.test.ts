/**
 * Snapshot provenance (requirement B), release immutability, FOR_PRODUCTION and TEST_FIXTURE safety (E).
 * Snapshots are built with @lintel/persistence exactly as the API will build them.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DesignVersionRow, SnapshotKind, SnapshotRecord, SnapshotRow } from "@lintel/persistence";
import { buildSnapshotProvenance, buildSnapshotRecord, contentHash, designVersionFromRow, snapshotFromRow, snapshotToRow } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attempt, insertRow, one, tx } from "./support/db.js";
import type { DesignFixture, World } from "./support/world.js";
import { approve, catalogVersion, createWorld, dependencies, designVersion, edgeBandStandard, hashOf, hettichDataset, materialItem, statusOf, transition } from "./support/world.js";

async function entityOf(c: Tx, table: string, id: string): Promise<string> {
  await actAs(c, null);
  return (await one<{ e: string }>(c, `SELECT entity_id AS e FROM design_os.${table} WHERE id = $1`, [id])).e;
}

const TABLE: Readonly<Record<SnapshotKind, string>> = {
  BOM: "bom_snapshot",
  BOQ: "boq_snapshot",
  PRICING: "pricing_snapshot",
  QUOTATION: "quotation_snapshot",
  DRAWING: "drawing_snapshot",
  MANUFACTURING_DOCUMENT: "manufacturing_document_snapshot",
};
const PAYLOAD = { trace: { dataClassification: "PRODUCTION", testFixtureSources: [] }, items: [{ qty: 2 }] };

async function snapshotFor(c: Tx, w: World, d: DesignFixture, kind: SnapshotKind, blockers = 0, payload: unknown = PAYLOAD): Promise<{ record: SnapshotRecord; row: SnapshotRow }> {
  await actAs(c, null);
  const dv = designVersionFromRow(await one<DesignVersionRow>(c, "SELECT * FROM design_os.design_version WHERE id = $1", [d.designVersionId]));
  const provenance = buildSnapshotProvenance(kind, { versionId: dv.envelope.versionId, status: dv.envelope.status, contentHash: dv.envelope.contentHash }, dv.pins, "0.1.0+test");
  const record = buildSnapshotRecord({ snapshotId: randomUUID(), kind, provenance, inputHash: dv.inputHash, payload, blockerCount: blockers, createdBy: w.users.DESIGNER, createdAt: "2026-09-26T10:00:00.000Z" });
  return { record, row: snapshotToRow(record, { orgId: w.org }) };
}

async function approvedDesign(c: Tx, w: World, d: DesignFixture): Promise<void> {
  await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
  await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "approved", await hashOf(c, "design", d.designVersionId));
}

describe("every snapshot records exact provenance", () => {
  it.each((["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING"] as const).map((k) => [k]))("%s: exact pins, input hash, engine version, content hash and design lifecycle", async (kind) => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const { record, row } = await snapshotFor(c, w, d, kind);
      await insertRow(c, TABLE[kind], row);
      const stored = await one<SnapshotRow & { purpose: string; created_at: string }>(c, `SELECT * FROM design_os.${TABLE[kind]} WHERE id = $1`, [record.snapshotId]);
      const rest: Record<string, unknown> = { ...stored };
      delete rest.purpose;
      const back = snapshotFromRow(rest as unknown as SnapshotRow);
      expect(back.provenance).toEqual(record.provenance);
      expect(back.contentHash).toBe(contentHash(PAYLOAD));
      expect(back.inputHash).toBe(d.inputHash);
      expect(back.provenance.designVersionStatus).toBe("DRAFT");
      expect(back.provenance.edgeBandStandardVersionId).not.toBeNull();
    });
  });
  it("a snapshot whose provenance differs from the design version is rejected", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      const { row } = await snapshotFor(c, w, d, "BOM");
      const cases: [Partial<SnapshotRow>, string][] = [
        [{ edge_band_standard_version_id: await edgeBandStandard(c, w, { entityId: await entityOf(c, "edge_band_standard_version", deps.pins.edge_band_standard_version_id), versionNumber: 2 }) }, "edge_band_standard_version_id ≠ pin"],
        [{ design_version_status: "APPROVED" }, "design_version_status APPROVED ≠ DRAFT"],
        [{ design_version_content_hash: contentHash("other") }, "design_version_content_hash differs"],
        [{ input_hash: contentHash("latest inputs") }, "input_hash differs"],
        [{ pricing_standard_version_id: deps.pins.pricing_standard_version_id }, "pricing_standard_version_id does not apply"],
      ];
      for (const [patch, message] of cases) {
        expect((await attempt(c, () => insertRow(c, "bom_snapshot", { ...row, id: randomUUID(), ...patch })))?.message).toContain(message);
      }
    });
  });
  it("snapshots are insert-only", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const { row } = await snapshotFor(c, w, d, "BOM");
      await insertRow(c, "bom_snapshot", row);
      expect((await attempt(c, () => c.query("UPDATE design_os.bom_snapshot SET blocker_count = 0 WHERE id = $1", [row.id])))?.message).toContain("insert-only");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.bom_snapshot WHERE id = $1", [row.id])))?.message).toContain("insert-only");
    });
  });
});

describe("a pinned version is never re-pointed by newer catalog versions (release immutability)", () => {
  it("publishing a newer material catalog version leaves the design's exact pins and membership unchanged", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      const { row } = await snapshotFor(c, w, d, "BOM");
      await insertRow(c, "bom_snapshot", row);
      const pinned = deps.pins.material_catalog_version_id;
      const membersBefore = (await c.query("SELECT * FROM design_os.material_catalog_version_material WHERE catalog_version_id = $1", [pinned])).rows;
      // A newer material item version and a newer catalog version that contains it.
      const material = deps.items.material;
      if (material === undefined) throw new Error("fixture");
      const newer = await materialItem(c, w, { entityId: material.entityId, versionNumber: 2 });
      await approve(c, w, "material", newer.versionId);
      const catalogEntity = (await one<{ e: string }>(c, "SELECT entity_id AS e FROM design_os.material_catalog_version WHERE id = $1", [pinned])).e;
      const newerCatalog = await catalogVersion(c, w, "material", [["material", material.entityId, newer.versionId]], { entityId: catalogEntity, versionNumber: 2 });
      await approve(c, w, "material_catalog", newerCatalog);
      await actAs(c, null);
      expect(await statusOf(c, "material_catalog", pinned)).toBe("SUPERSEDED");
      expect((await c.query("SELECT * FROM design_os.material_catalog_version_material WHERE catalog_version_id = $1", [pinned])).rows).toEqual(membersBefore);
      expect((await one<{ p: string }>(c, "SELECT material_catalog_version_id AS p FROM design_os.design_version WHERE id = $1", [d.designVersionId])).p).toBe(pinned);
      expect((await one<{ p: string }>(c, "SELECT material_catalog_version_id AS p FROM design_os.bom_snapshot WHERE id = $1", [row.id])).p).toBe(pinned);
      // Frozen membership: the superseded catalog version's content cannot change.
      expect((await attempt(c, () => c.query("DELETE FROM design_os.material_catalog_version_material WHERE catalog_version_id = $1", [pinned])))?.message).toContain("content is immutable");
    });
  });
  it("a design pin cannot be re-pointed once the design version leaves DRAFT", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      await actAs(c, null);
      const other = await catalogVersion(c, w, "material", [], { entityId: await entityOf(c, "material_catalog_version", deps.pins.material_catalog_version_id), versionNumber: 2 });
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.design_version SET material_catalog_version_id = $2 WHERE id = $1", [d.designVersionId, other])))?.message).toContain("content is immutable");
    });
  });
});

describe("FOR_PRODUCTION and issuing", () => {
  it("FOR_PRODUCTION requires an APPROVED or LOCKED design version and zero BLOCKERs", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const draft = await snapshotFor(c, w, d, "DRAWING");
      expect((await attempt(c, () => insertRow(c, "drawing_snapshot", { ...draft.row, purpose: "FOR_PRODUCTION" })))?.message).toContain("FOR_PRODUCTION requires an APPROVED or LOCKED design version");
      await approvedDesign(c, w, d);
      const blocked = await snapshotFor(c, w, d, "DRAWING", 3);
      expect((await attempt(c, () => insertRow(c, "drawing_snapshot", { ...blocked.row, purpose: "FOR_PRODUCTION" })))?.message).toContain("3 BLOCKER(s)");
      const ok = await snapshotFor(c, w, d, "DRAWING", 0);
      await insertRow(c, "drawing_snapshot", { ...ok.row, purpose: "FOR_PRODUCTION" });
    });
  });
  it("issuing a quotation requires a LOCKED design version and a snapshot of the locked content", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await approvedDesign(c, w, d);
      const q = await snapshotFor(c, w, d, "QUOTATION");
      await insertRow(c, "quotation_snapshot", q.row);
      const issue = { org_id: w.org, snapshot_id: q.row.id, issued_by: w.users.SALES, reason: "sent to client" };
      expect((await attempt(c, () => insertRow(c, "quotation_issue", issue)))?.message).toContain("issuing requires a LOCKED design version");
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "quotation issued");
      await insertRow(c, "quotation_issue", issue);
    });
  });
});

describe("TEST_FIXTURE and unverified data never enter production records", () => {
  it("a TEST_FIXTURE payload is refused by the database even if the application check were bypassed", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const { row } = await snapshotFor(c, w, d, "BOM");
      const fixture = { trace: { dataClassification: "TEST_FIXTURE" } };
      expect((await attempt(c, () => insertRow(c, "bom_snapshot", { ...row, payload: fixture, content_hash: contentHash(fixture) })))?.message).toContain("bom_snapshot_no_test_fixture");
      expect((await attempt(c, () => insertRow(c, "bom_snapshot", { ...row, data_classification: "TEST_FIXTURE" })))?.message).toContain("check constraint");
    });
  });
  it("versioned records can only be classified PRODUCTION", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await hettichDataset(c, w);
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.hettich_dataset_version SET data_classification = 'TEST_FIXTURE' WHERE id = $1", [id])))?.message).toContain("production_only");
    });
  });
  it("an unverified Hettich record blocks approval of its dataset version", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await hettichDataset(c, w);
      await actAs(c, null);
      await insertRow(c, "hettich_article", {
        org_id: w.org, version_id: id, position: 0, record_code: "REC-1", article_number: null, product_family: null, series: null, category: null, description: null,
        exact_application: { description: null, application: null, mounting: null }, dimensions: null,
        compatibility: { doorThicknessRange: null, openingAngle: null, compatibleArticles: null, notes: null }, drilling: { patternId: null, holes: null, source: null },
        installation: { guide: null, notes: null }, adjustment: { ranges: null, notes: null }, accessories: null, cad_reference: null,
        source_ref: { url: null, sourceDate: null, documentTitle: null, documentVersion: null }, licence_status: "UNKNOWN", licence_usage_notes: null, verified_by: null, verified_at: null, preference_rank: null,
      });
      await transition(c, w, "PROCUREMENT", "hettich_dataset", id, "SUBMIT");
      expect((await attempt(c, async () => transition(c, w, "PRODUCTION", "hettich_dataset", id, "APPROVE", "x", await hashOf(c, "hettich_dataset", id))))?.message).toContain("Hettich record REC-1 is not source-verified");
    });
  });
});
