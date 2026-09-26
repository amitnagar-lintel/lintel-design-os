/**
 * Version immutability, exact supersession and lifecycle round trips through the database.
 * Every test runs in a rolled-back transaction.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NumericStandardRows, RecordLifecycleStatus, StandardValueRow } from "@lintel/persistence";
import { constructionStandardFromRows, constructionStandardToRows, designVersionFromRow, designVersionToRow, materialFromRow, materialToRow, metaOf } from "@lintel/persistence";
import type { DesignVersionRow, MaterialVersionRow, StandardVersionRow } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attempt, one, tx } from "./support/db.js";
import type { World } from "./support/world.js";
import { approve, constructionStandard, createWorld, dependencies, designVersion, hashOf, materialItem, planningStandard, statusOf, transition, validationRun } from "./support/world.js";

function withoutRowVersion<T extends object>(r: T & { readonly row_version: number }): T {
  const copy: Record<string, unknown> = { ...r };
  delete copy.row_version;
  return copy as unknown as T;
}

async function asOwner(c: Tx): Promise<void> {
  await actAs(c, null);
  await c.query("SET LOCAL ROLE design_os_owner");
}

/** Drive a construction standard version to `status` using only the transition function. */
async function constructionIn(c: Tx, w: World, status: RecordLifecycleStatus): Promise<string> {
  const id = await constructionStandard(c, w, { complete: true });
  if (status === "DRAFT") return id;
  await transition(c, w, "PRODUCTION", "construction_standard", id, "SUBMIT");
  if (status === "IN_REVIEW") return id;
  await transition(c, w, "DESIGN_HEAD", "construction_standard", id, "APPROVE", "ok", await hashOf(c, "construction_standard", id));
  if (status === "APPROVED") return id;
  if (status === "LOCKED") {
    await transition(c, w, "DESIGN_HEAD", "construction_standard", id, "LOCK", "used by a locked design");
    return id;
  }
  const entityId = (await one<{ e: string }>(c, "SELECT entity_id AS e FROM design_os.construction_standard_version WHERE id = $1", [id])).e;
  const v2 = await constructionStandard(c, w, { complete: true, entityId, versionNumber: 2 });
  await approve(c, w, "construction_standard", v2);
  return id;
}

async function readConstruction(c: Tx, id: string): Promise<NumericStandardRows> {
  await actAs(c, null);
  const version = await one<StandardVersionRow & { row_version: number }>(c,
    "SELECT v.*, e.code AS entity_code FROM design_os.construction_standard_version v JOIN design_os.construction_standard e ON e.id = v.entity_id WHERE v.id = $1", [id]);
  const values = (await c.query<StandardValueRow>("SELECT * FROM design_os.construction_standard_value WHERE version_id = $1 ORDER BY variable_code", [id])).rows;
  return { version: withoutRowVersion<StandardVersionRow>(version), values };
}

describe("versions are immutable outside DRAFT", () => {
  it("a new version must start as DRAFT", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w);
      const err = await attempt(c, () => c.query(
        "INSERT INTO design_os.construction_standard_version (org_id, entity_id, description, version_number, status, source, change_reason, created_by, content_hash, submitted_by, submitted_at, approved_by, approved_at, effective_from) SELECT org_id, entity_id, 'x', 2, 'APPROVED', source, change_reason, created_by, content_hash, created_by, now(), $2, now(), now() FROM design_os.construction_standard_version WHERE id = $1",
        [id, w.users.DESIGN_HEAD]));
      expect(err?.message).toContain("a new version must start as DRAFT");
    });
  });
  it("content and content rows cannot change once submitted; nothing non-DRAFT is deleted", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionIn(c, w, "IN_REVIEW");
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET description = 'edited' WHERE id = $1", [id])))?.message).toContain("content is immutable");
      expect((await attempt(c, () => c.query("UPDATE design_os.construction_standard_value SET value = 2 WHERE version_id = $1", [id])))?.message).toContain("content is immutable");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.construction_standard_value WHERE version_id = $1", [id])))?.message).toContain("content is immutable");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.construction_standard_version WHERE id = $1", [id])))?.message).toContain("can never be deleted");
    });
  });
  it("lifecycle columns change only through design_os.transition()", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w);
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET status = 'IN_REVIEW', submitted_by = created_by, submitted_at = now() WHERE id = $1", [id])))?.message)
        .toContain("lifecycle changes only through design_os.transition()");
      await actAs(c, w.actor("PRODUCTION"), { apiRole: true });
      expect((await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET status = 'APPROVED' WHERE id = $1", [id])))?.message).toContain("permission denied");
    });
  });
  it("a DRAFT version's content is editable (and its row version increments)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w);
      await actAs(c, null);
      await c.query("UPDATE design_os.construction_standard_version SET description = 'edited in draft' WHERE id = $1", [id]);
      expect((await one<{ rv: number }>(c, "SELECT row_version AS rv FROM design_os.construction_standard_version WHERE id = $1", [id])).rv).toBe(2);
    });
  });
});

