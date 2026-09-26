/**
 * Output purposes PRELIMINARY / FOR_REVIEW / FOR_PRODUCTION (migration 0012). FOR_REVIEW is its own purpose: review
 * output from an IN_REVIEW, APPROVED or LOCKED design that never qualifies as FOR_PRODUCTION and never satisfies
 * issue or release. A stored purpose never changes. The database rules equal the @lintel/persistence contract.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChosenVersions, OutputPurpose, SnapshotKind } from "@lintel/persistence";
import { contentHash, OUTPUT_PURPOSE_RULES, OUTPUT_PURPOSES } from "@lintel/persistence";
import type { Tx } from "./support/db.js";
import { actAs, attemptDb, insertRow, one, tx } from "./support/db.js";
import type { Commercial, DesignFixture, World } from "./support/world.js";
import {
  createWorld, dependencies, designVersion, hashOf, manufacturingStandard, outputChainRow, PIN_SUBJECT, SNAPSHOT_TABLE as TABLE, transition, validationRun,
} from "./support/world.js";

/**
 * A snapshot row for the design version's current state (upstream sources at `purpose`); the row itself is built as
 * PRELIMINARY and its `purpose` overridden afterwards to probe the database alone. Each probe uses its own engine, so
 * natural identities never collide.
 */
async function row(c: Tx, w: World, d: DesignFixture, kind: SnapshotKind, purpose: OutputPurpose, blockers = 0,
                   commercial: Commercial | null = null, chosen: Partial<ChosenVersions> = {}): Promise<Record<string, unknown>> {
  const r = await outputChainRow(c, w, d.designVersionId, kind, commercial, { purpose: "PRELIMINARY", upstreamPurpose: purpose, blockers, engineSeed: randomUUID(), chosen });
  await actAs(c, null);
  return { ...r, purpose };
}

async function insert(c: Tx, w: World, d: DesignFixture, kind: SnapshotKind, purpose: OutputPurpose, blockers = 0,
                      commercial: Commercial | null = null, chosen: Partial<ChosenVersions> = {}): Promise<{ id: string; code: string | undefined }> {
  const r = await row(c, w, d, kind, purpose, blockers, commercial, chosen);
  const err = await attemptDb(c, () => insertRow(c, TABLE[kind], r));
  return { id: String(r.id), code: err?.code };
}

async function submit(c: Tx, w: World, d: DesignFixture): Promise<void> {
  await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
}
async function approve(c: Tx, w: World, d: DesignFixture): Promise<void> {
  await transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "approved", await hashOf(c, "design", d.designVersionId));
}

