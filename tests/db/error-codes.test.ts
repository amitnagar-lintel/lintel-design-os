/**
 * OD-1: every database-originated domain error has a stable, machine-readable code. Each RAISE in a design_os
 * function carries a registered SQLSTATE of class LD; API-facing codes are each produced through a real path;
 * built-in constraint errors are classified by SQLSTATE and constraint kind — never by message text.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DesignVersionRow, OutputPurpose, SnapshotKind } from "@lintel/persistence";
import { buildSnapshotProvenance, buildSnapshotRecord, contentHash, designVersionFromRow, snapshotToRow } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attemptDb, insertRow, one, tx } from "./support/db.js";
import type { DesignFixture, World } from "./support/world.js";
import { constructionStandard, createUser, createWorld, dependencies, designVersion, hashOf, transition, validationRun } from "./support/world.js";

/** Codes produced by the tests below; the last test checks every API-facing registry row was produced. */
const produced = new Set<string>();

async function sqlstate(c: Tx, fn: () => Promise<unknown>): Promise<{ code: string; detail: Record<string, unknown> | null; message: string }> {
  const err = await attemptDb(c, fn);
  if (err === null) throw new Error("expected a database error");
  const code = err.code ?? "";
  produced.add(code);
  return { code, detail: err.detail === undefined ? null : (JSON.parse(err.detail) as Record<string, unknown>), message: err.message };
}

function run(c: Tx, w: World, role: Parameters<World["actor"]>[0], sql: string, params: readonly unknown[] = []): Promise<unknown> {
  return (async () => {
    await actAs(c, w.actor(role), { apiRole: true });
    await c.query(sql, params as unknown[]);
  })();
}

function tr(c: Tx, w: World, role: Parameters<World["actor"]>[0], subject: string, id: string, action: string, reason: string | null = "reason", hash: string | null = null): Promise<unknown> {
  return run(c, w, role, "SELECT design_os.transition($1, $2, $3, $4, $5)", [subject, id, action, reason, hash]);
}

async function snapshotRow(c: Tx, w: World, d: DesignFixture, kind: SnapshotKind, blockers = 0, purpose: OutputPurpose = "PRELIMINARY"): Promise<Record<string, unknown>> {
  await actAs(c, null);
  const dv = designVersionFromRow(await one<DesignVersionRow>(c, "SELECT * FROM design_os.design_version WHERE id = $1", [d.designVersionId]));
  const provenance = buildSnapshotProvenance(kind, { versionId: dv.envelope.versionId, status: dv.envelope.status, contentHash: dv.envelope.contentHash }, dv.pins, "0.1.0+test");
  const record = buildSnapshotRecord({ snapshotId: randomUUID(), kind, purpose, provenance, inputHash: dv.inputHash, payload: { items: [] }, blockerCount: blockers, createdBy: w.users.DESIGNER, createdAt: "2026-09-26T10:00:00.000Z" });
  return { ...snapshotToRow(record, { orgId: w.org }) };
}

async function approveDesign(c: Tx, w: World, d: DesignFixture): Promise<void> {
  await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
  await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "approved", await hashOf(c, "design", d.designVersionId));
}

