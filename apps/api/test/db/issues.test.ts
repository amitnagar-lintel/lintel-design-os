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
import type { Tx } from "../../../../tests/db/support/db.js";
import { insertRow } from "../../../../tests/db/support/db.js";
import { approve as approveVersion, hashOf, outputChainRow, pricingStandard, transition, validationRun } from "../../../../tests/db/support/world.js";
import { VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import { DrawingIssueResponse, FileUrlResponse, GenerateResponse, QuotationIssueResponse } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { cabinet, domainWorld, key } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, world } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
let productVersionId: string;
beforeAll(async () => {
  api = await startApi([], { poolMax: 10 });
  d = await domainWorld(api, { commercial: "approved" });
  productVersionId = (d.deps.items.product as { versionId: string }).versionId;
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

type Role = keyof DomainWorld["w"]["users"];
const as = (role: Role) => d.w.users[role];
const problem = (r: { json: () => unknown }) => r.json() as Problem;
const pricingId = () => d.deps.commercial.pricing_standard_version_id as string;
const policyId = () => d.deps.commercial.quotation_policy_version_id as string;

async function seeded<T>(fn: (c: Tx & { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>): Promise<T> {
  const c = await admin();
  try {
    await c.query("BEGIN");
    const r = await fn(c as never);
    await c.query("COMMIT");
    return r;
  } finally {
    await c.end();
  }
}

/** A new design (so approvals / supersession never touch another scenario) with one DRAFT version and one cabinet. */
async function draftVersion(): Promise<{ designId: string; versionId: string }> {
  const design = await api.request({ method: "POST", url: `/api/v1/rooms/${d.roomId}/designs`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { name: `Issue ${randomUUID().slice(0, 6)}` } });
  const designId = design.json<{ id: string }>().id;
  const v = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { pins: d.pins, changeReason: "issue" } })).json());
  const etag = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER") })).headers.etag as string;
  expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER"), payload: cabinet(productVersionId), headers: { "if-match": etag } })).statusCode).toBe(201);
  return { designId, versionId: v.id };
}
type Stage = "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED";
/** Move a version through the database's own lifecycle path (seeded 0-BLOCKER APPROVAL evidence of a test engine). */
async function advance(versionId: string, to: Stage): Promise<void> {
  if (to === "DRAFT") return;
  await seeded(async (c) => {
    const [v] = await sql<{ input_hash: string }>("SELECT input_hash FROM design_os.design_version WHERE id = $1", [versionId]);
    await validationRun(c, d.w, versionId, v?.input_hash as string, 0);
    await transition(c, d.w, "DESIGNER", "design", versionId, "SUBMIT");
    if (to === "IN_REVIEW") return;
    await transition(c, d.w, "DESIGN_HEAD", "design", versionId, "APPROVE", "approved", await hashOf(c, "design", versionId));
    if (to === "LOCKED") await transition(c, d.w, "SALES", "design", versionId, "LOCK", "locked for issue");
  });
}
const status = async (versionId: string) => (await sql<{ status: string }>("SELECT status FROM design_os.design_version WHERE id = $1", [versionId]))[0]?.status;

/** Seed a quotation snapshot (with its BOM / BOQ / Pricing chain) of the design version, through the provenance gate. */
async function seedQuotation(versionId: string, purpose: "PRELIMINARY" | "FOR_REVIEW" | "FOR_PRODUCTION", revisionNumber = 1): Promise<{ id: string; contentHash: string }> {
  return seeded(async (c) => {
    const row = await outputChainRow(c, d.w, versionId, "QUOTATION", d.deps.commercial, { purpose, engineSeed: randomUUID(), revisionNumber });
    await insertRow(c, "quotation_snapshot", row);
    return { id: row.id as string, contentHash: row.content_hash as string };
  });
}

/**
 * Seed a drawing snapshot that carries the REAL files of a drawing the API generated for the same version (same
 * sealed manifest); `number` / `revision` identify it.
 */
