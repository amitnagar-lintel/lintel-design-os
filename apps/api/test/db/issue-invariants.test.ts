/**
 * Issue invariants (M5 Step 7 checkpoint 4 review): cross-tenant invisibility, atomic locking (nothing partial,
 * nothing unrelated), immutability of an issued drawing's files and manifest, and client visibility across two
 * projects / clients of one organization. Own committed world, so no other test's supersession can interfere.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "../../../../tests/db/support/world.js";
import { DrawingIssueResponse, QuotationIssueResponse } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { domainWorld, key, SURVEY } from "../support/domain.js";
import { issueFixtures, readAs, seeded } from "../support/issue-fixtures.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
let fx: ReturnType<typeof issueFixtures>;
beforeAll(async () => {
  api = await startApi([], { poolMax: 10 });
  d = await domainWorld(api, { commercial: "approved" });
  fx = issueFixtures(api, d);
  for (const role of ["COSTING", "DESIGN_HEAD"] as const) {
    expect((await api.request({ method: "POST", url: `/api/v1/projects/${d.projectId}/members`, as: d.w.users.SALES, payload: { userId: d.w.users[role], role } })).statusCode).toBe(201);
  }
});
afterAll(async () => {
  await api.close();
});

const problem = (r: { json: () => unknown }) => r.json() as Problem;

/** Every versioned record of the organization with its lifecycle status (to prove exactly which ones an issue locked). */
async function versionStatuses(): Promise<Map<string, string>> {
  const tables = await sql<{ version_table: string }>("SELECT version_table::text AS version_table FROM design_os.versioned_table ORDER BY subject_type");
  const out = new Map<string, string>();
  for (const { version_table: t } of tables) {
    for (const r of await sql<{ id: string; status: string }>(`SELECT id, status FROM ${t} WHERE org_id = $1`, [d.w.org])) out.set(`${t}:${r.id}`, r.status);
  }
  return out;
}
/** Every status change between two snapshots of the organization's versions, as "<version table>:<before>→<after>". */
const diff = (a: Map<string, string>, b: Map<string, string>) => [...b].filter(([k, v]) => a.get(k) !== v).map(([k, v]) => `${k.split(":")[0] ?? ""}:${a.get(k) ?? "new"}→${v}`).sort();

/** Make `userId` an ACTIVE contact of `clientId` and a CLIENT member of `projectId`. */
async function clientMember(userId: string, clientId: string, projectId: string): Promise<void> {
  await seeded(async (c) => {
    const [contact] = (await c.query("INSERT INTO design_os.client_contact (org_id, client_id, email, display_name, user_id, status, invited_by) VALUES ($1, $2, $3, 'Client', $4, 'ACTIVE', $5) RETURNING id",
      [d.w.org, clientId, `contact.${randomUUID().slice(0, 6)}@client.example`, userId, d.w.users.SALES])).rows as { id: string }[];
    await c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, client_contact_id, granted_by) VALUES ($1, $2, $3, 'CLIENT', $4, $5)", [d.w.org, projectId, userId, contact?.id, d.w.users.SALES]);
  });
}

