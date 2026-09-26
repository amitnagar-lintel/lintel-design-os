/** design_os.transition(): approvals, request-changes history, preconditions and the automatic lock cascade. */
import { describe, expect, it } from "vitest";
import type { Tx } from "./support/db.js";
import { actAs, attempt, one, tx } from "./support/db.js";
import type { Dependencies, World } from "./support/world.js";
import {
  approve,
  constructionStandard,
  createWorld,
  dependencies,
  designVersion,
  hashOf,
  hettichDataset,
  PIN_SUBJECT,
  planningStandard,
  pricingStandard,
  statusOf,
  transition,
} from "./support/world.js";

async function submitDesign(c: Tx, w: World, id: string): Promise<void> {
  await transition(c, w, "DESIGNER", "design", id, "SUBMIT");
}
async function approveDesign(c: Tx, w: World, id: string): Promise<void> {
  await transition(c, w, "DESIGN_HEAD", "design", id, "APPROVE", "design approved", await hashOf(c, "design", id));
}
async function entityOf(c: Tx, table: string, id: string): Promise<string> {
  return (await one<{ e: string }>(c, `SELECT entity_id AS e FROM design_os.${table} WHERE id = $1`, [id])).e;
}
/** Every exact dependency version a locked design must lock: the 12 pins plus catalog members and the product's recipe. */
function lockedSet(deps: Dependencies): [string, string][] {
  const out: [string, string][] = [];
  for (const [col, subject] of Object.entries(PIN_SUBJECT)) {
    const id = deps.pins[col as keyof Dependencies["pins"]];
    if (id !== null) out.push([subject, id]);
  }
  const i = deps.items;
  const add = (subject: string, key: string): void => {
    const item = i[key];
    if (item !== undefined) out.push([subject, item.versionId]);
  };
  add("material", "material");
  add("edge_band", "edgeBand");
  add("finish", "finish");
  add("hardware_rule_set", "rules");
  add("product", "product");
  add("construction_recipe", "recipe");
  return out;
}