async function seedDrawing(versionId: string, purpose: "FOR_REVIEW" | "FOR_PRODUCTION", source: { id: string; manifest: string }, number: string, revision = "A"): Promise<{ id: string; contentHash: string }> {
  return seeded(async (c) => {
    const row = await outputChainRow(c, d.w, versionId, "DRAWING", null, {
      purpose, engineSeed: randomUUID(),
      drawing: { drawingType: "ROOM_PANEL_SCHEDULE", wallId: null, objectLineageId: null, cutXMm: null, drawingNumber: number, drawingRevision: revision, fileManifestHash: source.manifest as `sha256:${string}` },
    });
    await insertRow(c, "drawing_snapshot", row);
    await c.query(`INSERT INTO design_os.drawing_snapshot_file (org_id, snapshot_id, sequence, format, sheet_index, file_object_id)
      SELECT org_id, $2, sequence, format, sheet_index, file_object_id FROM design_os.drawing_snapshot_file WHERE snapshot_id = $1`, [source.id, row.id]);
    return { id: row.id as string, contentHash: row.content_hash as string };
  });
}
/** A real (PRELIMINARY) drawing generated by the API: its stored files are reused by seeded FOR_PRODUCTION drawings. */
async function generatedDrawing(versionId: string, number: string): Promise<{ id: string; manifest: string; files: { fileId: string }[] }> {
  const r = await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/drawing-snapshots`, as: as("DESIGNER"), headers: { "idempotency-key": key() },
    payload: { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: number, drawingRevision: "P" } });
  const s = GenerateResponse.parse(r.json()).snapshot;
  return { id: s.id, manifest: s.drawing?.fileManifestHash ?? "", files: s.drawing?.files ?? [] };
}

const issueQuotation = (id: string, body: Record<string, unknown>, role: Role = "SALES", k = key()) =>
  api.request({ method: "POST", url: `/api/v1/quotation-snapshots/${id}/issue`, as: as(role), payload: body, headers: { "idempotency-key": k } });
const issueDrawing = (id: string, body: Record<string, unknown>, role: Role = "DESIGN_HEAD", k = key()) =>
  api.request({ method: "POST", url: `/api/v1/drawing-snapshots/${id}/issue`, as: as(role), payload: body, headers: { "idempotency-key": k } });
/** A new version of the world's PricingStandard (synthetic, test-only values), optionally APPROVED. */
async function newPricingVersion(approve: boolean): Promise<string> {
  return seeded(async (c) => {
    const [e] = (await c.query("SELECT entity_id FROM design_os.pricing_standard_version WHERE id = $1", [pricingId()])).rows as { entity_id: string }[];
    const entity = e?.entity_id as string;
    const [m] = (await c.query("SELECT max(version_number) + 1 AS n FROM design_os.pricing_standard_version WHERE entity_id = $1", [entity])).rows as { n: number }[];
    const n = Number(m?.n);
    const id = await pricingStandard(c, d.w, { complete: true, entityId: entity, versionNumber: n });
    if (approve) await approveVersion(c, d.w, "pricing_standard", id);
    return id;
  });
}
const quotationBody = (q: { contentHash: string }, over: Record<string, unknown> = {}) => ({ reason: "Sent to client", expectedContentHash: q.contentHash, pricingStandardVersionId: pricingId(), quotationPolicyVersionId: policyId(), ...over });

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
      const { versionId } = await draftVersion();
      await advance(versionId, stage === "LOCKED" ? "APPROVED" : stage);
      const q = await seedQuotation(versionId, purpose);
      if (stage === "LOCKED") await seeded((c) => transition(c, d.w, "SALES", "design", versionId, "LOCK", "locked"));
      const r = await issueQuotation(q.id, quotationBody(q));
      expect([label, r.statusCode, problem(r).code, problem(r).context]).toEqual([label, 409, "ISSUE_PRECONDITIONS_FAILED", context]);
    }
    // SUPERSEDED: a FOR_PRODUCTION quotation made while LOCKED; the design is superseded before issue.
    const { designId, versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    const next = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { basedOnVersionId: versionId, changeReason: "successor" } })).json());
    await advance(next.id, "APPROVED");
    expect(await status(versionId)).toBe("SUPERSEDED");
    const superseded = await issueQuotation(q.id, quotationBody(q));
    expect([superseded.statusCode, problem(superseded).code, problem(superseded).context]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED", { status: "SUPERSEDED", blockerCount: 0 }]);
    expect(await sql("SELECT snapshot_id FROM design_os.quotation_issue WHERE project_id = $1 AND design_version_id IN (SELECT id FROM design_os.design_version WHERE entity_id = $2)", [d.projectId, designId])).toEqual([]);
  });

  it("LOCKED + FOR_PRODUCTION succeeds: an immutable decision record; the exact PricingStandard / QuotationPolicy are LOCKED; audited", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    const k = key();
    const r = await issueQuotation(q.id, quotationBody(q), "SALES", k);
    expect(r.statusCode).toBe(201);
    const issue = QuotationIssueResponse.parse(r.json());
    expect(issue).toMatchObject({
      kind: "QUOTATION", snapshotId: q.id, projectId: d.projectId, designVersionId: versionId, revisionNumber: 1, contentHash: q.contentHash,
      pricingStandardVersionId: pricingId(), quotationPolicyVersionId: policyId(), issuedBy: as("SALES"), reason: "Sent to client",
    });
    expect(r.headers.location).toBe(`/api/v1/quotation-snapshots/${q.id}/issue`);
    // The exact commercial basis is now LOCKED: it can never change or be superseded out from under the issue.
    for (const [table, id] of [["pricing_standard_version", pricingId()], ["quotation_policy_version", policyId()]] as const) {
      expect([table, (await sql<{ status: string }>(`SELECT status FROM design_os.${table} WHERE id = $1`, [id]))[0]?.status]).toEqual([table, "LOCKED"]);
    }
    // Readable back; the same key replays; any other attempt is ALREADY_ISSUED.
    expect(QuotationIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: as("COSTING") })).json())).toEqual(issue);
    const replay = await issueQuotation(q.id, quotationBody(q), "SALES", k);
    expect([replay.statusCode, replay.headers["idempotent-replayed"], QuotationIssueResponse.parse(replay.json())]).toEqual([201, "true", issue]);
    const again = await issueQuotation(q.id, quotationBody(q, { reason: "again" }));
    expect([again.statusCode, problem(again).code]).toEqual([409, "ALREADY_ISSUED"]);
    // Audit: the hash-chained audit log holds the full decision record, with actor, reason and request id.
    const [audit] = await sql<{ actor_user_id: string; reason: string; request_id: string | null; new_value: Record<string, unknown> }>(
      "SELECT actor_user_id, reason, request_id, new_value FROM design_os.audit_log WHERE table_name = 'quotation_issue' AND action = 'INSERT' AND new_value ->> 'snapshot_id' = $1", [q.id]);
    expect(audit).toMatchObject({ actor_user_id: as("SALES"), reason: "Sent to client" });
    expect(audit?.request_id).not.toBeNull();
    expect(audit?.new_value).toMatchObject({
      project_id: d.projectId, design_version_id: versionId, snapshot_id: q.id, revision_number: 1, content_hash: q.contentHash, issued_by: as("SALES"),
      pricing_standard_version_id: pricingId(), quotation_policy_version_id: policyId(),
    });
    expect(typeof audit?.new_value.issued_at).toBe("string");
  });

  it("the declared content hash and exact commercial versions must be the quotation's; nothing is recorded or locked on refusal", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    // Another exact version of the same PricingStandard (a DRAFT: approving it would supersede the one in use).
    const other = await newPricingVersion(false);
    for (const [label, over] of [
      ["another PricingStandard version", { pricingStandardVersionId: other }],
      ["another QuotationPolicy version", { quotationPolicyVersionId: randomUUID() }],
      ["another content hash", { expectedContentHash: `sha256:${"a".repeat(64)}` }],
    ] as const) {
      const r = await issueQuotation(q.id, quotationBody(q, over));
      expect([label, r.statusCode, problem(r).code]).toEqual([label, 409, "ISSUE_PRECONDITIONS_FAILED"]);
      expect(problem(r).context?.problems).toEqual([expect.stringMatching(/pricing_standard_version_id|quotation_policy_version_id|content_hash/)]);
    }
    expect(await sql("SELECT 1 FROM design_os.quotation_issue WHERE snapshot_id = $1", [q.id])).toEqual([]);
    // A refused issue locks nothing: the other version named in the request is still a DRAFT.
    expect((await sql<{ status: string }>("SELECT status FROM design_os.pricing_standard_version WHERE id = $1", [other]))[0]?.status).toBe("DRAFT");
  });

  it("BLOCKERs are never issuable: a FOR_PRODUCTION output with BLOCKERs cannot exist (generation refuses it), and a blocked review output cannot be issued", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    // The running engine finds BLOCKERs on the synthetic inputs: FOR_PRODUCTION generation is refused, nothing to issue.
    const gen = await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/quotation-snapshots`, as: as("COSTING"), headers: { "idempotency-key": key() },
      payload: { purpose: "FOR_PRODUCTION", pricingStandardVersionId: pricingId(), quotationPolicyVersionId: policyId() } });
    expect([gen.statusCode, problem(gen).code]).toEqual([409, "VALIDATION_BLOCKERS"]);
    const blocked = await seeded(async (c) => {
      const row = await outputChainRow(c, d.w, versionId, "QUOTATION", d.deps.commercial, { purpose: "FOR_REVIEW", blockers: 2, engineSeed: randomUUID() });
      await insertRow(c, "quotation_snapshot", row);
      return { id: row.id as string, contentHash: row.content_hash as string };
    });
    const r = await issueQuotation(blocked.id, quotationBody(blocked));
    expect([r.statusCode, problem(r).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
  });

  it("permissions: only quotation.issue may issue; another organization sees nothing", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    for (const role of ["DESIGNER", "COSTING", "DESIGN_HEAD"] as const) expect([role, problem(await issueQuotation(q.id, quotationBody(q), role)).code]).toEqual([role, "PERMISSION_DENIED"]);
    const other = await world();
    const foreign = await api.request({ method: "POST", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: other.users.SALES, payload: quotationBody(q), headers: { "idempotency-key": key() } });
    expect([foreign.statusCode, problem(foreign).code]).toEqual([404, "NOT_FOUND"]);
  });
});