describe("every RAISE in design_os carries a registered LD SQLSTATE", () => {
  it("no function raises a generic SQLSTATE, and every LD literal is registered", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const registered = new Set((await c.query<{ sqlstate: string }>("SELECT sqlstate FROM design_os.error_code")).rows.map((r) => r.sqlstate));
      const fns = (await c.query<{ name: string; src: string }>(
        "SELECT p.oid::regprocedure::text AS name, p.prosrc AS src FROM pg_proc p WHERE p.pronamespace = 'design_os'::regnamespace AND p.prosrc ~* 'RAISE\\s+EXCEPTION'")).rows;
      expect(fns.length).toBeGreaterThanOrEqual(20);
      for (const f of fns) {
        const raises = f.src.match(/RAISE\s+EXCEPTION/gi) ?? [];
        const errcodes = f.src.match(/ERRCODE\s*=/gi) ?? [];
        expect([f.name, errcodes.length]).toEqual([f.name, raises.length]);
        // Literal SQLSTATEs are LD codes only; computed ones are CASE expressions / variables over LD literals.
        for (const m of f.src.matchAll(/ERRCODE\s*=\s*'([^']*)'/gi)) expect([f.name, m[1]]).toEqual([f.name, expect.stringMatching(/^LD\d{3}$/)]);
        for (const m of f.src.matchAll(/'(LD\d{3})'/g)) expect([f.name, registered.has(m[1] ?? "")]).toEqual([f.name, true]);
      }
    });
  });
  it("the registry: LD0xx API-facing with 4xx statuses, LD9xx internal with 500, unique codes", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const rows = (await c.query<{ sqlstate: string; code: string; http_status: number; api_facing: boolean }>("SELECT sqlstate, code, http_status, api_facing FROM design_os.error_code ORDER BY sqlstate")).rows;
      expect(rows.length).toBe(29);
      for (const r of rows) {
        if (r.sqlstate < "LD900") expect([r.code, r.api_facing, r.http_status >= 400 && r.http_status < 500]).toEqual([r.code, true, true]);
        else expect([r.code, r.api_facing, r.http_status]).toEqual([r.code, false, 500]);
      }
      expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    });
  });
  it("the registry is read-only for the API role and immutable for everyone", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect((await c.query("SELECT count(*) FROM design_os.error_code")).rows).toEqual([{ count: 29 }]);
      expect((await sqlstate(c, () => c.query("INSERT INTO design_os.error_code VALUES ('LD099', 'X', 400, true, 'x')"))).code).toBe("42501");
      await actAs(c, null);
      expect((await sqlstate(c, () => c.query("UPDATE design_os.error_code SET http_status = 418 WHERE sqlstate = 'LD001'"))).code).toBe("LD015");
    });
  });
  it("every built-in constraint in design_os has a classified kind (FK, unique/PK, CHECK, deferred constraint trigger)", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const kinds = (await c.query<{ contype: string; n: number }>(
        "SELECT contype::text, count(*)::int AS n FROM pg_constraint WHERE connamespace = 'design_os'::regnamespace AND conrelid <> 0 GROUP BY 1 ORDER BY 1")).rows;
      // f → INVALID_REFERENCE (23503) · p/u → DUPLICATE_RESOURCE (23505) · c → VALIDATION_FAILED (23514)
      // t → constraint trigger raising its own LD code. NOT NULL (23502) → VALIDATION_FAILED. Anything new must be classified here.
      for (const k of kinds) expect(["c", "f", "p", "t", "u"]).toContain(k.contype);
    });
  });
});