describe("the rule registry is explicit per kind and equals the API contract", () => {
  it("design_os.output_purpose_rule equals @lintel/persistence OUTPUT_PURPOSE_RULES", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const rows = (await c.query<{ kind: SnapshotKind; purpose: OutputPurpose; design_statuses: string; requires_zero_blockers: boolean; qualifies_for_issue: boolean; qualifies_for_release: boolean }>(
        "SELECT kind::text AS kind, purpose, design_statuses::text[]::text AS design_statuses, requires_zero_blockers, qualifies_for_issue, qualifies_for_release FROM design_os.output_purpose_rule ORDER BY kind, purpose")).rows;
      const db = rows.map((r) => ({
        kind: r.kind, purpose: r.purpose, designStatuses: r.design_statuses.replace(/[{}]/g, "").split(","),
        requiresZeroBlockers: r.requires_zero_blockers, qualifiesForIssue: r.qualifies_for_issue, qualifiesForRelease: r.qualifies_for_release,
      }));
      const key = (x: { kind: string; purpose: string }) => `${x.kind}/${x.purpose}`;
      expect(db.sort((a, b) => key(a).localeCompare(key(b)))).toEqual([...OUTPUT_PURPOSE_RULES].map((r) => ({ ...r, designStatuses: [...r.designStatuses] })).sort((a, b) => key(a).localeCompare(key(b))));
      expect(rows).toHaveLength(18);
    });
  });
  it("the registry itself forbids FOR_REVIEW / PRELIMINARY from ever qualifying for issue or release, or loosening FOR_PRODUCTION", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      await c.query("ALTER TABLE design_os.output_purpose_rule DISABLE TRIGGER forbid_mutation");
      const probe = async (sql: string) => (await attemptDb(c, () => c.query(sql)))?.constraint;
      expect(await probe("UPDATE design_os.output_purpose_rule SET qualifies_for_issue = true WHERE kind = 'QUOTATION' AND purpose = 'FOR_REVIEW'")).toBe("output_purpose_rule_only_production_qualifies");
      expect(await probe("UPDATE design_os.output_purpose_rule SET qualifies_for_release = true WHERE kind = 'MANUFACTURING_DOCUMENT' AND purpose = 'PRELIMINARY'")).toBe("output_purpose_rule_only_production_qualifies");
      expect(await probe("UPDATE design_os.output_purpose_rule SET requires_zero_blockers = false WHERE kind = 'DRAWING' AND purpose = 'FOR_PRODUCTION'")).toBe("output_purpose_rule_production_guard");
      expect(await probe("UPDATE design_os.output_purpose_rule SET design_statuses = '{IN_REVIEW,APPROVED}' WHERE kind = 'DRAWING' AND purpose = 'FOR_PRODUCTION'")).toBe("output_purpose_rule_production_guard");
      expect(await probe("UPDATE design_os.output_purpose_rule SET design_statuses = '{DRAFT,IN_REVIEW}' WHERE kind = 'DRAWING' AND purpose = 'FOR_REVIEW'")).toBe("output_purpose_rule_review_states");
      expect(await probe("UPDATE design_os.output_purpose_rule SET qualifies_for_issue = true WHERE kind = 'BOM' AND purpose = 'FOR_PRODUCTION'")).toBe("output_purpose_rule_issue_kinds");
    });
  });
  it("the registry is immutable and read-only for the API role", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      expect((await attemptDb(c, () => c.query("UPDATE design_os.output_purpose_rule SET description = 'x'")))?.code).toBe("LD015");
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect((await c.query("SELECT count(*) FROM design_os.output_purpose_rule")).rows).toEqual([{ count: 18 }]);
      expect((await attemptDb(c, () => c.query("DELETE FROM design_os.output_purpose_rule")))?.code).toBe("42501");
    });
  });
  it("only the three purposes exist, and every snapshot's (kind, purpose) must be a registered pair", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const r = await row(c, w, d, "DRAWING", "PRELIMINARY");
      // The provenance trigger refuses an unregistered purpose first (LD024); the CHECK and the FK stand behind it.
      expect((await attemptDb(c, () => insertRow(c, "drawing_snapshot", { ...r, purpose: "FINAL" })))?.code).toBe("LD024");
      await actAs(c, null);
      const checks = (await c.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'design_os'::regnamespace AND conname LIKE '%\\_snapshot\\_purpose\\_check'")).rows;
      expect(checks).toHaveLength(6);
      for (const ch of checks) expect(ch.def).toBe("CHECK ((purpose = ANY (ARRAY['PRELIMINARY'::text, 'FOR_REVIEW'::text, 'FOR_PRODUCTION'::text])))");
      const fk = await one<{ n: number }>(c, "SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace = 'design_os'::regnamespace AND conname LIKE '%\\_purpose_rule_fk' AND contype = 'f'");
      expect(fk.n).toBe(6);
    });
  });
});