describe("approval (D8, D2, reviewed content)", () => {
  it("approver = submitter is always refused (no override)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "SUBMIT");
      const err = await attempt(c, () => transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "self", "x"));
      expect(err?.message).toContain("approver must differ from the submitter (D8)");
    });
  });
  it("approval needs the exact reviewed content hash", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w, { complete: true });
      await transition(c, w, "PRODUCTION", "construction_standard", id, "SUBMIT");
      const err = await attempt(c, () => transition(c, w, "DESIGN_HEAD", "construction_standard", id, "APPROVE", "ok", `sha256:${"0".repeat(64)}`));
      expect(err?.message).toContain("reviewed content hash does not match");
    });
  });
  it("REQUEST_CHANGES returns to DRAFT and records who, when, why and the previous status; content is editable again", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submitDesign(c, w, d.designVersionId);
      expect(await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "REQUEST_CHANGES", "move OBJ-KIT-001 off the wall")).toBe("DRAFT");
      await actAs(c, null);
      const decision = await one<{ action: string; decided_by: string; reason: string; previous_status: string; new_status: string; decided_at: string }>(c,
        "SELECT action, decided_by, reason, previous_status, new_status, decided_at FROM design_os.approval_decision WHERE subject_id = $1 AND action = 'REQUEST_CHANGES'", [d.designVersionId]);
      expect(decision).toMatchObject({ action: "REQUEST_CHANGES", decided_by: w.users.DESIGN_HEAD, reason: "move OBJ-KIT-001 off the wall", previous_status: "IN_REVIEW", new_status: "DRAFT" });
      expect(decision.decided_at).toBeTruthy();
      expect((await one<{ s: string }>(c, "SELECT status AS s FROM design_os.approval_request WHERE subject_id = $1", [d.designVersionId])).s).toBe("CHANGES_REQUESTED");
      await c.query("UPDATE design_os.design_object SET x_mm = 10 WHERE design_version_id = $1", [d.designVersionId]);
      expect(await statusOf(c, "design", d.designVersionId)).toBe("DRAFT");
    });
  });
  it("the submitter cannot request changes on their own submission", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "SUBMIT");
      expect((await attempt(c, () => transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "REQUEST_CHANGES", "x")))?.message).toContain("cannot review their own submission");
    });
  });
  it("finance approvals are FINANCE only: COSTING and ADMIN cannot approve a PricingStandard", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await pricingStandard(c, w, { complete: true });
      await transition(c, w, "COSTING", "pricing_standard", id, "SUBMIT");
      const h = await hashOf(c, "pricing_standard", id);
      for (const role of ["COSTING", "ADMIN", "DESIGN_HEAD"] as const) {
        expect((await attempt(c, () => transition(c, w, role, "pricing_standard", id, "APPROVE", "x", h)))?.message).toContain("missing permission pricing_standard.approve");
      }
      expect(await transition(c, w, "FINANCE", "pricing_standard", id, "APPROVE", "finance approved", h)).toBe("APPROVED");
    });
  });
  it("NULL / UNVERIFIED production values can never be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w);
      await transition(c, w, "PRODUCTION", "construction_standard", id, "SUBMIT");
      const err = await attempt(c, () => transition(c, w, "DESIGN_HEAD", "construction_standard", id, "APPROVE", "x", undefined));
      expect(err?.message).toContain("reviewed content hash");
      const err2 = await attempt(c, async () => transition(c, w, "DESIGN_HEAD", "construction_standard", id, "APPROVE", "x", await hashOf(c, "construction_standard", id)));
      expect(err2?.message).toContain("construction value BACK_GROOVE_DEPTH is NULL / UNVERIFIED");
    });
  });
  it("client identities cannot change any lifecycle", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w);
      expect((await attempt(c, () => transition(c, w, "CLIENT", "construction_standard", id, "SUBMIT")))?.message).toContain("client identities cannot change lifecycles");
    });
  });
});

describe("design-version approval preconditions", () => {
  it("SUBMIT needs an engine validation run for the current inputs; APPROVE needs zero BLOCKERs", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { blockers: 26 });
      await submitDesign(c, w, d.designVersionId);
      expect((await attempt(c, () => approveDesign(c, w, d.designVersionId)))?.message).toContain("engine validation has 26 BLOCKER(s)");
    });
  });
  it("an unapproved (DRAFT) Hettich dataset pin blocks approval (BL-2)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const draftHettich = await hettichDataset(c, w, { entityId: await entityOf(c, "hettich_dataset_version", deps.pins.hettich_dataset_version_id), versionNumber: 2 });
      const d = await designVersion(c, w, { ...deps, pins: { ...deps.pins, hettich_dataset_version_id: draftHettich } });
      await submitDesign(c, w, d.designVersionId);
      expect((await attempt(c, () => approveDesign(c, w, d.designVersionId)))?.message).toContain(`hettichDatasetVersionId ${draftHettich} is DRAFT; it must be APPROVED or LOCKED`);
    });
  });
  it("a SUPERSEDED dependency cannot satisfy the approval requirement", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      const v1 = deps.pins.construction_standard_version_id;
      const v2 = await constructionStandard(c, w, { complete: true, entityId: await entityOf(c, "construction_standard_version", v1), versionNumber: 2 });
      await approve(c, w, "construction_standard", v2);
      expect(await statusOf(c, "construction_standard", v1)).toBe("SUPERSEDED");
      await submitDesign(c, w, d.designVersionId);
      expect((await attempt(c, () => approveDesign(c, w, d.designVersionId)))?.message).toContain(`constructionStandardVersionId ${v1} is SUPERSEDED; it must be APPROVED or LOCKED`);
    });
  });
  it("an approved successor never lets an older version be approved over it", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const v1 = await planningStandard(c, w, { complete: true });
      const entityId = await entityOf(c, "planning_standard_version", v1);
      const v2 = await planningStandard(c, w, { complete: true, entityId, versionNumber: 2 });
      await approve(c, w, "planning_standard", v2);
      await transition(c, w, "PRODUCTION", "planning_standard", v1, "SUBMIT");
      expect((await attempt(c, async () => transition(c, w, "DESIGN_HEAD", "planning_standard", v1, "APPROVE", "x", await hashOf(c, "planning_standard", v1))))?.message).toContain("a newer version (2) is already effective");
    });
  });
});