describe("atomicity: issue locks exactly the quotation's commercial versions, together with the record — or nothing", () => {
  it("a refused issue leaves no lock, no decision and no record; a successful one locks exactly the PricingStandard and QuotationPolicy it was priced with", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    const unrelated = await fx.newPricingVersion(false);
    const decisions = async () => sql<{ subject_type: string; subject_id: string; action: string }>("SELECT subject_type, subject_id, action FROM design_os.approval_decision WHERE org_id = $1 ORDER BY id", [d.w.org]);
    const before = await versionStatuses();
    const decisionsBefore = await decisions();
    expect([before.get(`design_os.pricing_standard_version:${fx.pricingId()}`), before.get(`design_os.quotation_policy_version:${fx.policyId()}`)]).toEqual(["APPROVED", "APPROVED"]);

    // Refused inside check_issue: the transaction rolls back as a whole — no record, no LOCK, no decision.
    const refused = await fx.issueQuotation(q.id, fx.quotationBody(q, { expectedContentHash: `sha256:${"c".repeat(64)}` }));
    expect([refused.statusCode, problem(refused).code]).toEqual([409, "ISSUE_PRECONDITIONS_FAILED"]);
    expect(diff(before, await versionStatuses())).toEqual([]);
    expect(await decisions()).toEqual(decisionsBefore);
    expect(await sql("SELECT 1 FROM design_os.quotation_issue WHERE snapshot_id = $1", [q.id])).toEqual([]);

    // Issued: the record and exactly two LOCKs, in one transaction; nothing else changes (the DRAFT sibling stays DRAFT).
    expect((await fx.issueQuotation(q.id, fx.quotationBody(q))).statusCode).toBe(201);
    expect(diff(before, await versionStatuses())).toEqual(["design_os.pricing_standard_version:APPROVED→LOCKED", "design_os.quotation_policy_version:APPROVED→LOCKED"]);
    expect((await decisions()).slice(decisionsBefore.length)).toEqual([
      { subject_type: "pricing_standard", subject_id: fx.pricingId(), action: "LOCK" },
      { subject_type: "quotation_policy", subject_id: fx.policyId(), action: "LOCK" },
    ]);
    expect((await sql<{ status: string }>("SELECT status FROM design_os.pricing_standard_version WHERE id = $1", [unrelated]))[0]?.status).toBe("DRAFT");
    // The record and the locks share one transaction: same transaction timestamp.
    const [times] = await sql<{ issued: string; locked: string }>(`SELECT i.issued_at::text AS issued, p.locked_at::text AS locked FROM design_os.quotation_issue i
      JOIN design_os.pricing_standard_version p ON p.id = i.pricing_standard_version_id WHERE i.snapshot_id = $1`, [q.id]);
    expect(times?.issued).toBe(times?.locked);
  });

  it("a drawing issue locks nothing: the design is already LOCKED and drawings have no commercial basis", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const real = await fx.generatedDrawing(versionId, "INV-P");
    const dr = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "INV-1");
    const before = await versionStatuses();
    expect((await fx.issueDrawing(dr.id, { reason: "site", expectedContentHash: dr.contentHash })).statusCode).toBe(201);
    expect(diff(before, await versionStatuses())).toEqual([]);
  });
});

describe("immutability of an issued drawing and its files", () => {
  it("the snapshot, its manifest, its file links, its file objects and the issue record cannot be changed", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const real = await fx.generatedDrawing(versionId, "IMM-P");
    const dr = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "IMM-1");
    const issued = DrawingIssueResponse.parse((await fx.issueDrawing(dr.id, { reason: "site", expectedContentHash: dr.contentHash })).json());
    const fileId = real.files[0]?.fileId ?? "";
    for (const [label, stmt, params] of [
      ["snapshot manifest", "UPDATE design_os.drawing_snapshot SET file_manifest_hash = $2 WHERE id = $1", [dr.id, `sha256:${"d".repeat(64)}`]],
      ["snapshot payload", "UPDATE design_os.drawing_snapshot SET payload = '{}'::jsonb WHERE id = $1", [dr.id]],
      ["snapshot delete", "DELETE FROM design_os.drawing_snapshot WHERE id = $1", [dr.id]],
      ["file link swap", "UPDATE design_os.drawing_snapshot_file SET file_object_id = file_object_id WHERE snapshot_id = $1", [dr.id]],
      ["file link delete", "DELETE FROM design_os.drawing_snapshot_file WHERE snapshot_id = $1", [dr.id]],
      ["file object", "UPDATE design_os.file_object SET checksum = $2 WHERE id = $1", [fileId, `sha256:${"e".repeat(64)}`]],
      ["issue record", "UPDATE design_os.drawing_issue SET drawing_revision = 'Z' WHERE snapshot_id = $1", [dr.id]],
      ["issue delete", "DELETE FROM design_os.drawing_issue WHERE snapshot_id = $1", [dr.id]],
    ] as const) {
      await expect(sql(stmt, [...params]).then(() => "changed"), label).rejects.toMatchObject({ code: "LD015" });
    }
    // Adding a file to the sealed manifest is refused at commit (LD016).
    await expect(seeded((c) => c.query("INSERT INTO design_os.drawing_snapshot_file (org_id, snapshot_id, sequence, format, sheet_index, file_object_id) VALUES ($1, $2, 99, 'SVG', 99, $3)", [d.w.org, dr.id, fileId])))
      .rejects.toMatchObject({ code: "LD016" });
    // A second issue record for the same snapshot is refused (append-only: one record per snapshot).
    expect(problem(await fx.issueDrawing(dr.id, { reason: "again", expectedContentHash: dr.contentHash })).code).toBe("ALREADY_ISSUED");
    expect(DrawingIssueResponse.parse((await api.request({ method: "GET", url: `/api/v1/drawing-snapshots/${dr.id}/issue`, as: fx.as("DESIGNER") })).json())).toEqual(issued);
  });
});