describe("concurrency and immutability", () => {
  it("concurrent issue requests for one quotation: exactly one succeeds, the others are ALREADY_ISSUED", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    const results = await Promise.all(Array.from({ length: 5 }, () => issueQuotation(q.id, quotationBody(q))));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(results.filter((r) => r.statusCode === 409).map((r) => problem(r).code)).toEqual(["ALREADY_ISSUED", "ALREADY_ISSUED", "ALREADY_ISSUED", "ALREADY_ISSUED"]);
    expect(await sql("SELECT snapshot_id FROM design_os.quotation_issue WHERE snapshot_id = $1", [q.id])).toHaveLength(1);
  });

  it("an issued revision stays exactly as issued: the record cannot be changed or deleted; a new revision is a new, separate issue", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q1 = await seedQuotation(versionId, "FOR_PRODUCTION", 1);
    const first = QuotationIssueResponse.parse((await issueQuotation(q1.id, quotationBody(q1))).json());
    for (const stmt of ["UPDATE design_os.quotation_issue SET reason = 'edited' WHERE snapshot_id = $1", "DELETE FROM design_os.quotation_issue WHERE snapshot_id = $1",
      "UPDATE design_os.quotation_snapshot SET blocker_count = 1 WHERE id = $1"]) {
      await expect(sql(stmt, [q1.id])).rejects.toMatchObject({ code: "LD015" });
    }
    const q2 = await seedQuotation(versionId, "FOR_PRODUCTION", 2);
    const second = QuotationIssueResponse.parse((await issueQuotation(q2.id, quotationBody(q2, { reason: "Revised" }))).json());
    expect([second.revisionNumber, second.snapshotId]).toEqual([2, q2.id]);
    expect(QuotationIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${q1.id}/issue`, as: as("SALES") })).json())).toEqual(first);
  });
});

describe("drawing issue", () => {
  it("LOCKED + FOR_PRODUCTION drawing: issued with its exact sealed file manifest; the same number + revision cannot be issued twice", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const real = await generatedDrawing(versionId, "KIT-ISS-P");
    const dr = await seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-1");
    const r = await issueDrawing(dr.id, { reason: "Issued for site", expectedContentHash: dr.contentHash });
    expect(r.statusCode).toBe(201);
    const issue = DrawingIssueResponse.parse(r.json());
    expect(issue).toMatchObject({ kind: "DRAWING", snapshotId: dr.id, projectId: d.projectId, designVersionId: versionId, drawingNumber: "KIT-ISS-1", drawingRevision: "A", fileManifestHash: real.manifest, contentHash: dr.contentHash, issuedBy: as("DESIGN_HEAD") });
    const [audit] = await sql<{ new_value: Record<string, unknown> }>("SELECT new_value FROM design_os.audit_log WHERE table_name = 'drawing_issue' AND new_value ->> 'snapshot_id' = $1", [dr.id]);
    expect(audit?.new_value).toMatchObject({ drawing_number: "KIT-ISS-1", drawing_revision: "A", file_manifest_hash: real.manifest, content_hash: dr.contentHash, issued_by: as("DESIGN_HEAD") });
    // Another snapshot with the same drawing number and revision can never be issued; a new revision can.
    const dup = await seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-1");
    const again = await issueDrawing(dup.id, { reason: "again", expectedContentHash: dup.contentHash });
    expect([again.statusCode, problem(again).code]).toEqual([409, "ALREADY_ISSUED"]);
    const revB = await seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-1", "B");
    expect((await issueDrawing(revB.id, { reason: "rev B", expectedContentHash: revB.contentHash })).statusCode).toBe(201);
  });

  it("APPROVED-not-LOCKED, FOR_REVIEW, wrong content hash and missing permission are refused", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "APPROVED");
    const real = await generatedDrawing(versionId, "KIT-ISS-Q");
    const approved = await seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-ISS-2");
    const r1 = await issueDrawing(approved.id, { reason: "x", expectedContentHash: approved.contentHash });
    expect([r1.statusCode, problem(r1).code, problem(r1).context]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED", { status: "APPROVED", blockerCount: 0 }]);
    const review = await seedDrawing(versionId, "FOR_REVIEW", real, "KIT-ISS-3");
    await seeded((c) => transition(c, d.w, "SALES", "design", versionId, "LOCK", "locked"));
    const r2 = await issueDrawing(review.id, { reason: "x", expectedContentHash: review.contentHash });
    expect([r2.statusCode, problem(r2).context]).toEqual([409, { purpose: "FOR_REVIEW" }]);
    const r3 = await issueDrawing(approved.id, { reason: "x", expectedContentHash: `sha256:${"b".repeat(64)}` });
    expect([r3.statusCode, problem(r3).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
    expect(problem(await issueDrawing(approved.id, { reason: "x", expectedContentHash: approved.contentHash }, "DESIGNER")).code).toBe("PERMISSION_DENIED");
  });
});

describe("client visibility (no portal yet; the access rules are explicit and enforced now)", () => {
  it("a CLIENT member sees nothing unissued; after issue only the issued output, its issue record and its files — never drafts, reviews or internal routes", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const real = await generatedDrawing(versionId, "KIT-CLI-P");
    const dr = await seedDrawing(versionId, "FOR_PRODUCTION", real, "KIT-CLI-1");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    /** What the CLIENT identity can read directly under RLS (the future portal's boundary). */
    const asClient = async (query: string, params: unknown[]) => seeded(async (c) => {
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: as("CLIENT"), org_id: d.w.org })]);
      await c.query("SET LOCAL ROLE design_os_api");
      return (await c.query(query, params)).rows as Record<string, string>[];
    });
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
    expect(problem(await api.request({ method: "GET", url: `/api/v1/drawing-snapshots/${dr.id}`, as: as("CLIENT") })).code).toBe("IDENTITY_KIND_MISMATCH");
    expect(problem(await api.request({ method: "GET", url: `/api/v1/design-versions/${versionId}/outputs`, as: as("CLIENT") })).code).toBe("IDENTITY_KIND_MISMATCH");
    const fileId = real.files[0]?.fileId ?? "";
    expect((await api.request({ method: "GET", url: `/api/v1/files/${fileId}/url`, as: as("CLIENT") })).statusCode).toBe(404);

    expect((await issueDrawing(dr.id, { reason: "Issued to client", expectedContentHash: dr.contentHash })).statusCode).toBe(201);
    expect((await issueQuotation(q.id, quotationBody(q))).statusCode).toBe(201);
    const [drawings, quotations, boms, pricings, issues, files] = await visible();
    expect([drawings, quotations, boms, pricings]).toEqual([[{ id: dr.id }], [{ id: q.id }], [], []]);
    expect(issues.map((x) => x.snapshot_id).sort()).toEqual([dr.id, q.id].sort());
    // The issued drawing's files — which the generating (unissued, PRELIMINARY) drawing shares — are readable; a signed URL works.
    expect(files.length).toBe(real.files.length);
    const url = await api.request({ method: "GET", url: `/api/v1/files/${fileId}/url`, as: as("CLIENT") });
    expect(url.statusCode).toBe(200);
    const u = new URL(FileUrlResponse.parse(url.json()).url);
    expect((await api.request({ method: "GET", url: `${u.pathname}${u.search}` })).statusCode).toBe(200);
    // Another project's issues stay invisible to this client.
    expect(await asClient("SELECT snapshot_id FROM design_os.quotation_issue WHERE project_id <> $1", [d.projectId])).toEqual([]);
  });
});

describe("historical issues remain valid (last: it supersedes the world's PricingStandard)", () => {
  it("an issued quotation stays issued, readable and exact after its PricingStandard is superseded by a newer approved version", async () => {
    const { versionId } = await draftVersion();
    await advance(versionId, "LOCKED");
    const q = await seedQuotation(versionId, "FOR_PRODUCTION");
    const issued = QuotationIssueResponse.parse((await issueQuotation(q.id, quotationBody(q))).json());
    const v2 = await newPricingVersion(true);
    expect((await sql<{ status: string }>("SELECT status FROM design_os.pricing_standard_version WHERE id = $1", [pricingId()]))[0]?.status).toBe("SUPERSEDED");
    expect(QuotationIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: as("SALES") })).json())).toEqual(issued);
    // A new quotation must use the new version: the superseded basis cannot be issued again.
    const stale = await seedQuotation(versionId, "FOR_REVIEW", 2);
    const r = await issueQuotation(stale.id, quotationBody(stale));
    expect([r.statusCode, problem(r).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
    expect(v2).not.toBe(pricingId());
  });
});