describe("automatic locking (D1)", () => {
  async function lockedDesign(c: Tx, w: World, deps: Dependencies): Promise<string> {
    const d = await designVersion(c, w, deps);
    await submitDesign(c, w, d.designVersionId);
    await approveDesign(c, w, d.designVersionId);
    expect(await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "quotation issued to client")).toBe("LOCKED");
    return d.designVersionId;
  }

  it("locks every required pinned dependency and their exact member / recipe versions", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const dv = await lockedDesign(c, w, deps);
      expect(await statusOf(c, "design", dv)).toBe("LOCKED");
      for (const [subject, id] of lockedSet(deps)) expect([subject, await statusOf(c, subject, id)]).toEqual([subject, "LOCKED"]);
    });
  });
  it("locks the exact pinned versions, never newer versions of the same entities", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      await submitDesign(c, w, d.designVersionId);
      await approveDesign(c, w, d.designVersionId);
      const pinnedPlanning = deps.pins.planning_standard_version_id;
      const newerPlanning = await planningStandard(c, w, { complete: true, entityId: await entityOf(c, "planning_standard_version", pinnedPlanning), versionNumber: 2 });
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "quotation issued");
      expect(await statusOf(c, "planning_standard", pinnedPlanning)).toBe("LOCKED");
      expect(await statusOf(c, "planning_standard", newerPlanning)).toBe("DRAFT");
    });
  });
  it("leaves unrelated versions alone", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const unrelated = await constructionStandard(c, w, { complete: true, code: "UNRELATED_CONSTRUCTION_STANDARD" });
      await approve(c, w, "construction_standard", unrelated);
      await lockedDesign(c, w, deps);
      expect(await statusOf(c, "construction_standard", unrelated)).toBe("APPROVED");
    });
  });
  it("is tenant-safe: another organization's versions are untouched and unreachable", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const deps = await dependencies(c, w);
      const otherDeps = await dependencies(c, other);
      const dv = await lockedDesign(c, w, deps);
      for (const [subject, id] of lockedSet(otherDeps)) expect([subject, await statusOf(c, subject, id)]).toEqual([subject, "APPROVED"]);
      expect((await attempt(c, () => transition(c, other, "DESIGN_HEAD", "design", dv, "LOCK", "cross-tenant attempt")))?.message).toContain("not found");
    });
  });
  it("an already LOCKED dependency stays LOCKED, unchanged, with no duplicate decision", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const hettich = deps.pins.hettich_dataset_version_id;
      await transition(c, w, "PRODUCTION", "hettich_dataset", hettich, "LOCK", "locked earlier by another design");
      const before = await one<{ locked_by: string; locked_at: string }>(c, "SELECT locked_by, locked_at FROM design_os.hettich_dataset_version WHERE id = $1", [hettich]);
      await lockedDesign(c, w, deps);
      const after = await one<{ status: string; locked_by: string; locked_at: string }>(c, "SELECT status, locked_by, locked_at FROM design_os.hettich_dataset_version WHERE id = $1", [hettich]);
      expect(after).toEqual({ status: "LOCKED", ...before });
      expect((await one<{ n: number }>(c, "SELECT count(*)::int AS n FROM design_os.approval_decision WHERE subject_id = $1 AND action = 'LOCK'", [hettich])).n).toBe(1);
    });
  });
  it("locking requires an APPROVED design version", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      expect((await attempt(c, () => transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "x")))?.message).toContain("LOCK is allowed only from APPROVED");
    });
  });
});