describe("which design states allow which purpose", () => {
  it("DRAFT: PRELIMINARY only — FOR_REVIEW (LD024) and FOR_PRODUCTION (LD021) are refused", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      expect((await insert(c, w, d, "DRAWING", "PRELIMINARY")).code).toBeUndefined();
      expect((await insert(c, w, d, "DRAWING", "FOR_REVIEW")).code).toBe("LD024");
      expect((await insert(c, w, d, "BOM", "FOR_REVIEW")).code).toBe("LD024");
      expect((await insert(c, w, d, "DRAWING", "FOR_PRODUCTION")).code).toBe("LD021");
    });
  });
  it("IN_REVIEW: FOR_REVIEW is allowed (BLOCKERs shown, not hidden); FOR_PRODUCTION is still refused", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submit(c, w, d);
      expect((await insert(c, w, d, "DRAWING", "FOR_REVIEW")).code).toBeUndefined();
      expect((await insert(c, w, d, "BOQ", "FOR_REVIEW", 4)).code).toBeUndefined();
      expect((await insert(c, w, d, "DRAWING", "FOR_PRODUCTION")).code).toBe("LD021");
    });
  });
  it("APPROVED / LOCKED: every purpose; FOR_PRODUCTION still needs 0 BLOCKERs (LD011) while FOR_REVIEW does not", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submit(c, w, d);
      await approve(c, w, d);
      for (const p of OUTPUT_PURPOSES) expect([p, (await insert(c, w, d, "BOM", p)).code]).toEqual([p, undefined]);
      expect((await insert(c, w, d, "BOM", "FOR_REVIEW", 2)).code).toBeUndefined();
      expect((await insert(c, w, d, "BOM", "FOR_PRODUCTION", 2)).code).toBe("LD011");
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "locked");
      for (const p of OUTPUT_PURPOSES) expect([p, (await insert(c, w, d, "DRAWING", p)).code]).toEqual([p, undefined]);
    });
  });
  it("SUPERSEDED: PRELIMINARY and FOR_REVIEW (reproduction / review) only; never FOR_PRODUCTION", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submit(c, w, d);
      await approve(c, w, d);
      // Approving version 2 of the same design supersedes version 1 (the only path to SUPERSEDED).
      const next = randomUUID();
      const pins = Object.keys(PIN_SUBJECT).join(", ");
      await actAs(c, null);
      await c.query(`INSERT INTO design_os.design_version (id, org_id, entity_id, project_id, room_revision_id, ${pins}, authored_engine_version, input_hash, version_number, source, change_reason, created_by, content_hash)
        SELECT $2, org_id, entity_id, project_id, room_revision_id, ${pins}, authored_engine_version, input_hash, 2, source, 'second version', created_by, $3 FROM design_os.design_version WHERE id = $1`,
        [d.designVersionId, next, contentHash({ next })]);
      const successor = { ...d, designVersionId: next };
      await validationRun(c, w, next, d.inputHash, 0);
      await submit(c, w, successor);
      await approve(c, w, successor);
      expect((await one<{ status: string }>(c, "SELECT status FROM design_os.design_version WHERE id = $1", [d.designVersionId])).status).toBe("SUPERSEDED");
      expect((await insert(c, w, d, "DRAWING", "PRELIMINARY")).code).toBeUndefined();
      expect((await insert(c, w, d, "DRAWING", "FOR_REVIEW")).code).toBeUndefined();
      expect((await insert(c, w, d, "BOQ", "FOR_REVIEW", 2)).code).toBeUndefined();
      expect((await insert(c, w, d, "DRAWING", "FOR_PRODUCTION")).code).toBe("LD021");
      // OUTPUT_GENERATION evidence may be recorded for the SUPERSEDED version; it never changes the version.
      const before = await one<{ row_version: number; status: string }>(c, "SELECT row_version, status FROM design_os.design_version WHERE id = $1", [d.designVersionId]);
      await validationRun(c, w, d.designVersionId, d.inputHash, 0, "DESIGNER", "OUTPUT_GENERATION");
      expect(await one(c, "SELECT row_version, status FROM design_os.design_version WHERE id = $1", [d.designVersionId])).toEqual(before);
      // APPROVAL evidence cannot be recorded for it.
      expect((await attemptDb(c, () => validationRun(c, w, d.designVersionId, d.inputHash, 0)))?.code).toBe("LD012");
    });
  });
  it("manufacturing documents (reserved; no engine yet): the ManufacturingStandard is chosen per output, and FOR_PRODUCTION stays blocked (no approvable ManufacturingStandard)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      const mfg = { manufacturingStandardVersionId: await manufacturingStandard(c, w) };
      expect((await insert(c, w, d, "MANUFACTURING_DOCUMENT", "PRELIMINARY", 0, null, mfg)).code).toBeUndefined();
      await submit(c, w, d);
      expect((await insert(c, w, d, "MANUFACTURING_DOCUMENT", "FOR_REVIEW", 0, null, mfg)).code).toBeUndefined();
      // The design itself is approvable: the ManufacturingStandard is not a design dependency any more (0017)…
      await approve(c, w, d);
      // …but a FOR_PRODUCTION manufacturing document needs an APPROVED / LOCKED ManufacturingStandard, which cannot exist yet.
      expect((await insert(c, w, d, "MANUFACTURING_DOCUMENT", "FOR_PRODUCTION", 0, null, mfg)).code).toBe("LD021");
      // Without the chosen standard the provenance is incomplete (refused by @lintel/persistence, and by the database if bypassed).
      const r = await row(c, w, d, "MANUFACTURING_DOCUMENT", "PRELIMINARY", 0, null, mfg);
      expect((await attemptDb(c, () => insertRow(c, TABLE.MANUFACTURING_DOCUMENT, { ...r, manufacturing_standard_version_id: null })))?.code).toBe("LD016");
    });
  });
});