describe("permissions and tenancy", () => {
  it("unauthorized users get PERMISSION_DENIED (403); another organization sees no issue record at all (404 / no rows)", async () => {
    const { versionId } = await fx.draftVersion();
    await fx.advance(versionId, "LOCKED");
    const q = await fx.seedQuotation(versionId, "FOR_PRODUCTION");
    const real = await fx.generatedDrawing(versionId, "TEN-P");
    const dr = await fx.seedDrawing(versionId, "FOR_PRODUCTION", real, "TEN-1");
    for (const role of ["DESIGNER", "SITE_ENGINEER", "FINANCE"] as const) {
      const r = await fx.issueQuotation(q.id, fx.quotationBody(q), role);
      expect([role, r.statusCode, problem(r).code, problem(r).type]).toEqual([role, 403, "PERMISSION_DENIED", "urn:lintel-design-os:problem:permission-denied"]);
    }
    for (const role of ["SALES", "COSTING", "DESIGNER"] as const) expect([role, problem(await fx.issueDrawing(dr.id, { reason: "x", expectedContentHash: dr.contentHash }, role)).code]).toEqual([role, "PERMISSION_DENIED"]);
    expect((await fx.issueQuotation(q.id, fx.quotationBody(q))).statusCode).toBe(201);
    expect((await fx.issueDrawing(dr.id, { reason: "x", expectedContentHash: dr.contentHash })).statusCode).toBe(201);

    const other = await world();
    for (const path of [`quotation-snapshots/${q.id}/issue`, `drawing-snapshots/${dr.id}/issue`]) {
      const r = await api.request({ method: "GET", url: `/api/v1/${path}`, as: other.users.DESIGN_HEAD });
      expect([path, r.statusCode, problem(r).code]).toEqual([path, 404, "NOT_FOUND"]);
    }
    const foreign = readAs(other.users.SALES, other.org);
    expect(await foreign("SELECT snapshot_id FROM design_os.quotation_issue WHERE snapshot_id = $1 UNION ALL SELECT snapshot_id FROM design_os.drawing_issue WHERE snapshot_id = $2", [q.id, dr.id])).toEqual([]);
    expect(await foreign("SELECT id FROM design_os.quotation_snapshot WHERE id = $1", [q.id])).toEqual([]);
    const reissue = await api.request({ method: "POST", url: `/api/v1/quotation-snapshots/${q.id}/issue`, as: other.users.SALES, payload: fx.quotationBody(q), headers: { "idempotency-key": key() } });
    expect([reissue.statusCode, problem(reissue).code]).toEqual([404, "NOT_FOUND"]);
  });
});

