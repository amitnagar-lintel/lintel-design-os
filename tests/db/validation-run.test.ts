/**
 * Validation-run trust boundary. The TypeScript engine decides validation and BLOCKERs; the database stores its
 * result immutably, only through design_os.record_validation_run(), tied to the exact inputs. Approval accepts
 * only the latest run of the same design version for the current input hash AND input revision with 0 BLOCKERs.
 */
import { describe, expect, it } from "vitest";
import { contentHash, RECORD_VALIDATION_RUN_SQL } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attempt, insertRow, one, tx } from "./support/db.js";
import type { DesignFixture, World } from "./support/world.js";
import { createWorld, dependencies, designVersion, hashOf, outputSnapshotRow, statusOf, testEngine, transition, validationRun } from "./support/world.js";

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
        org_id: w.org, design_version_id: d.designVersionId, purpose: "APPROVAL", engine_name: "validation", input_hash: d.inputHash, input_revision: 1, engine_version: "0.1.0", engine_fingerprint: "x",
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
      const run = await one<Record<string, unknown>>(c, "SELECT * FROM design_os.validation_run WHERE id = $1", [id]);
      const dv = await one<{ input_revision: number; now: string; deps: string }>(c,
        "SELECT input_revision, now() AS now, design_os.dependency_set_hash(design_os.engineering_dependency_hashes(org_id, id)) AS deps FROM design_os.design_version WHERE id = $1", [d.designVersionId]);
      const e = testEngine("validation");
      expect(run).toMatchObject({
        purpose: "APPROVAL", design_version_id: d.designVersionId, input_hash: d.inputHash, input_revision: dv.input_revision, dependency_set_hash: dv.deps, created_by: w.users.DESIGNER,
        created_at: dv.now, engine_name: "validation", engine_version: "0.1.0", engine_build: e.build, engine_fingerprint: e.fingerprint, engine_closure: e.closure,
      });
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
      const e = testEngine("validation");
      const call = (over: Partial<Record<"purpose" | "name" | "build" | "fingerprint" | "closure", unknown>>) => () =>
        c.query(RECORD_VALIDATION_RUN_SQL, [over.purpose ?? "APPROVAL", d.designVersionId, d.inputHash, over.name ?? e.name, e.version, "build" in over ? over.build : e.build,
          over.fingerprint ?? e.fingerprint, over.closure === undefined ? JSON.stringify(e.closure) : over.closure, 0, 0, "[]", contentHash("r")]);
      expect((await attempt(c, call({ fingerprint: " " })))?.message).toContain("validation_run_engine_fingerprint_check");
      expect((await attempt(c, call({ fingerprint: "engine-fingerprint" })))?.message).toContain("validation_run_provenance_required");
      expect((await attempt(c, call({ closure: null })))?.message).toContain("validation_run_provenance_required");
      expect((await attempt(c, call({ name: "bom" })))?.message).toContain("validation_run_engine_name_check");
      expect((await attempt(c, call({ purpose: "LATEST" })))?.message).toContain("unknown purpose");
      // 0016: the engine build identity (commit SHA / build revision) is required on every new run.
      for (const build of [null, "", "  ", "abc", "-dash-first"]) {
        expect((await attempt(c, call({ build })))?.message).toContain("validation_run_engine_build_required");
      }
      // The previous signatures (0012: no build; 0016: no purpose / fingerprint closure) no longer exist.
      expect((await attempt(c, () => c.query("SELECT design_os.record_validation_run($1, $2, '0.1.0', 'engine', 0, 0, '[]'::jsonb, $3)", [d.designVersionId, d.inputHash, contentHash("r")])))?.message).toContain("does not exist");
      expect((await attempt(c, () => c.query("SELECT design_os.record_validation_run($1, $2, '0.1.0', $4, 'engine', 0, 0, '[]'::jsonb, $3)", [d.designVersionId, d.inputHash, contentHash("r"), e.build])))?.message).toContain("does not exist");
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