describe("supersession references the exact successor VERSION row", () => {
  it("approving version 2 supersedes version 1 of the same entity, pointing at the exact successor", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const v1 = await constructionIn(c, w, "SUPERSEDED");
      const r = await one<{ superseded_by: string; entity_id: string; status: string }>(c, "SELECT superseded_by, entity_id, status FROM design_os.construction_standard_version WHERE id = $1", [v1]);
      const successor = await one<{ entity_id: string; version_number: number; status: string }>(c, "SELECT entity_id, version_number, status FROM design_os.construction_standard_version WHERE id = $1", [r.superseded_by]);
      expect(r.status).toBe("SUPERSEDED");
      expect(successor).toEqual({ entity_id: r.entity_id, version_number: 2, status: "APPROVED" });
    });
  });
  it("a version can only be superseded by another version of the same entity", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const a = await constructionIn(c, w, "APPROVED");
      const otherEntity = await constructionStandard(c, w, { complete: true, code: "OTHER_CONSTRUCTION_STANDARD" });
      await asOwner(c);
      const err = await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET status = 'SUPERSEDED', superseded_by = $2, superseded_at = now() WHERE id = $1", [a, otherEntity]));
      expect(err?.message).toContain("construction_standard_version_superseded_by_fk");
    });
  });
  it("cross-tenant supersession is impossible", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const w2 = await createWorld(c);
      const a = await constructionIn(c, w, "APPROVED");
      const foreign = await constructionStandard(c, w2, { complete: true });
      await asOwner(c);
      const err = await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET status = 'SUPERSEDED', superseded_by = $2, superseded_at = now() WHERE id = $1", [a, foreign]));
      expect(err?.message).toContain("construction_standard_version_superseded_by_fk");
    });
  });
  it("the successor cannot be a record of another domain or an arbitrary id", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const a = await constructionIn(c, w, "APPROVED");
      const planning = await planningStandard(c, w, { complete: true });
      await asOwner(c);
      for (const successor of [planning, randomUUID()]) {
        const err = await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET status = 'SUPERSEDED', superseded_by = $2, superseded_at = now() WHERE id = $1", [a, successor]));
        expect(err?.message).toContain("construction_standard_version_superseded_by_fk");
      }
      expect((await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET status = 'SUPERSEDED', superseded_by = $1, superseded_at = now() WHERE id = $1", [a])))?.message)
        .toContain("not_self_superseded");
    });
  });
  it("a superseded version cannot be edited, re-approved or deleted", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const v1 = await constructionIn(c, w, "SUPERSEDED");
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.construction_standard_version SET description = 'edited' WHERE id = $1", [v1])))?.message).toContain("content is immutable");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.construction_standard_version WHERE id = $1", [v1])))?.message).toContain("can never be deleted");
      for (const action of ["SUBMIT", "APPROVE", "LOCK", "REQUEST_CHANGES"]) {
        expect((await attempt(c, () => transition(c, w, "DESIGN_HEAD", "construction_standard", v1, action, "x", "sha256:0")))?.message).toContain("is allowed only from");
      }
      expect(await statusOf(c, "construction_standard", v1)).toBe("SUPERSEDED");
    });
  });
});

const STATES: readonly RecordLifecycleStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"];