describe("SUPERSEDED designs: issue and release are forbidden; earlier issues stay valid", () => {
  it("a drawing issued while LOCKED stays issued after supersession; nothing more can be issued from the SUPERSEDED design (LD017)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submit(c, w, d);
      await approve(c, w, d);
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "locked for issue");
      const first = await insert(c, w, d, "DRAWING", "FOR_PRODUCTION");
      const second = await insert(c, w, d, "DRAWING", "FOR_PRODUCTION");
      await actAs(c, null);
      const issue = (id: string) => insertRow(c, "drawing_issue", { org_id: w.org, snapshot_id: id, issued_by: w.users.DESIGN_HEAD, reason: "issued" });
      await issue(first.id);
      // Version 2 supersedes version 1.
      const next = randomUUID();
      const pins = Object.keys(PIN_SUBJECT).join(", ");
      await c.query(`INSERT INTO design_os.design_version (id, org_id, entity_id, project_id, room_revision_id, ${pins}, authored_engine_version, input_hash, version_number, source, change_reason, created_by, content_hash)
        SELECT $2, org_id, entity_id, project_id, room_revision_id, ${pins}, authored_engine_version, input_hash, 2, source, 'second version', created_by, $3 FROM design_os.design_version WHERE id = $1`,
        [d.designVersionId, next, contentHash({ next })]);
      await validationRun(c, w, next, d.inputHash, 0);
      await submit(c, w, { ...d, designVersionId: next });
      await approve(c, w, { ...d, designVersionId: next });
      await actAs(c, null);
      expect((await one<{ status: string }>(c, "SELECT status FROM design_os.design_version WHERE id = $1", [d.designVersionId])).status).toBe("SUPERSEDED");
      expect((await c.query("SELECT 1 FROM design_os.drawing_issue WHERE snapshot_id = $1", [first.id])).rowCount).toBe(1);
      expect((await attemptDb(c, () => issue(second.id)))?.code).toBe("LD017");
      expect((await insert(c, w, d, "DRAWING", "FOR_PRODUCTION")).code).toBe("LD021");
    });
  });
});

describe("purposes never change and only FOR_PRODUCTION can be issued", () => {
  it("every change of a stored purpose is refused (RECORD_IMMUTABLE, LD015) — no upgrade, no downgrade", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submit(c, w, d);
      await approve(c, w, d);
      for (const from of OUTPUT_PURPOSES) {
        const { id } = await insert(c, w, d, "DRAWING", from);
        for (const to of OUTPUT_PURPOSES.filter((p) => p !== from)) {
          await actAs(c, null);
          const err = await attemptDb(c, () => c.query("UPDATE design_os.drawing_snapshot SET purpose = $2 WHERE id = $1", [id, to]));
          expect([from, to, err?.code]).toEqual([from, to, "LD015"]);
        }
      }
    });
  });
  it("a FOR_REVIEW or PRELIMINARY drawing of a LOCKED design can never be issued (LD017); FOR_PRODUCTION can", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const d = await designVersion(c, w, await dependencies(c, w));
      await submit(c, w, d);
      await approve(c, w, d);
      const review = await insert(c, w, d, "DRAWING", "FOR_REVIEW");
      const prelim = await insert(c, w, d, "DRAWING", "PRELIMINARY");
      const prod = await insert(c, w, d, "DRAWING", "FOR_PRODUCTION");
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "locked for issue");
      await actAs(c, null);
      const issue = (id: string) => insertRow(c, "drawing_issue", { org_id: w.org, snapshot_id: id, issued_by: w.users.DESIGN_HEAD, reason: "issued" });
      const r1 = await attemptDb(c, () => issue(review.id));
      expect([r1?.code, JSON.parse(r1?.detail ?? "null")]).toEqual(["LD017", { purpose: "FOR_REVIEW" }]);
      expect((await attemptDb(c, () => issue(prelim.id)))?.code).toBe("LD017");
      expect(await attemptDb(c, () => issue(prod.id))).toBeNull();
    });
  });
  it("a FOR_REVIEW quotation of a LOCKED design can never be issued (LD017)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w, { commercial: "approved" });
      const d = await designVersion(c, w, deps);
      await submit(c, w, d);
      await approve(c, w, d);
      const review = await insert(c, w, d, "QUOTATION", "FOR_REVIEW", 0, deps.commercial);
      expect(review.code).toBeUndefined();
      await transition(c, w, "SALES", "design", d.designVersionId, "LOCK", "locked for issue");
      await actAs(c, null);
      expect((await attemptDb(c, () => insertRow(c, "quotation_issue", { org_id: w.org, snapshot_id: review.id, issued_by: w.users.SALES, reason: "sent" })))?.code).toBe("LD017");
    });
  });
  it("only FOR_PRODUCTION manufacturing documents can satisfy production release", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const r = await c.query<{ kind: string; purpose: string }>("SELECT kind::text AS kind, purpose FROM design_os.output_purpose_rule WHERE qualifies_for_release");
      expect(r.rows).toEqual([{ kind: "MANUFACTURING_DOCUMENT", purpose: "FOR_PRODUCTION" }]);
      const issuable = await c.query<{ kind: string; purpose: string }>("SELECT kind::text AS kind, purpose FROM design_os.output_purpose_rule WHERE qualifies_for_issue ORDER BY kind");
      expect(issuable.rows).toEqual([{ kind: "DRAWING", purpose: "FOR_PRODUCTION" }, { kind: "QUOTATION", purpose: "FOR_PRODUCTION" }]);
    });
  });
});
