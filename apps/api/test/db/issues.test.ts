/**
 * Issue and finalization over HTTP (M5 Step 7 checkpoint 4): quotation and drawing issue, the lifecycle / purpose
 * matrix, exact commercial versions, locking, immutability, concurrency, audit, and client visibility.
 *
 * FOR_PRODUCTION snapshots need 0 BLOCKERs, which the real engines cannot give on the synthetic test data. They are
 * seeded with the tests/db builders (test engines, synthetic payloads) through the database's own provenance gate —
 * exactly as the database tests do. A seeded FOR_PRODUCTION drawing reuses the real, stored files of a drawing the
 * API generated, so its sealed file manifest is genuine. Nothing here is production data.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outputChainRow, transition } from "../../../../tests/db/support/world.js";
import { insertRow } from "../../../../tests/db/support/db.js";
import { VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import { DrawingIssueResponse, FileUrlResponse, QuotationIssueResponse } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { domainWorld, key } from "../support/domain.js";
import type { Stage } from "../support/issue-fixtures.js";
import { issueFixtures, readAs, seeded } from "../support/issue-fixtures.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
beforeAll(async () => {
  api = await startApi([], { poolMax: 10 });
  d = await domainWorld(api, { commercial: "approved" });
  fx = issueFixtures(api, d);
  for (const role of ["COSTING", "DESIGN_HEAD"] as const) {
    expect((await api.request({ method: "POST", url: `/api/v1/projects/${d.projectId}/members`, as: d.w.users.SALES, payload: { userId: d.w.users[role], role } })).statusCode).toBe(201);
  }
  // The world's CLIENT identity: an ACTIVE contact of the project's client and a CLIENT member of the project.
  await seeded(async (c) => {
    const contact = (await c.query<{ id: string }>("INSERT INTO design_os.client_contact (org_id, client_id, email, display_name, user_id, status, invited_by) VALUES ($1, $2, $3, 'Client', $4, 'ACTIVE', $5) RETURNING id",
      [d.w.org, d.clientId, `contact.${randomUUID().slice(0, 6)}@client.example`, d.w.users.CLIENT, d.w.users.SALES])).rows[0]?.id;
    await c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, client_contact_id, granted_by) VALUES ($1, $2, $3, 'CLIENT', $4, $5)", [d.w.org, d.projectId, d.w.users.CLIENT, contact, d.w.users.SALES]);
  });
});
afterAll(async () => {
  await api.close();
});

const problem = (r: { json: () => unknown }) => r.json() as Problem;
let fx: ReturnType<typeof issueFixtures>;

describe("quotation issue: lifecycle and purpose matrix", () => {
  it("DRAFT, IN_REVIEW, APPROVED (not LOCKED) and SUPERSEDED designs, and PRELIMINARY / FOR_REVIEW quotations, are refused; nothing is recorded", async () => {
    const cases: [string, Stage, "PRELIMINARY" | "FOR_REVIEW" | "FOR_PRODUCTION", Record<string, unknown>][] = [
      ["DRAFT", "DRAFT", "PRELIMINARY", { purpose: "PRELIMINARY" }],
      ["IN_REVIEW", "IN_REVIEW", "FOR_REVIEW", { purpose: "FOR_REVIEW" }],
      ["APPROVED", "APPROVED", "FOR_PRODUCTION", { status: "APPROVED", blockerCount: 0 }],
      ["LOCKED + FOR_REVIEW", "LOCKED", "FOR_REVIEW", { purpose: "FOR_REVIEW" }],
      ["LOCKED + PRELIMINARY", "LOCKED", "PRELIMINARY", { purpose: "PRELIMINARY" }],
    ];
    for (const [label, stage, purpose, context] of cases) {
      const { versionId } = await fx.draftVersion();
      await fx.advance(versionId, stage === "LOCKED" ? "APPROVED" : stage);
      const q = await fx.seedQuotation(versionId, purpose);
      if (stage === "LOCKED") await seeded((c) => transition(c, d.w, "SALES", "design", versionId, "LOCK", "locked"));
      const r = await fx.issueQuotation(q.id, fx.quotationBody(q));
      expect([label, r.statusCode, problem(r).code, problem(r).context]).toEqual([label, 409, "ISSUE_PRECONDITIONS_FAILED", context]);
    }
    // SUPERSEDED: a FOR_PRODUCTION quotation made while LOCKED; the design is superseded before issue.
    const { designId, versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    const next = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${designId}/versions`, as: fx.as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { basedOnVersionId: versionId, changeReason: "successor" } })).json());
    await fx.advance(next.id, "APPROVED");
    expect(await fx.status(versionId)).toBe("SUPERSEDED");
    const superseded = await fx.issueQuotation(q.id, fx.quotationBody(q));
    expect([superseded.statusCode, problem(superseded).code, problem(superseded).context]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED", { status: "SUPERSEDED", blockerCount: 0 }]);
    expect(await sql("SELECT snapshot_id FROM design_os.quotation_issue WHERE project_id = $1 AND design_version_id IN (SELECT id FROM design_os.design_version WHERE entity_id = $2)", [d.projectId, designId])).toEqual([]);
  });

  it("LOCKED + FOR_PRODUCTION succeeds: an immutable decision record; the exact PricingStandard / QuotationPolicy are LOCKED; audited", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    const k = key();
    const r = await fx.issueQuotation(q.id, fx.quotationBody(q), "SALES", k);
    expect(r.statusCode).toBe(201);
    const issue = QuotationIssueResponse.parse(r.json());
    expect(issue).toMatchObject({
      kind: "QUOTATION", snapshotId: q.id, projectId: d.projectId, designVersionId: versionId, revisionNumber: 1, contentHash: q.contentHash,
      pricingStandardVersionId: fx.pricingId(), quotationPolicyVersionId: fx.policyId(), issuedBy: fx.as("SALES"), reason: "Sent to client",
    });
    expect(r.headers.location).toBe(`/api/v1/quotation-snapshots/${q.id}/issue`);
    // The exact commercial basis is now LOCKED: it can never change or be superseded out from under the issue.
    for (const [table, id] of [["pricing_standard_version", fx.pricingId()], ["quotation_policy_version", fx.policyId()]] as const) {
      expect([table, (await sql<{ status: string }>(`SELECT status FROM design_os.${table} WHERE id = $1`, [id]))[0]?.status]).toEqual([table, "LOCKED"]);
    }
    // Readable back; the same key replays; any other attempt is ALREADY_ISSUED.
    expect(QuotationIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: fx.as("COSTING") })).json())).toEqual(issue);
    const replay = await fx.issueQuotation(q.id, fx.quotationBody(q), "SALES", k);
    expect([replay.statusCode, replay.headers["idempotent-replayed"], QuotationIssueResponse.parse(replay.json())]).toEqual([201, "true", issue]);
    const again = await fx.issueQuotation(q.id, fx.quotationBody(q, { reason: "again" }));
    expect([again.statusCode, problem(again).code]).toEqual([409, "ALREADY_ISSUED"]);
    // Audit: the hash-chained audit log holds the full decision record, with actor, reason and request id.
    const [audit] = await sql<{ actor_user_id: string; reason: string; request_id: string | null; new_value: Record<string, unknown> }>(
      "SELECT actor_user_id, reason, request_id, new_value FROM design_os.audit_log WHERE table_name = 'quotation_issue' AND action = 'INSERT' AND new_value ->> 'snapshot_id' = $1", [q.id]);
    expect(audit).toMatchObject({ actor_user_id: fx.as("SALES"), reason: "Sent to client" });
    expect(audit?.request_id).not.toBeNull();
    expect(audit?.new_value).toMatchObject({
      project_id: d.projectId, design_version_id: versionId, snapshot_id: q.id, revision_number: 1, content_hash: q.contentHash, issued_by: fx.as("SALES"),
      pricing_standard_version_id: fx.pricingId(), quotation_policy_version_id: fx.policyId(),
    });
    expect(typeof audit?.new_value.issued_at).toBe("string");
  });

  it("the declared content hash and exact commercial versions must be the quotation's; nothing is recorded or locked on refusal", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    // Another exact version of the same PricingStandard (a DRAFT: approving it would supersede the one in use).
    const other = await fx.newPricingVersion(false);
    for (const [label, over] of [
      ["another PricingStandard version", { pricingStandardVersionId: other }],
      ["another QuotationPolicy version", { quotationPolicyVersionId: randomUUID() }],
      ["another content hash", { expectedContentHash: `sha256:${"a".repeat(64)}` }],
    ] as const) {
      const r = await fx.issueQuotation(q.id, fx.quotationBody(q, over));
      expect([label, r.statusCode, problem(r).code]).toEqual([label, 409, "ISSUE_PRECONDITIONS_FAILED"]);
      expect(problem(r).context?.problems).toEqual([expect.stringMatching(/pricing_standard_version_id|quotation_policy_version_id|content_hash/)]);
    }
    expect(await sql("SELECT 1 FROM design_os.quotation_issue WHERE snapshot_id = $1", [q.id])).toEqual([]);
    // A refused issue locks nothing: the other version named in the request is still a DRAFT.
    expect((await sql<{ status: string }>("SELECT status FROM design_os.pricing_standard_version WHERE id = $1", [other]))[0]?.status).toBe("DRAFT");
  });

  it("BLOCKERs are never issuable: a FOR_PRODUCTION output with BLOCKERs cannot exist (generation refuses it), and a blocked review output cannot be issued", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    // The running engine finds BLOCKERs on the synthetic inputs: FOR_PRODUCTION generation is refused, nothing to issue.
    const gen = await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/quotation-snapshots`, as: fx.as("COSTING"), headers: { "idempotency-key": key() },
      payload: { purpose: "FOR_PRODUCTION", pricingStandardVersionId: fx.pricingId(), quotationPolicyVersionId: fx.policyId() } });
    expect([gen.statusCode, problem(gen).code]).toEqual([409, "VALIDATION_BLOCKERS"]);
    const blocked = await seeded(async (c) => {
      const row = await outputChainRow(c, d.w, versionId, "QUOTATION", d.deps.commercial, { purpose: "FOR_REVIEW", blockers: 2, engineSeed: randomUUID() });
      await insertRow(c, "quotation_snapshot", row);
      return { id: row.id as string, contentHash: row.content_hash as string };
    });
    const r = await fx.issueQuotation(blocked.id, fx.quotationBody(blocked));
    expect([r.statusCode, problem(r).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
  });

  it("permissions: only quotation.issue may issue; another organization sees nothing", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    for (const role of ["DESIGNER", "COSTING", "DESIGN_HEAD"] as const) expect([role, problem(await fx.issueQuotation(q.id, fx.quotationBody(q), role)).code]).toEqual([role, "PERMISSION_DENIED"]);
    const other = await world();
    const foreign = await api.request({ method: "POST", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: other.users.SALES, payload: fx.quotationBody(q), headers: { "idempotency-key": key() } });
    expect([foreign.statusCode, problem(foreign).code]).toEqual([404, "NOT_FOUND"]);
  });
});

describe("concurrency and immutability", () => {
  it("concurrent issue requests for one quotation: exactly one succeeds, the others are ALREADY_ISSUED", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    const results = await Promise.all(Array.from({ length: 5 }, () => fx.issueQuotation(q.id, fx.quotationBody(q))));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(results.filter((r) => r.statusCode === 409).map((r) => problem(r).code)).toEqual(["ALREADY_ISSUED", "ALREADY_ISSUED", "ALREADY_ISSUED", "ALREADY_ISSUED"]);
    expect(await sql("SELECT snapshot_id FROM design_os.quotation_issue WHERE snapshot_id = $1", [q.id])).toHaveLength(1);
  });

  it("an issued revision stays exactly as issued: the record cannot be changed or deleted; a new revision is a new, separate issue", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q1 = await fx.seedQuotation(versionId, "FOR_PRODUCTION", 1);
    const first = QuotationIssueResponse.parse((await fx.issueQuotation(q1.id, fx.quotationBody(q1))).json());
    for (const stmt of ["UPDATE design_os.quotation_issue SET reason = 'edited' WHERE snapshot_id = $1", "DELETE FROM design_os.quotation_issue WHERE snapshot_id = $1",
      "UPDATE design_os.quotation_snapshot SET blocker_count = 1 WHERE id = $1"]) {
      await expect(sql(stmt, [q1.id])).rejects.toMatchObject({ code: "LD015" });
    }
    const q2 = await fx.seedQuotation(versionId, "FOR_PRODUCTION", 2);
    const second = QuotationIssueResponse.parse((await fx.issueQuotation(q2.id, fx.quotationBody(q2, { reason: "Revised" }))).json());
    expect([second.revisionNumber, second.snapshotId]).toEqual([2, q2.id]);
    expect(QuotationIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${q1.id}/issue`, as: fx.as("SALES") })).json())).toEqual(first);
  });
});

describe("drawing issue", () => {
  it("LOCKED + FOR_PRODUCTION drawing: issued with its exact sealed file manifest; the same number + revision cannot be issued twice", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const real = await fx.generatedDrawing(versionId, "KIT-ISS-P");
    const dr = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-1");
    const r = await fx.issueDrawing(dr.id, { reason: "Issued for site", expectedContentHash: dr.contentHash });
    expect(r.statusCode).toBe(201);
    const issue = DrawingIssueResponse.parse(r.json());
    expect(issue).toMatchObject({ kind: "DRAWING", snapshotId: dr.id, projectId: d.projectId, designVersionId: versionId, drawingNumber: "KIT-ISS-1", drawingRevision: "A", fileManifestHash: real.manifest, contentHash: dr.contentHash, issuedBy: fx.as("DESIGN_HEAD") });
    const [audit] = await sql<{ new_value: Record<string, unknown> }>("SELECT new_value FROM design_os.audit_log WHERE table_name = 'drawing_issue' AND new_value ->> 'snapshot_id' = $1", [dr.id]);
    expect(audit?.new_value).toMatchObject({ drawing_number: "KIT-ISS-1", drawing_revision: "A", file_manifest_hash: real.manifest, content_hash: dr.contentHash, issued_by: fx.as("DESIGN_HEAD") });
    // Another snapshot with the same drawing number and revision can never be issued; a new revision can.
    const dup = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-1");
    const again = await fx.issueDrawing(dup.id, { reason: "again", expectedContentHash: dup.contentHash });
    expect([again.statusCode, problem(again).code]).toEqual([409, "ALREADY_ISSUED"]);
    const revB = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-1", "B");
    expect((await fx.issueDrawing(revB.id, { reason: "rev B", expectedContentHash: revB.contentHash })).statusCode).toBe(201);
  });

  it("APPROVED-not-LOCKED, FOR_REVIEW, wrong content hash and missing permission are refused", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "APPROVED");
    const real = await fx.generatedDrawing(versionId, "KIT-ISS-Q");
    const approved = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-2");
    const r1 = await fx.issueDrawing(approved.id, { reason: "x", expectedContentHash: approved.contentHash });
    expect([r1.statusCode, problem(r1).code, problem(r1).context]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED", { status: "APPROVED", blockerCount: 0 }]);
    const review = await fx.seedDrawing(versionId, "FOR_REVIEW", real, "KIT-ISS-3");
    await seeded((c) => transition(c, d.w, "SALES", "design", versionId, "LOCK", "locked"));
    const r2 = await fx.issueDrawing(review.id, { reason: "x", expectedContentHash: review.contentHash });
    expect([r2.statusCode, problem(r2).context]).toEqual([409, { purpose: "FOR_REVIEW" }]);
    const r3 = await fx.issueDrawing(approved.id, { reason: "x", expectedContentHash: `sha256:${"b".repeat(64)}` });
    expect([r3.statusCode, problem(r3).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
    expect(problem(await fx.issueDrawing(approved.id, { reason: "x", expectedContentHash: approved.contentHash }, "DESIGNER")).code).toBe("PERMISSION_DENIED");
  });
});

describe("client visibility (no portal yet; the access rules are explicit and enforced now)", () => {
  it("a CLIENT member sees nothing unissued; after issue only the issued output, its issue record and its files — never drafts, reviews or internal routes", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const real = await fx.generatedDrawing(versionId, "KIT-CLI-P");
    const dr = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-CLI-1");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    /** What the CLIENT identity can read directly under RLS (the future portal's boundary). */
    const asClient = readAs(d.w.users.CLIENT, d.w.org);
    const visible = () => Promise.all([
      asClient("SELECT id FROM design_os.drawing_snapshot WHERE design_version_id = $1", [versionId]),
      asClient("SELECT id FROM design_os.quotation_snapshot WHERE design_version_id = $1", [versionId]),
      asClient("SELECT id FROM design_os.bom_snapshot WHERE design_version_id = $1", [versionId]),
      asClient("SELECT id FROM design_os.pricing_snapshot WHERE design_version_id = $1", [versionId]),
      asClient("SELECT snapshot_id FROM design_os.drawing_issue WHERE design_version_id = $1 UNION ALL SELECT snapshot_id FROM design_os.quotation_issue WHERE design_version_id = $1", [versionId]),
      asClient("SELECT id FROM design_os.file_object WHERE id = ANY($1::uuid[])", [real.files.map((f) => f.fileId)]),
    ]);
    expect(await visible()).toEqual([[], [], [], [], [], []]);
    // Internal routes are never available to a CLIENT identity, issued or not.
    expect(problem(await api.request({ method: "GET", url: `/api/v1/drawing-snapshots/${dr.id}`, as: fx.as("CLIENT") })).code).toBe("IDENTITY_KIND_MISMATCH");
    expect(problem(await api.request({ method: "GET", url: `/api/v1/design-versions/${versionId}/outputs`, as: fx.as("CLIENT") })).code).toBe("IDENTITY_KIND_MISMATCH");
    const fileId = real.files[0]?.fileId ?? "";
    expect((await api.request({ method: "GET", url: `/api/v1/files/${fileId}/url`, as: fx.as("CLIENT") })).statusCode).toBe(404);

    expect((await fx.issueDrawing(dr.id, { reason: "Issued to client", expectedContentHash: dr.contentHash })).statusCode).toBe(201);
    expect((await fx.issueQuotation(q.id, fx.quotationBody(q))).statusCode).toBe(201);
    const [drawings, quotations, boms, pricings, issues, files] = await visible();
    expect([drawings, quotations, boms, pricings]).toEqual([[{ id: dr.id }], [{ id: q.id }], [], []]);
    expect(issues.map((x) => x.snapshot_id).sort()).toEqual([dr.id, q.id].sort());
    // The issued drawing's files — which the generating (unissued, PRELIMINARY) drawing shares — are readable; a signed URL works.
    expect(files.length).toBe(real.files.length);
    const url = await api.request({ method: "GET", url: `/api/v1/files/${fileId}/url`, as: fx.as("CLIENT") });
    expect(url.statusCode).toBe(200);
    const u = new URL(FileUrlResponse.parse(url.json()).url);
    expect((await api.request({ method: "GET", url: `${u.pathname}${u.search}` })).statusCode).toBe(200);
    // Another project's issues stay invisible to this client.
    expect(await asClient("SELECT snapshot_id FROM design_os.quotation_issue WHERE project_id <> $1", [d.projectId])).toEqual([]);
  });
});

describe("historical issues remain valid (last: it supersedes the world's PricingStandard)", () => {
  it("an issued quotation stays issued, readable and exact after its PricingStandard is superseded by a newer approved version", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    const issued = QuotationIssueResponse.parse((await fx.issueQuotation(q.id, fx.quotationBody(q))).json());
    const v2 = await fx.newPricingVersion(true);
    expect((await sql<{ status: string }>("SELECT status FROM design_os.pricing_standard_version WHERE id = $1", [fx.pricingId()]))[0]?.status).toBe("SUPERSEDED");
    expect(QuotationIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: fx.as("SALES") })).json())).toEqual(issued);
    // A new quotation must use the new version: the superseded basis cannot be issued again.
    const stale = await fx.seedQuotation(versionId, "FOR_REVIEW", 2);
    const r = await fx.issueQuotation(stale.id, fx.quotationBody(stale));
    expect([r.statusCode, problem(r).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
    expect(v2).not.toBe(fx.pricingId());
  });
});