describe("lifecycle round trip through the database: rows → domain → rows keeps the exact status", () => {
  it.each(STATES.map((s) => [s]))("ConstructionStandard %s", async (status) => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionIn(c, w, status);
      const rows = await readConstruction(c, id);
      const v = constructionStandardFromRows(rows);
      expect(v.envelope.status).toBe(status);
      const back = constructionStandardToRows(v.value, metaOf(v.envelope), { orgId: w.org }, Object.fromEntries(rows.values.map((x) => [x.variable_code, { unit: x.unit, source: x.source, evidenceRef: x.evidence_ref, note: x.note }])));
      expect(back).toEqual(rows);
    });
  });
  it.each(STATES.map((s) => [s]))("Material item %s", async (status) => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const item = await materialItem(c, w);
      let id = item.versionId;
      if (status !== "DRAFT") await transition(c, w, "PROCUREMENT", "material", id, "SUBMIT");
      if (["APPROVED", "LOCKED", "SUPERSEDED"].includes(status)) await transition(c, w, "DESIGN_HEAD", "material", id, "APPROVE", "ok", await hashOf(c, "material", id));
      if (status === "LOCKED") await transition(c, w, "DESIGN_HEAD", "material", id, "LOCK", "used");
      if (status === "SUPERSEDED") {
        const v2 = await materialItem(c, w, { entityId: item.entityId, versionNumber: 2 });
        await approve(c, w, "material", v2.versionId);
      }
      id = item.versionId;
      await actAs(c, null);
      const row = withoutRowVersion<MaterialVersionRow>(await one<MaterialVersionRow & { row_version: number }>(c,
        "SELECT v.*, e.code AS entity_code FROM design_os.material_version v JOIN design_os.material e ON e.id = v.entity_id WHERE v.id = $1", [id]));
      const v = materialFromRow(row);
      expect(v.envelope.status).toBe(status);
      expect(materialToRow(v.value, metaOf(v.envelope), { orgId: w.org })).toEqual(row);
    });
  });
  it.each(STATES.map((s) => [s]))("DesignVersion %s", async (status) => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      if (status !== "DRAFT") await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      if (["APPROVED", "LOCKED", "SUPERSEDED"].includes(status)) await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "ok", await hashOf(c, "design", d.designVersionId));
      if (status === "LOCKED") await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "LOCK", "quotation issued");
      if (status === "SUPERSEDED") {
        await actAs(c, null);
        const v2 = randomUUID();
        await c.query(`INSERT INTO design_os.design_version (id, org_id, entity_id, project_id, based_on_version_id, room_revision_id, construction_standard_version_id, planning_standard_version_id,
            edge_band_standard_version_id, manufacturing_standard_version_id, pricing_standard_version_id, quotation_policy_version_id, material_catalog_version_id, finish_catalog_version_id,
            hardware_catalog_version_id, appliance_catalog_version_id, product_catalog_version_id, hettich_dataset_version_id, authored_engine_version, input_hash, version_number, source, change_reason, created_by, content_hash)
          SELECT $2, org_id, entity_id, project_id, id, room_revision_id, construction_standard_version_id, planning_standard_version_id, edge_band_standard_version_id, manufacturing_standard_version_id,
            pricing_standard_version_id, quotation_policy_version_id, material_catalog_version_id, finish_catalog_version_id, hardware_catalog_version_id, appliance_catalog_version_id,
            product_catalog_version_id, hettich_dataset_version_id, authored_engine_version, input_hash, 2, source, 'second version', created_by, content_hash FROM design_os.design_version WHERE id = $1`,
          [d.designVersionId, v2]);
        await validationRun(c, w, v2, d.inputHash, 0);
        await approve(c, w, "design", v2);
      }
      await actAs(c, null);
      const row = withoutRowVersion<DesignVersionRow>(await one<DesignVersionRow & { row_version: number }>(c, "SELECT * FROM design_os.design_version WHERE id = $1", [d.designVersionId]));
      const record = designVersionFromRow(row);
      expect(record.envelope.status).toBe(status);
      expect(designVersionToRow(record, { orgId: w.org })).toEqual(row);
    });
  });
});
