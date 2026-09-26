/**
 * Validation-run trust boundary. The TypeScript engine decides validation and BLOCKERs; the database stores its
 * result immutably, only through design_os.record_validation_run(), tied to the exact inputs. Approval accepts
 * only the latest run of the same design version for the current input hash AND input revision with 0 BLOCKERs.
 */
import { describe, expect, it } from "vitest";
import { contentHash } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attempt, insertRow, one, tx } from "./support/db.js";
import type { DesignFixture, World } from "./support/world.js";
import { createWorld, dependencies, designVersion, hashOf, statusOf, transition, validationRun } from "./support/world.js";

async function submit(c: Tx, w: World, d: DesignFixture): Promise<Error | null> {
  return attempt(c, () => transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT"));
}
async function approveDesign(c: Tx, w: World, d: DesignFixture): Promise<Error | null> {
  return attempt(c, async () => transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "approve", await hashOf(c, "design", d.designVersionId)));
}
async function setInputHash(c: Tx, id: string, hash: string): Promise<void> {
  await actAs(c, null);
  await c.query("UPDATE design_os.design_version SET input_hash = $2 WHERE id = $1", [id, hash]);
}

describe("only the authorised execution path creates validation runs", () => {
  it("the API role cannot insert validation runs directly", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      const err = await attempt(c, () => insertRow(c, "validation_run", {
        org_id: w.org, design_version_id: d.designVersionId, input_hash: d.inputHash, input_revision: 1, engine_version: "0.1.0", engine_hash: "x",
        content_hash: contentHash("x"), blocker_count: 0, warning_count: 0, messages: [], created_by: w.users.DESIGNER,
      }));
      expect(err?.message).toContain("permission denied");
    });
  });
  it("record_validation_run stamps the caller, the time and the exact inputs", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      const id = await validationRun(c, w, d.designVersionId, d.inputHash, 0);
      const run = await one<{ design_version_id: string; input_hash: string; input_revision: number; created_by: string; created_at: string; engine_version: string; engine_hash: string }>(c,
        "SELECT * FROM design_os.validation_run WHERE id = $1", [id]);
      const dv = await one<{ input_revision: number; now: string }>(c, "SELECT input_revision, now() AS now FROM design_os.design_version WHERE id = $1", [d.designVersionId]);
      expect(run).toMatchObject({ design_version_id: d.designVersionId, input_hash: d.inputHash, input_revision: dv.input_revision, created_by: w.users.DESIGNER, created_at: dv.now, engine_version: "0.1.0", engine_hash: "engine-fingerprint" });
    });
  });
  it("refuses callers without the permission, clients and other tenants", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      expect((await attempt(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 0, "SALES")))?.message).toContain("missing permission to record engine validation runs");
      expect((await attempt(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 0, "CLIENT")))?.message).toContain("internal member");
      expect((await attempt(c, () => validationRun(c, other, d.designVersionId, d.inputHash, 0, "DESIGN_HEAD")))?.message).toContain("not found");
    });
  });
  it("refuses runs for other inputs, without engine metadata, or for versions past review", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      expect((await attempt(c, () => validationRun(c, w, d.designVersionId, contentHash("stale inputs"), 0)))?.message).toContain("different inputs");
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      const noEngine = await attempt(c, () => c.query("SELECT design_os.record_validation_run($1, $2, '0.1.0', ' ', 0, 0, '[]'::jsonb, $3)", [d.designVersionId, d.inputHash, contentHash("r")]));
      expect(noEngine?.message).toContain("validation_run_engine_hash_check");
      await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      expect(await approveDesign(c, w, d)).toBeNull();
      expect((await attempt(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 0)))?.message).toContain("runs are recorded only for DRAFT or IN_REVIEW");
    });
  });
  it("validation runs are immutable", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { blockers: 3 });
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.validation_run SET blocker_count = 0 WHERE design_version_id = $1", [d.designVersionId])))?.message).toContain("insert-only");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.validation_run WHERE design_version_id = $1", [d.designVersionId])))?.message).toContain("insert-only");
    });
  });
});

describe("approval accepts only a clean run for exactly the current inputs", () => {
  it("an old validation run cannot be reused after the design input hash changes", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const newInputs = contentHash("inputs after moving OBJ-KIT-001");
      await setInputHash(c, d.designVersionId, newInputs);
      expect((await submit(c, w, d))?.message).toContain("requires an engine validation run for the current inputs");
      // Changing the hash back does not revive the old run: the database input revision moved on.
      await setInputHash(c, d.designVersionId, d.inputHash);
      expect((await submit(c, w, d))?.message).toContain("requires an engine validation run for the current inputs");
      await validationRun(c, w, d.designVersionId, d.inputHash, 0);
      expect(await submit(c, w, d)).toBeNull();
      expect(await approveDesign(c, w, d)).toBeNull();
    });
  });
  it("an old run cannot be reused after an input row changes, even if the input hash was not recomputed", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await actAs(c, null);
      await c.query("UPDATE design_os.design_object SET x_mm = 25 WHERE design_version_id = $1", [d.designVersionId]);
      expect((await submit(c, w, d))?.message).toContain("requires an engine validation run for the current inputs");
    });
  });
  it("the latest run for the current inputs governs: a newer blocked run overrides an older clean one", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await validationRun(c, w, d.designVersionId, d.inputHash, 2);
      expect(await submit(c, w, d)).toBeNull();
      expect((await approveDesign(c, w, d))?.message).toContain("engine validation has 2 BLOCKER(s)");
      expect(await statusOf(c, "design", d.designVersionId)).toBe("IN_REVIEW");
    });
  });
  it("a run of another design version is never accepted", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const a = await designVersion(c, w, deps);
      const b = await designVersion(c, w, deps, { withRun: false });
      await setInputHash(c, b.designVersionId, a.inputHash);
      expect((await submit(c, w, b))?.message).toContain("requires an engine validation run for the current inputs");
    });
  });
});