describe("validation-run purposes (0017): APPROVAL evidence vs OUTPUT_GENERATION evidence", () => {
  const approveNow = async (c: Tx, w: World, d: DesignFixture) => {
    await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
    await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "approved", await hashOf(c, "design", d.designVersionId));
  };
  it("OUTPUT_GENERATION runs may be recorded for APPROVED and LOCKED designs and never change the design version", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await approveNow(c, w, d);
      for (const status of ["APPROVED", "LOCKED"] as const) {
        if (status === "LOCKED") await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "LOCK", "locked");
        await actAs(c, null);
        const before = await one(c, "SELECT to_jsonb(v) AS row FROM design_os.design_version v WHERE id = $1", [d.designVersionId]);
        const run = await validationRun(c, w, d.designVersionId, d.inputHash, 0, "DESIGNER", "OUTPUT_GENERATION", testEngine("validation", status));
        await actAs(c, null);
        expect(await one(c, "SELECT to_jsonb(v) AS row FROM design_os.design_version v WHERE id = $1", [d.designVersionId])).toEqual(before);
        expect((await one<{ purpose: string }>(c, "SELECT purpose FROM design_os.validation_run WHERE id = $1", [run])).purpose).toBe("OUTPUT_GENERATION");
        // APPROVAL evidence cannot be recorded any more.
        expect((await attempt(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 0)))?.message).toContain("runs are recorded only for DRAFT or IN_REVIEW");
      }
    });
  });
  it("only APPROVAL runs satisfy SUBMIT / APPROVE; OUTPUT_GENERATION runs never do", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps, { withRun: false });
      await validationRun(c, w, d.designVersionId, d.inputHash, 0, "DESIGNER", "OUTPUT_GENERATION");
      expect((await attempt(c, () => transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT")))?.message).toContain("requires an engine validation run");
      await validationRun(c, w, d.designVersionId, d.inputHash, 0);
      await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      // A later zero-blocker OUTPUT_GENERATION run cannot rescue an APPROVAL run with BLOCKERs.
      const d2 = await designVersion(c, w, deps, { blockers: 2 });
      await validationRun(c, w, d2.designVersionId, d2.inputHash, 0, "DESIGNER", "OUTPUT_GENERATION");
      await transition(c, w, "DESIGNER", "design", d2.designVersionId, "SUBMIT");
      const err = await attempt(c, async () => transition(c, w, "DESIGN_HEAD", "design", d2.designVersionId, "APPROVE", "x", await hashOf(c, "design", d2.designVersionId)));
      expect(err?.message).toContain("BLOCKER");
    });
  });
  it("OUTPUT_GENERATION evidence has a natural identity: the same inputs and engine reuse one run; a different result for them is refused", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      const a = await validationRun(c, w, d.designVersionId, d.inputHash, 1, "DESIGNER", "OUTPUT_GENERATION");
      expect(await validationRun(c, w, d.designVersionId, d.inputHash, 1, "DESIGNER", "OUTPUT_GENERATION")).toBe(a);
      expect(await validationRun(c, w, d.designVersionId, d.inputHash, 1, "DESIGNER", "OUTPUT_GENERATION", testEngine("validation", "another build"))).not.toBe(a);
      expect((await attempt(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 3, "DESIGNER", "OUTPUT_GENERATION")))?.message).toContain("a different result exists");
      // APPROVAL runs are evidence at a point in time: never deduplicated.
      expect(await validationRun(c, w, d.designVersionId, d.inputHash, 0)).not.toBe(await validationRun(c, w, d.designVersionId, d.inputHash, 0));
    });
  });
  it("a new OUTPUT_GENERATION run must be used by a snapshot of the same transaction (LD906 at commit); with its snapshot it commits", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      await c.query("SAVEPOINT orphan");
      await validationRun(c, w, d.designVersionId, d.inputHash, 0, "DESIGNER", "OUTPUT_GENERATION");
      const orphan = await attempt(c, () => c.query("SET CONSTRAINTS ALL IMMEDIATE"));
      expect(orphan?.message).toContain("is not used by any snapshot");
      await c.query("ROLLBACK TO SAVEPOINT orphan");
      await c.query("RELEASE SAVEPOINT orphan");
      const row = await outputSnapshotRow(c, w, d.designVersionId, "BOM");
      await actAs(c, null);
      await insertRow(c, "bom_snapshot", row);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });
  it("OUTPUT_GENERATION needs an output-generation permission; APPROVAL keeps its own", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      expect((await attempt(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 0, "SALES", "OUTPUT_GENERATION")))?.message).toContain("missing permission to generate outputs");
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      const e = testEngine("validation");
      expect((await attempt(c, () => c.query(RECORD_VALIDATION_RUN_SQL, ["APPROVAL", d.designVersionId, contentHash("stale"), e.name, e.version, e.build, e.fingerprint,
        JSON.stringify(e.closure), 0, 0, "[]", contentHash("r")])))?.message).toContain("different inputs");
    });
  });
});