describe("each API-facing LD code is produced by its real database path", () => {
  it("transition(): LD001–LD008, LD010, LD020", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w, { approveAll: false }), { withRun: false });
      const dv = d.designVersionId;
      expect((await sqlstate(c, () => tr(c, w, "SALES", "design", dv, "SUBMIT"))).code).toBe("LD001");
      // X-Org naming an org the identity is not a member of: no org context is established.
      expect((await sqlstate(c, async () => {
        await actAs(c, { userId: other.users.DESIGNER, orgId: w.org }, { apiRole: true });
        await c.query("SELECT design_os.transition('design', $1, 'SUBMIT', 'r', NULL)", [dv]);
      })).code).toBe("LD002");
      expect((await sqlstate(c, () => tr(c, w, "CLIENT", "design", dv, "SUBMIT"))).code).toBe("LD003");
      expect((await sqlstate(c, () => tr(c, w, "DESIGNER", "design", dv, "SUBMIT", " "))).code).toBe("LD020");
      expect((await sqlstate(c, () => tr(c, w, "DESIGNER", "no_such_subject", dv, "SUBMIT"))).code).toBe("LD020");
      expect((await sqlstate(c, () => tr(c, w, "DESIGNER", "design", dv, "SUPERSEDE"))).code).toBe("LD020");
      expect((await sqlstate(c, () => tr(c, w, "DESIGNER", "design", randomUUID(), "SUBMIT"))).code).toBe("LD005");
      expect((await sqlstate(c, () => tr(c, other, "DESIGNER", "design", dv, "SUBMIT"))).code).toBe("LD005");
      const approveFromDraft = await sqlstate(c, () => tr(c, w, "DESIGN_HEAD", "design", dv, "APPROVE", "r", "sha256:x"));
      expect(approveFromDraft).toMatchObject({ code: "LD006", detail: { status: "DRAFT" } });
      expect((await sqlstate(c, () => tr(c, w, "DESIGNER", "design", dv, "SUBMIT"))).code).toBe("LD010");
      await validationRun(c, w, dv, d.inputHash, 0);
      // DESIGN_HEAD may author and approve designs, but never their own submission (D8).
      await transition(c, w, "DESIGN_HEAD", "design", dv, "SUBMIT");
      expect((await sqlstate(c, () => tr(c, w, "DESIGN_HEAD", "design", dv, "APPROVE", "r", "sha256:x"))).code).toBe("LD004");
      expect((await sqlstate(c, () => tr(c, w, "DESIGN_HEAD", "design", dv, "REQUEST_CHANGES"))).code).toBe("LD004");
    });
  });
  it("transition(APPROVE): LD007 content hash, LD008 dependencies (with coded problems), LD009 completeness, LD011 BLOCKERs", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const drafts = await designVersion(c, w, await dependencies(c, w, { approveAll: false }));
      await transition(c, w, "DESIGNER", "design", drafts.designVersionId, "SUBMIT");
      expect((await sqlstate(c, () => tr(c, w, "DESIGN_HEAD", "design", drafts.designVersionId, "APPROVE", "r", contentHash("something else")))).code).toBe("LD007");
      const deps = await sqlstate(c, async () => tr(c, w, "DESIGN_HEAD", "design", drafts.designVersionId, "APPROVE", "r", await hashOf(c, "design", drafts.designVersionId)));
      expect(deps.code).toBe("LD008");
      const problems = (deps.detail?.problems ?? []) as { code: string; message: string }[];
      expect(problems.length).toBeGreaterThan(0);
      expect(new Set(problems.map((p) => p.code))).toContain("DEPENDENCY_NOT_APPROVED");
      // The message still lists every problem (unchanged text), in the same order as DETAIL.
      expect(deps.message).toContain(problems.map((p) => p.message).join("; "));

      const cs = await constructionStandard(c, w, { code: "CS_INCOMPLETE" });
      await transition(c, w, "PRODUCTION", "construction_standard", cs, "SUBMIT");
      const incomplete = await sqlstate(c, async () => tr(c, w, "DESIGN_HEAD", "construction_standard", cs, "APPROVE", "r", await hashOf(c, "construction_standard", cs)));
      expect(incomplete.code).toBe("LD009");
      expect(new Set(((incomplete.detail?.problems ?? []) as { code: string }[]).map((p) => p.code))).toEqual(new Set(["CONTENT_INCOMPLETE"]));

      const w2 = await createWorld(c);
      const blocked = await designVersion(c, w2, await dependencies(c, w2), { blockers: 2 });
      await transition(c, w2, "DESIGNER", "design", blocked.designVersionId, "SUBMIT");
      const b = await sqlstate(c, async () => tr(c, w2, "DESIGN_HEAD", "design", blocked.designVersionId, "APPROVE", "r", await hashOf(c, "design", blocked.designVersionId)));
      expect(b.code).toBe("LD011");
      expect(b.detail).toEqual({ problems: [{ code: "VALIDATION_BLOCKERS", message: "engine validation has 2 BLOCKER(s)" }] });
    });
  });
  it("transition(): LD006 carries the current status in DETAIL", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d1 = await designVersion(c, w, deps);
      await transition(c, w, "DESIGNER", "design", d1.designVersionId, "SUBMIT");
      expect((await sqlstate(c, () => tr(c, w, "DESIGNER", "design", d1.designVersionId, "SUBMIT"))).detail).toEqual({ status: "IN_REVIEW" });
    });
  });
  it("record_validation_run(): LD001, LD002, LD003, LD005, LD012", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w), { withRun: false });
      const call = (actor: Parameters<typeof actAs>[1], id = d.designVersionId, hash = d.inputHash) => async () => {
        await actAs(c, actor, { apiRole: true });
        await c.query("SELECT design_os.record_validation_run($1, $2, '0.1.0', 'engine', 0, 0, '[]'::jsonb, $3)", [id, hash, contentHash("run")]);
      };
      expect((await sqlstate(c, call(w.actor("SALES")))).code).toBe("LD001");
      expect((await sqlstate(c, call(null))).code).toBe("LD002");
      expect((await sqlstate(c, call(w.actor("CLIENT")))).code).toBe("LD003");
      expect((await sqlstate(c, call(other.actor("DESIGNER")))).code).toBe("LD005");
      expect((await sqlstate(c, call(w.actor("DESIGNER"), d.designVersionId, contentHash("stale")))).code).toBe("LD012");
    });
  });
  it("version guards: LD013 non-DRAFT content, LD014 LOCKED content, LD015 insert-only and version deletion", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      await actAs(c, null);
      const inReview = await sqlstate(c, () => c.query("UPDATE design_os.design_version SET change_reason = 'edited in review' WHERE id = $1", [d.designVersionId]));
      expect(inReview).toMatchObject({ code: "LD013", detail: { status: "IN_REVIEW" } });
      expect((await sqlstate(c, () => c.query("DELETE FROM design_os.design_version WHERE id = $1", [d.designVersionId]))).code).toBe("LD015");
      expect((await sqlstate(c, () => c.query("UPDATE design_os.design_object SET x_mm = 5 WHERE design_version_id = $1", [d.designVersionId]))).code).toBe("LD013");
      await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "approved", await hashOf(c, "design", d.designVersionId));
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "locked");
      await actAs(c, null);
      expect((await sqlstate(c, () => c.query("UPDATE design_os.design_version SET change_reason = 'edited when locked' WHERE id = $1", [d.designVersionId]))).detail).toEqual({ status: "LOCKED" });
      expect((await sqlstate(c, () => c.query("UPDATE design_os.design_object SET x_mm = 5 WHERE design_version_id = $1", [d.designVersionId]))).code).toBe("LD014");
      expect((await sqlstate(c, () => c.query("UPDATE design_os.validation_run SET blocker_count = 0 WHERE design_version_id = $1", [d.designVersionId]))).code).toBe("LD015");
    });
  });
  it("snapshots and issues: LD005, LD011, LD016, LD017, LD021, LD024", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const draft = await snapshotRow(c, w, d, "DRAWING");
      expect((await sqlstate(c, () => insertRow(c, "drawing_snapshot", { ...draft, input_hash: contentHash("other inputs") }))).code).toBe("LD016");
      expect((await sqlstate(c, () => insertRow(c, "drawing_snapshot", { ...draft, purpose: "FOR_PRODUCTION" }))).code).toBe("LD021");
      expect((await sqlstate(c, () => insertRow(c, "drawing_snapshot", { ...draft, purpose: "FOR_REVIEW" }))).code).toBe("LD024");
      expect((await sqlstate(c, () => insertRow(c, "drawing_snapshot", { ...draft, design_version_id: randomUUID() }))).code).toBe("LD005");
      await approveDesign(c, w, d);
      const blocked = await snapshotRow(c, w, d, "DRAWING", 3);
      const b = await sqlstate(c, () => insertRow(c, "drawing_snapshot", { ...blocked, purpose: "FOR_PRODUCTION" }));
      expect(b).toMatchObject({ code: "LD011", detail: { blockerCount: 3 } });
      const ok = await snapshotRow(c, w, d, "DRAWING", 0, "FOR_PRODUCTION");
      await insertRow(c, "drawing_snapshot", ok);
      // FOR_PRODUCTION, but the design version is APPROVED, not LOCKED.
      expect((await sqlstate(c, () => insertRow(c, "drawing_issue", { org_id: w.org, snapshot_id: ok.id, issued_by: w.users.DESIGN_HEAD, reason: "issued" }))).detail).toEqual({ status: "APPROVED", blockerCount: 0 });
    });
  });
  it("memberships and references: LD018, LD019", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      const internal = await createUser(c, `x.${randomUUID().slice(0, 6)}@example.test`, "INTERNAL");
      expect((await sqlstate(c, () => c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'CLIENT')", [w.org, internal]))).code).toBe("LD018");
      const d = await designVersion(c, w, await dependencies(c, w), { withObject: false });
      await actAs(c, null);
      expect((await sqlstate(c, () => insertRow(c, "design_object", {
        org_id: w.org, design_version_id: d.designVersionId, object_code: "OBJ-X", lineage_id: "obj_x", object_type: "BASE_CABINET", product_code: "KIT_BASE_STANDARD",
        product_version_id: randomUUID(), x_mm: 0, y_mm: 0, z_mm: 0, rotation_y: 0, width_mm: 600, height_mm: 720, depth_mm: 560, parameters: {}, status: "DRAFT",
      }))).code).toBe("LD019");
    });
  });
  it("internal integrity guards use LD9xx codes (never explained to API callers)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await actAs(c, null);
      expect((await sqlstate(c, () => c.query("UPDATE design_os.design_version SET status = 'APPROVED' WHERE id = $1", [d.designVersionId]))).code).toBe("LD901");
      expect((await sqlstate(c, () => c.query("UPDATE design_os.app_user SET identity_kind = 'CLIENT' WHERE id = $1", [w.users.DESIGNER]))).code).toBe("LD903");
      expect((await sqlstate(c, () => c.query("TRUNCATE design_os.audit_log"))).code).toBe("LD904");
    });
  });
});

describe("coverage", () => {
  it("every API-facing LD code was produced above (the idempotency codes LD022/LD023 by idempotency.test.ts)", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const apiFacing = (await c.query<{ sqlstate: string }>("SELECT sqlstate FROM design_os.error_code WHERE api_facing AND sqlstate NOT IN ('LD022', 'LD023') ORDER BY 1")).rows.map((r) => r.sqlstate);
      expect(apiFacing.filter((s) => !produced.has(s))).toEqual([]);
    });
  });
});