describe("client visibility across two projects of one organization", () => {
  it("each project's CLIENT reads exactly its own issued outputs; unissued, PRELIMINARY and FOR_REVIEW outputs and the other client's issues stay hidden", async () => {
    // Project 1 (the world's) and project 2 (a second client of the same organization), each with a CLIENT member.
    const client2 = await api.request({ method: "POST", url: "/api/v1/clients", as: d.w.users.SALES, payload: { clientCode: `C2-${d.w.org.slice(0, 6)}`, name: "Second client" } });
    const client2Id = client2.json<{ id: string }>().id;
    const project2 = await api.request({ method: "POST", url: "/api/v1/projects", as: d.w.users.SALES, payload: { clientId: client2Id, projectCode: `P2-${d.w.org.slice(0, 6)}`, name: "Second kitchen" } });
    const project2Id = project2.json<{ id: string }>().id;
    for (const role of ["DESIGNER", "SITE_ENGINEER", "COSTING", "DESIGN_HEAD"] as const) {
      expect((await api.request({ method: "POST", url: `/api/v1/projects/${project2Id}/members`, as: d.w.users.SALES, payload: { userId: d.w.users[role], role } })).statusCode).toBe(201);
    }
    const room2 = await api.request({ method: "POST", url: `/api/v1/projects/${project2Id}/rooms`, as: d.w.users.SITE_ENGINEER, headers: { "idempotency-key": key() }, payload: { name: "Kitchen 2", roomType: "KITCHEN", initialSurvey: SURVEY } });
    const fx2 = issueFixtures(api, d, { roomId: room2.json<{ id: string }>().id });
    const secondClientUser = await seeded(async (c) => {
      const id = await createUser(c, `client2.${randomUUID().slice(0, 6)}@client.example`, "CLIENT");
      await c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'CLIENT')", [d.w.org, id]);
      return id;
    });
    await clientMember(d.w.users.CLIENT, d.clientId, d.projectId);
    await clientMember(secondClientUser, client2Id, project2Id);

    const outputs = async (f: typeof fx, n: string) => {
      const { versionId } = await f.draftVersion();
      await f.advance(versionId, "LOCKED");
      const real = await f.generatedDrawing(versionId, `${n}-P`);
      const issuedDrawing = await f.seedDrawing(versionId, "FOR_PRODUCTION", real, `${n}-1`);
      const reviewDrawing = await f.seedDrawing(versionId, "FOR_REVIEW", real, `${n}-2`);
      const unissuedDrawing = await f.seedDrawing(versionId, "FOR_PRODUCTION", real, `${n}-3`);
      const issuedQuotation = await f.seedQuotation(versionId, "FOR_PRODUCTION", 1);
      const reviewQuotation = await f.seedQuotation(versionId, "FOR_REVIEW", 2);
      expect((await f.issueDrawing(issuedDrawing.id, { reason: "client", expectedContentHash: issuedDrawing.contentHash })).statusCode).toBe(201);
      QuotationIssueResponse.parse((await f.issueQuotation(issuedQuotation.id, f.quotationBody(issuedQuotation))).json());
      return { versionId, preliminaryDrawing: real.id, issuedDrawing, reviewDrawing, unissuedDrawing, issuedQuotation, reviewQuotation };
    };
    const p1 = await outputs(fx, "CV1");
    const p2 = await outputs(fx2, "CV2");

    const sees = async (userId: string) => {
      const read = readAs(userId, d.w.org);
      const ids = (rows: Record<string, string>[]) => rows.map((r) => r.id ?? r.snapshot_id).sort();
      const all = [p1.versionId, p2.versionId];
      return {
        drawings: ids(await read("SELECT id FROM design_os.drawing_snapshot WHERE design_version_id = ANY($1::uuid[])", [all])),
        quotations: ids(await read("SELECT id FROM design_os.quotation_snapshot WHERE design_version_id = ANY($1::uuid[])", [all])),
        engineering: ids(await read("SELECT id FROM design_os.bom_snapshot WHERE design_version_id = ANY($1::uuid[]) UNION ALL SELECT id FROM design_os.pricing_snapshot WHERE design_version_id = ANY($1::uuid[])", [all])),
        issues: ids(await read("SELECT snapshot_id FROM design_os.drawing_issue WHERE design_version_id = ANY($1::uuid[]) UNION ALL SELECT snapshot_id FROM design_os.quotation_issue WHERE design_version_id = ANY($1::uuid[])", [all])),
      };
    };
    const expected = (p: typeof p1) => ({
      drawings: [p.issuedDrawing.id], quotations: [p.issuedQuotation.id], engineering: [], issues: [p.issuedDrawing.id, p.issuedQuotation.id].sort(),
    });
    expect(await sees(d.w.users.CLIENT)).toEqual(expected(p1));
    expect(await sees(secondClientUser)).toEqual(expected(p2));
    // Nothing unissued, PRELIMINARY or FOR_REVIEW ever appears, for either client.
    const hidden = (p: typeof p1) => [p.preliminaryDrawing, p.reviewDrawing.id, p.unissuedDrawing.id, p.reviewQuotation.id];
    for (const u of [d.w.users.CLIENT, secondClientUser]) {
      const s = await sees(u);
      for (const id of [...hidden(p1), ...hidden(p2)]) expect([...s.drawings, ...s.quotations]).not.toContain(id);
    }
    // Issue records of the other client's project: 404 through the API as well (CLIENT identities use no internal route).
    expect(problem(await api.request({ method: "GET", url: `/api/v1/quotation-snapshots/${p2.issuedQuotation.id}/issue`, as: d.w.users.CLIENT })).code).toBe("IDENTITY_KIND_MISMATCH");
    expect((await readAs(d.w.users.CLIENT, d.w.org)("SELECT snapshot_id FROM design_os.quotation_issue WHERE project_id = $1", [project2Id]))).toEqual([]);
  });
});
