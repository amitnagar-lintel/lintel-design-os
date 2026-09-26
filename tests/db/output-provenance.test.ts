/**
 * Migration 0017: exact output provenance. Dependency content hashes are computed by the database (one definition,
 * DRAFT child-row changes included, tenant-scoped); snapshots bind the exact engineering inputs, dependency content,
 * chosen commercial versions, validation evidence and per-engine provenance; natural identity; sealed drawing files.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DependencyHashes } from "@lintel/persistence";
import { contentHash, dependencySetHash, fileManifestHash } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attemptDb, insertRow, one, tx } from "./support/db.js";
import type { World } from "./support/world.js";
import { createWorld, dependencies, designVersion, hashOf, outputChainRow, outputSnapshotRow, pricingStandard, transition } from "./support/world.js";

const hashes = async (c: Tx, w: World, dv: string): Promise<DependencyHashes> => {
  await actAs(c, null);
  return (await one<{ h: DependencyHashes }>(c, "SELECT design_os.engineering_dependency_hashes($1, $2) AS h", [w.org, dv])).h;
};

describe("dependency content hashes (design_os.version_content_hash)", () => {
  it("cover the 9 engineering pins exactly, and agree with the TypeScript dependency-set hash", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      const h = await hashes(c, w, d.designVersionId);
      expect(Object.keys(h).sort()).toEqual(["construction_standard_version_id", "edge_band_standard_version_id", "finish_catalog_version_id", "hardware_catalog_version_id",
        "hettich_dataset_version_id", "material_catalog_version_id", "planning_standard_version_id", "product_catalog_version_id"]);
      const sql = await one<{ s: string }>(c, "SELECT design_os.dependency_set_hash($1::jsonb) AS s", [JSON.stringify(h)]);
      expect(sql.s).toBe(dependencySetHash(h));
      expect(await hashes(c, w, d.designVersionId)).toEqual(h);
    });
  });
  it("change when a DRAFT dependency's own content or child rows change, and recursively through catalog members; lifecycle changes are not content", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w, { approveAll: false });
      const d = await designVersion(c, w, deps, { withRun: false });
      const before = await hashes(c, w, d.designVersionId);
      // A child row of the DRAFT construction standard.
      await c.query("UPDATE design_os.construction_standard_value SET note = 'edited in draft' WHERE version_id = $1 AND variable_code = (SELECT min(variable_code) FROM design_os.construction_standard_value WHERE version_id = $1)",
        [deps.pins.construction_standard_version_id]);
      const afterChild = await hashes(c, w, d.designVersionId);
      expect(afterChild.construction_standard_version_id).not.toBe(before.construction_standard_version_id);
      expect({ ...afterChild, construction_standard_version_id: null }).toEqual({ ...before, construction_standard_version_id: null });
      // A member item version of the DRAFT material catalog (recursion).
      await c.query("UPDATE design_os.material_version SET change_reason = 'edited in draft' WHERE id = $1", [deps.items.material?.versionId]);
      expect((await hashes(c, w, d.designVersionId)).material_catalog_version_id).not.toBe(before.material_catalog_version_id);
      // Lifecycle (SUBMIT) is not content: the hash of the planning standard is unchanged.
      const planning = (await hashes(c, w, d.designVersionId)).planning_standard_version_id;
      await transition(c, w, "PRODUCTION", "planning_standard", deps.pins.planning_standard_version_id, "SUBMIT");
      expect((await hashes(c, w, d.designVersionId)).planning_standard_version_id).toBe(planning);
    });
  });
  it("do not depend on the caller's session time zone", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const utc = await hashes(c, w, d.designVersionId);
      await c.query("SET LOCAL timezone = 'Asia/Kolkata'");
      expect(await hashes(c, w, d.designVersionId)).toEqual(utc);
    });
  });
  it("are tenant-scoped: another organization sees nothing, and the internal hash functions are not callable by the API role", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const deps = await dependencies(c, w, { commercial: "draft" });
      const d = await designVersion(c, w, deps);
      await actAs(c, other.actor("DESIGNER"), { apiRole: true });
      expect((await attemptDb(c, () => c.query("SELECT design_os.output_dependency_hashes($1, NULL, NULL)", [d.designVersionId])))?.code).toBe("LD005");
      expect((await attemptDb(c, () => c.query("SELECT design_os.version_content_hash('pricing_standard', $1, $2)", [deps.commercial.pricing_standard_version_id, w.org])))?.code).toBe("42501");
      expect((await attemptDb(c, () => c.query("SELECT design_os.engineering_dependency_hashes($1, $2)", [w.org, d.designVersionId])))?.code).toBe("42501");
      // The owner of the design sees its hashes; a foreign commercial version is simply absent.
      await actAs(c, null);
      const foreignPricing = await pricingStandard(c, other);
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      const own = (await one<{ h: Record<string, string> }>(c, "SELECT design_os.output_dependency_hashes($1, $2, NULL) AS h", [d.designVersionId, deps.commercial.pricing_standard_version_id])).h;
      expect(own.pricing_standard_version_id).toMatch(/^sha256:/);
      const foreign = (await one<{ h: Record<string, string> }>(c, "SELECT design_os.output_dependency_hashes($1, $2, NULL) AS h", [d.designVersionId, foreignPricing])).h;
      expect(foreign.pricing_standard_version_id).toBeUndefined();
    });
  });
});

describe("snapshots bind exact provenance", () => {
  it("a snapshot built on DRAFT dependencies is refused once their content changed (dependency hashes are recomputed at insert)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w, { approveAll: false });
      const d = await designVersion(c, w, deps, { withRun: false });
      const row = await outputSnapshotRow(c, w, d.designVersionId, "BOM");
      await c.query("UPDATE design_os.construction_standard_value SET note = 'changed' WHERE version_id = $1", [deps.pins.construction_standard_version_id]);
      const err = await attemptDb(c, () => insertRow(c, "bom_snapshot", row));
      expect(err?.code).toBe("LD016");
      expect(err?.message).toContain("dependency_hashes differ");
    });
  });
  it("commercial versions are chosen per output: two PricingStandard versions give two pricing snapshots on the same BOM / BOQ, no new design version", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w, { commercial: "draft" });
      const d = await designVersion(c, w, deps);
      const v3 = await outputChainRow(c, w, d.designVersionId, "PRICING", deps.commercial);
      await actAs(c, null);
      await insertRow(c, "pricing_snapshot", v3);
      const pricingEntity = (await one<{ e: string }>(c, "SELECT entity_id AS e FROM design_os.pricing_standard_version WHERE id = $1", [deps.commercial.pricing_standard_version_id])).e;
      const v4 = await pricingStandard(c, w, { entityId: pricingEntity, versionNumber: 2 });
      const b = await outputSnapshotRow(c, w, d.designVersionId, "PRICING", {
        sources: { bomSnapshotId: String(v3.bom_snapshot_id), boqSnapshotId: String(v3.boq_snapshot_id) }, chosen: { pricingStandardVersionId: v4 },
      });
      await actAs(c, null);
      await insertRow(c, "pricing_snapshot", b);
      expect([b.bom_snapshot_id, b.boq_snapshot_id]).toEqual([v3.bom_snapshot_id, v3.boq_snapshot_id]);
      expect(b.commercial_input_hash).not.toBe(v3.commercial_input_hash);
      expect((await one<{ n: number }>(c, "SELECT count(*)::int AS n FROM design_os.design_version WHERE entity_id = $1", [d.designId])).n).toBe(1);
      // A quotation must use a pricing snapshot of the same PricingStandard (LD025 otherwise).
      const q = await outputSnapshotRow(c, w, d.designVersionId, "QUOTATION", {
        sources: { boqSnapshotId: String(v3.boq_snapshot_id), pricingSnapshotId: String(v3.id) },
        chosen: { pricingStandardVersionId: v4, quotationPolicyVersionId: deps.commercial.quotation_policy_version_id },
      });
      await actAs(c, null);
      expect((await attemptDb(c, () => insertRow(c, "quotation_snapshot", q)))?.code).toBe("LD025");
    });
  });
  it("a chosen commercial version of another organization is refused", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const deps = await dependencies(c, w, { commercial: "draft" });
      const d = await designVersion(c, w, deps);
      const row = await outputChainRow(c, w, d.designVersionId, "PRICING", deps.commercial);
      const foreign = await pricingStandard(c, other);
      await actAs(c, null);
      const err = await attemptDb(c, () => insertRow(c, "pricing_snapshot", { ...row, pricing_standard_version_id: foreign }));
      expect(err?.code).toBe("LD016");
    });
  });
  it("FOR_PRODUCTION pricing needs APPROVED / LOCKED commercial versions (LD021)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w, { commercial: "draft" });
      const d = await designVersion(c, w, deps);
      await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "ok", await hashOf(c, "design", d.designVersionId));
      const row = await outputChainRow(c, w, d.designVersionId, "PRICING", deps.commercial, { purpose: "FOR_PRODUCTION" });
      await actAs(c, null);
      const err = await attemptDb(c, () => insertRow(c, "pricing_snapshot", row));
      expect(err?.code).toBe("LD021");
      expect(err?.message).toContain("commercial / manufacturing versions");
    });
  });
  it("the validation evidence must be an OUTPUT_GENERATION run of exactly these engineering inputs", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const row = await outputSnapshotRow(c, w, d.designVersionId, "BOM");
      await actAs(c, null);
      const approvalRun = (await one<{ id: string }>(c, "SELECT id FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'APPROVAL' LIMIT 1", [d.designVersionId])).id;
      const err = await attemptDb(c, () => insertRow(c, "bom_snapshot", { ...row, validation_run_id: approvalRun }));
      expect([err?.code, err?.message.includes("OUTPUT_GENERATION run of exactly these engineering inputs")]).toEqual(["LD016", true]);
    });
  });
});

describe("snapshot natural identity", () => {
  it("the same inputs, dependency content, engine, purpose and sources are one output; any of them differing is another", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const a = await outputSnapshotRow(c, w, d.designVersionId, "BOM");
      await actAs(c, null);
      await insertRow(c, "bom_snapshot", a);
      const dup = await attemptDb(c, () => insertRow(c, "bom_snapshot", { ...a, id: randomUUID(), created_at: "2027-01-01T00:00:00Z" }));
      expect([dup?.code, dup?.constraint]).toEqual(["23505", "bom_snapshot_identity"]);
      const otherEngine = await outputSnapshotRow(c, w, d.designVersionId, "BOM", { engineSeed: "another engine build" });
      await actAs(c, null);
      await insertRow(c, "bom_snapshot", otherEngine);
      expect(otherEngine.engine_fingerprint).not.toBe(a.engine_fingerprint);
    });
  });
});

describe("drawing files: one-to-many, sealed by a manifest (checked at commit)", () => {
  async function drawingWithFiles(c: Tx, w: World, files: { format: string; sheetIndex: number | null }[], manifestFiles?: { format: string; sheetIndex: number | null }[]) {
    const d = await designVersion(c, w, await dependencies(c, w));
    await actAs(c, null);
    const objs: { id: string; sequence: number; format: string; sheetIndex: number | null; checksum: `sha256:${string}`; byteSize: number; contentType: string }[] = [];
    for (const [i, f] of files.entries()) {
      const id = randomUUID();
      const checksum = contentHash(`file ${String(i)}`);
      const contentType = f.format === "PDF" ? "application/pdf" : "image/svg+xml";
      await insertRow(c, "file_object", { id, org_id: w.org, provider_id: "memory", storage_key: `org/${w.org}/f/${id}`, content_type: contentType, byte_size: 10 + i, checksum, created_by: w.users.DESIGNER });
      objs.push({ id, sequence: i + 1, format: f.format, sheetIndex: f.sheetIndex, checksum, byteSize: 10 + i, contentType });
    }
    const sealed = (manifestFiles ?? files).map((f, i) => ({ ...(objs[i] as (typeof objs)[number]), format: f.format, sheetIndex: f.sheetIndex }));
    const row = await outputSnapshotRow(c, w, d.designVersionId, "DRAWING", {
      drawing: { drawingType: "WALL_INTERNAL_ELEVATION", wallId: "A", objectLineageId: null, cutXMm: null, drawingNumber: "WIE-A", drawingRevision: "0", fileManifestHash: fileManifestHash(sealed) },
    });
    await actAs(c, null);
    await insertRow(c, "drawing_snapshot", row);
    for (const o of objs) await insertRow(c, "drawing_snapshot_file", { org_id: w.org, snapshot_id: row.id, sequence: o.sequence, format: o.format, sheet_index: o.sheetIndex, file_object_id: o.id });
    return row;
  }
  it("a PDF plus one SVG per sheet, in deterministic sequence, matching the sealed manifest, commits", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await drawingWithFiles(c, w, [{ format: "PDF", sheetIndex: null }, { format: "SVG", sheetIndex: 0 }, { format: "SVG", sheetIndex: 1 }]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });
  it("files that differ from the manifest, or are out of sequence, are refused at commit (LD016)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await c.query("SAVEPOINT a");
      await drawingWithFiles(c, w, [{ format: "PDF", sheetIndex: null }, { format: "SVG", sheetIndex: 0 }], [{ format: "PDF", sheetIndex: null }, { format: "SVG", sheetIndex: 1 }]);
      expect((await attemptDb(c, () => c.query("SET CONSTRAINTS ALL IMMEDIATE")))?.code).toBe("LD016");
      await c.query("ROLLBACK TO SAVEPOINT a");
      await drawingWithFiles(c, w, [{ format: "SVG", sheetIndex: 0 }, { format: "PDF", sheetIndex: null }]);
      expect((await attemptDb(c, () => c.query("SET CONSTRAINTS ALL IMMEDIATE")))?.code).toBe("LD016");
    });
  });
  it("a file linked to a sealed snapshot later is refused at commit (LD016)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const snap = await drawingWithFiles(c, w, [{ format: "PDF", sheetIndex: null }]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
      await c.query("SET CONSTRAINTS ALL DEFERRED");
      const id = randomUUID();
      await insertRow(c, "file_object", { id, org_id: w.org, provider_id: "memory", storage_key: `org/${w.org}/f/${id}`, content_type: "image/svg+xml", byte_size: 3, checksum: contentHash("late"), created_by: w.users.DESIGNER });
      await insertRow(c, "drawing_snapshot_file", { org_id: w.org, snapshot_id: snap.id, sequence: 2, format: "SVG", sheet_index: 0, file_object_id: id });
      expect((await attemptDb(c, () => c.query("SET CONSTRAINTS ALL IMMEDIATE")))?.code).toBe("LD016");
    });
  });
  it("sheet indexes exactly for sheet-scoped formats; unknown formats refused", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      expect((await attemptDb(c, () => drawingWithFiles(c, w, [{ format: "PDF", sheetIndex: 0 }])))?.code).toBe("LD019");
    });
    await tx(async (c) => {
      const w = await createWorld(c);
      expect((await attemptDb(c, () => drawingWithFiles(c, w, [{ format: "SVG", sheetIndex: null }])))?.code).toBe("LD019");
    });
    await tx(async (c) => {
      const w = await createWorld(c);
      expect((await attemptDb(c, () => drawingWithFiles(c, w, [{ format: "DXF", sheetIndex: 0 }])))?.code).toBe("LD019");
    });
  });
  it("a cabinet drawing's object must belong to the design version", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const row = await outputSnapshotRow(c, w, d.designVersionId, "DRAWING", {
        drawing: { drawingType: "FRONT_ELEVATION", wallId: null, objectLineageId: "not-an-object", cutXMm: null, drawingNumber: "FE-1", drawingRevision: "0", fileManifestHash: contentHash("x") },
      });
      await actAs(c, null);
      const err = await attemptDb(c, () => insertRow(c, "drawing_snapshot", row));
      expect([err?.code, err?.message.includes("object not-an-object is not part of the design version")]).toEqual(["LD016", true]);
      const own = await outputSnapshotRow(c, w, d.designVersionId, "DRAWING", {
        drawing: { drawingType: "FRONT_ELEVATION", wallId: null, objectLineageId: "obj_001", cutXMm: null, drawingNumber: "FE-1", drawingRevision: "0", fileManifestHash: contentHash("x") },
      });
      await actAs(c, null);
      await insertRow(c, "drawing_snapshot", own);
    });
  });
});
