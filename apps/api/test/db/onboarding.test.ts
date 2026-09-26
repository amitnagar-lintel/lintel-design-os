/**
 * Organization onboarding API (M6 G4) against PostgreSQL: organization initialisation → first ADMIN accepts →
 * administrators invite named people with internal roles → people accept on first sign-in. Tenant isolation, org
 * selection, the existing RBAC and the submitter ≠ approver rule hold for onboarded people exactly as for anyone.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations } from "../../../db-tools/src/migrations.js";
import { orgInit } from "../../../db-tools/src/org-init.js";
import { hashOf, validationRun } from "../../../../tests/db/support/world.js";
import { VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import { InvitationAccepted, InvitationResponse, MemberResponse, MyInvitationList, OrgMemberList } from "../../src/modules/organization/organization.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { domainWorld, key } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, token, world } from "../support/harness.js";
import { issueFixtures, seeded } from "../support/issue-fixtures.js";

let api: Api;
let d: DomainWorld;
const problem = (r: { json: () => unknown }) => r.json() as Problem;

/** A Supabase Auth user (no Design OS identity yet) and a request as them with a verified (or unverified) email. */
async function authUser(email: string): Promise<string> {
  const id = randomUUID();
  await sql("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
  return id;
}
async function asPerson(userId: string, email: string, opts: { method: "GET" | "POST"; url: string; payload?: unknown; org?: string; verified?: boolean }) {
  const bearer = await token(userId, { email, email_verified: opts.verified ?? true });
  return api.request({ method: opts.method, url: opts.url, headers: { authorization: `Bearer ${bearer}` }, ...(opts.payload === undefined ? {} : { payload: opts.payload as Record<string, unknown> }), ...(opts.org === undefined ? {} : { org: opts.org }) });
}
const newEmail = () => `person.${randomUUID().slice(0, 8)}@lintel.example`;
const invite = (as: string, payload: Record<string, unknown>) => api.request({ method: "POST", url: "/api/v1/org/invitations", as, payload });
const accept = (userId: string, email: string, id: string, verified = true) => asPerson(userId, email, { method: "POST", url: `/api/v1/me/invitations/${id}/accept`, verified });

/** Invite and accept in one go; returns the person's user id. */
async function onboard(d0: { w: { users: { ADMIN: string } } }, roles: string[], name: string): Promise<{ userId: string; email: string }> {
  const email = newEmail();
  const inv = await invite(d0.w.users.ADMIN, { email, displayName: name, roles });
  expect(inv.statusCode).toBe(201);
  const userId = await authUser(email);
  const r = await accept(userId, email, InvitationResponse.parse(inv.json()).id);
  expect(r.statusCode).toBe(200);
  return { userId, email };
}

beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api);
});
afterAll(async () => {
  await api.close();
});

describe("organization initialisation → first ADMIN", () => {
  it("the operator creates the organization and an ADMIN invitation; the named person accepts and administers it", async () => {
    const code = `INIT_${randomUUID().slice(0, 8)}`;
    const email = newEmail();
    const c = await admin();
    let init;
    try {
      init = await orgInit(c, loadMigrations(), { code, name: "Lintel Interiors", adminEmail: email, adminName: "Priya Admin" }, "test-operator");
    } finally {
      await c.end();
    }
    expect(init.outcome).toBe("CREATED");
    if (init.outcome === "REFUSED") return;

    const person = await authUser(email);
    // Before accepting: no organization can be selected.
    expect(problem(await asPerson(person, email, { method: "GET", url: "/api/v1/me", org: init.orgId })).code).toBe("ORG_ACCESS_DENIED");
    const mine = MyInvitationList.parse((await asPerson(person, email, { method: "GET", url: "/api/v1/me/invitations" })).json());
    expect(mine.items).toEqual([expect.objectContaining({ id: init.invitationId, orgId: init.orgId, displayName: "Priya Admin", roles: ["ADMIN"] })]);

    const ok = await accept(person, email, init.invitationId!);
    expect(ok.statusCode).toBe(200);
    expect(InvitationAccepted.parse(ok.json())).toMatchObject({ orgId: init.orgId, userId: person, displayName: "Priya Admin", roles: ["ADMIN"] });
    // Accepting again returns the same result and changes nothing.
    expect(InvitationAccepted.parse((await accept(person, email, init.invitationId!)).json())).toEqual(InvitationAccepted.parse(ok.json()));

    const me = await asPerson(person, email, { method: "GET", url: "/api/v1/me" });
    expect(me.json()).toMatchObject({ userId: person, orgId: init.orgId, identityKind: "INTERNAL", roles: ["ADMIN"] });
    expect(me.json<{ permissions: string[] }>().permissions).toContain("org.members.manage");
    const [user] = await sql<{ display_name: string; email: string; identity_kind: string }>("SELECT display_name, email, identity_kind FROM design_os.app_user WHERE id = $1", [person]);
    expect(user).toEqual({ display_name: "Priya Admin", email, identity_kind: "INTERNAL" });
    // The first ADMIN was granted by the operator's invitation (no inviting user).
    expect(await sql("SELECT role, granted_by FROM design_os.org_membership WHERE org_id = $1", [init.orgId])).toEqual([{ role: "ADMIN", granted_by: null }]);

    // The new ADMIN invites the next person.
    const next = await asPerson(person, email, { method: "POST", url: "/api/v1/org/invitations", payload: { email: newEmail(), displayName: "Ravi Designer", roles: ["DESIGNER"] } });
    expect(next.statusCode).toBe(201);
    expect(InvitationResponse.parse(next.json())).toMatchObject({ orgId: init.orgId, invitedBy: person, status: "PENDING", expired: false });
  });
});

describe("invitations", () => {
  it("only org.members.manage invites; internal roles only, each once; one PENDING per email", async () => {
    const email = newEmail();
    expect(problem(await invite(d.w.users.DESIGN_HEAD, { email, displayName: "A B", roles: ["DESIGNER"] })).code).toBe("PERMISSION_DENIED");
    expect(problem(await invite(d.w.users.CLIENT, { email, displayName: "A B", roles: ["DESIGNER"] })).code).toBe("IDENTITY_KIND_MISMATCH");
    expect(problem(await invite(d.w.users.ADMIN, { email, displayName: "A B", roles: ["CLIENT"] })).code).toBe("VALIDATION_FAILED");
    expect(problem(await invite(d.w.users.ADMIN, { email, displayName: "A B", roles: ["DESIGNER", "DESIGNER"] })).code).toBe("VALIDATION_FAILED");
    expect(problem(await invite(d.w.users.ADMIN, { email, displayName: " ", roles: ["DESIGNER"] })).code).toBe("VALIDATION_FAILED");
    expect(problem(await invite(d.w.users.ADMIN, { email: "not-an-email", displayName: "A B", roles: ["DESIGNER"] })).code).toBe("VALIDATION_FAILED");
    const first = await invite(d.w.users.ADMIN, { email: email.toUpperCase(), displayName: "A B", roles: ["DESIGNER", "SITE_ENGINEER"] });
    expect(first.statusCode).toBe(201);
    expect(InvitationResponse.parse(first.json())).toMatchObject({ email, roles: ["DESIGNER", "SITE_ENGINEER"], invitedBy: d.w.users.ADMIN });
    expect(problem(await invite(d.w.users.ADMIN, { email, displayName: "A B", roles: ["SALES"] })).code).toBe("DUPLICATE_RESOURCE");

    const list = await api.request({ method: "GET", url: "/api/v1/org/invitations?status=PENDING", as: d.w.users.ADMIN });
    expect(list.json<{ items: { email: string }[] }>().items.map((i) => i.email)).toContain(email);
    expect(problem(await api.request({ method: "GET", url: "/api/v1/org/invitations", as: d.w.users.SALES })).code).toBe("PERMISSION_DENIED");
  });

  it("an expired invitation cannot be accepted; inviting again closes it (audited) and issues a new one", async () => {
    const email = newEmail();
    const old = InvitationResponse.parse((await invite(d.w.users.ADMIN, { email, displayName: "Late Person", roles: ["SALES"] })).json());
    await sql("UPDATE design_os.org_invitation SET created_at = now() - interval '20 days', expires_at = now() - interval '1 day' WHERE id = $1", [old.id]);
    const person = await authUser(email);
    expect(MyInvitationList.parse((await asPerson(person, email, { method: "GET", url: "/api/v1/me/invitations" })).json()).items).toEqual([]);
    expect(problem(await accept(person, email, old.id)).code).toBe("INVITATION_INVALID");
    const again = await invite(d.w.users.ADMIN, { email, displayName: "Late Person", roles: ["SALES"] });
    expect(again.statusCode).toBe(201);
    expect(await sql("SELECT status, revoked_by FROM design_os.org_invitation WHERE id = $1", [old.id])).toEqual([{ status: "REVOKED", revoked_by: d.w.users.ADMIN }]);
    expect((await accept(person, email, InvitationResponse.parse(again.json()).id)).statusCode).toBe(200);
  });

  it("a revoked invitation cannot be accepted", async () => {
    const email = newEmail();
    const inv = InvitationResponse.parse((await invite(d.w.users.ADMIN, { email, displayName: "Gone Person", roles: ["SALES"] })).json());
    const revoke = (as: string) => api.request({ method: "POST", url: `/api/v1/org/invitations/${inv.id}/revoke`, as, payload: { reason: "role filled" } });
    expect(problem(await revoke(d.w.users.DESIGN_HEAD)).code).toBe("PERMISSION_DENIED");
    const r = await revoke(d.w.users.ADMIN);
    expect([r.statusCode, InvitationResponse.parse(r.json()).status]).toEqual([200, "REVOKED"]);
    expect(problem(await revoke(d.w.users.ADMIN)).code).toBe("INVITATION_INVALID");
    const person = await authUser(email);
    expect(problem(await accept(person, email, inv.id)).code).toBe("INVITATION_INVALID");
  });
});

describe("accepting: only the invited person, with a verified email", () => {
  it("refuses an unverified email, another email, another person and a mismatched Supabase Auth record", async () => {
    const email = newEmail();
    const inv = InvitationResponse.parse((await invite(d.w.users.ADMIN, { email, displayName: "Asha Rao", roles: ["DESIGNER"] })).json());
    const person = await authUser(email);
    expect(problem(await accept(person, email, inv.id, false)).code).toBe("EMAIL_NOT_VERIFIED");
    expect(problem(await asPerson(person, email, { method: "GET", url: "/api/v1/me/invitations", verified: false })).code).toBe("EMAIL_NOT_VERIFIED");
    const stranger = await authUser(newEmail());
    expect(problem(await accept(stranger, email, inv.id)).code).toBe("NOT_FOUND"); // token claims the email; Supabase Auth says otherwise
    const strangerEmail = (await sql<{ email: string }>("SELECT email FROM auth.users WHERE id = $1", [stranger]))[0]!.email;
    expect(problem(await accept(stranger, strangerEmail, inv.id)).code).toBe("NOT_FOUND");
    expect(problem(await asPerson(person, email, { method: "POST", url: `/api/v1/me/invitations/${randomUUID()}/accept` })).code).toBe("NOT_FOUND");
    expect(await sql("SELECT id FROM design_os.app_user WHERE id = ANY ($1::uuid[])", [[person, stranger]])).toEqual([]);
    expect((await accept(person, email, inv.id)).statusCode).toBe(200);
  });

  it("a CLIENT identity can never accept an internal invitation", async () => {
    const [clientEmail] = await sql<{ email: string }>("SELECT email FROM design_os.app_user WHERE id = $1", [d.w.users.CLIENT]);
    const inv = InvitationResponse.parse((await invite(d.w.users.ADMIN, { email: clientEmail!.email, displayName: "Client Person", roles: ["DESIGNER"] })).json());
    expect(problem(await accept(d.w.users.CLIENT, clientEmail!.email, inv.id)).code).toBe("MEMBERSHIP_RULE_VIOLATION");
  });
});

describe("tenant isolation and organization selection", () => {
  it("an onboarded person can select only organizations they belong to; administrators act only in their own", async () => {
    const other = await world();
    const p = await onboard(d, ["DESIGNER"], "Neha Isolated");
    expect((await asPerson(p.userId, p.email, { method: "GET", url: "/api/v1/me/organizations" })).json()).toEqual({ items: [{ orgId: d.w.org }] });
    expect(problem(await asPerson(p.userId, p.email, { method: "GET", url: "/api/v1/me", org: other.org })).code).toBe("ORG_ACCESS_DENIED");
    expect(problem(await asPerson(p.userId, p.email, { method: "GET", url: "/api/v1/me", org: randomUUID() })).code).toBe("ORG_ACCESS_DENIED");

    // The other organization's ADMIN sees nothing of this one: invitations, members, grants.
    const inv = InvitationResponse.parse((await invite(d.w.users.ADMIN, { email: newEmail(), displayName: "X Y", roles: ["SALES"] })).json());
    expect(problem(await api.request({ method: "GET", url: `/api/v1/org/invitations/${inv.id}`, as: other.users.ADMIN })).code).toBe("NOT_FOUND");
    expect(problem(await api.request({ method: "POST", url: `/api/v1/org/invitations/${inv.id}/revoke`, as: other.users.ADMIN, payload: { reason: "x" } })).code).toBe("NOT_FOUND");
    expect(problem(await api.request({ method: "GET", url: `/api/v1/org/members/${p.userId}`, as: other.users.ADMIN })).code).toBe("NOT_FOUND");
    expect(problem(await api.request({ method: "POST", url: `/api/v1/org/members/${p.userId}/roles`, as: other.users.ADMIN, payload: { role: "ADMIN", reason: "takeover" } })).code).toBe("NOT_FOUND");
    const theirs = OrgMemberList.parse((await api.request({ method: "GET", url: "/api/v1/org/members", as: other.users.ADMIN })).json());
    expect(theirs.items.map((m) => m.userId)).not.toContain(p.userId);
    // An invitation of another organization is invisible to its addressee's other organizations' admins and to strangers.
    expect(problem(await api.request({ method: "GET", url: `/api/v1/org/invitations/${inv.id}`, as: d.w.users.DESIGNER })).code).toBe("PERMISSION_DENIED");
  });
});

describe("member roles (existing RBAC stays authoritative)", () => {
  it("lists named members; grants and revokes roles of existing members; keeps at least one ADMIN", async () => {
    const p = await onboard(d, ["SITE_ENGINEER"], "Kiran Site");
    const list = OrgMemberList.parse((await api.request({ method: "GET", url: "/api/v1/org/members", as: d.w.users.DESIGNER })).json());
    expect(list.items.find((m) => m.userId === p.userId)).toMatchObject({ displayName: "Kiran Site", roles: ["SITE_ENGINEER"], status: "ACTIVE" });

    const grant = (as: string, body: Record<string, unknown>, userId = p.userId) => api.request({ method: "POST", url: `/api/v1/org/members/${userId}/roles`, as, payload: body });
    const revoke = (as: string, body: Record<string, unknown>, userId = p.userId) => api.request({ method: "POST", url: `/api/v1/org/members/${userId}/roles/revoke`, as, payload: body });
    expect(problem(await grant(d.w.users.DESIGN_HEAD, { role: "DESIGNER", reason: "x" })).code).toBe("PERMISSION_DENIED");
    expect(problem(await grant(d.w.users.ADMIN, { role: "CLIENT", reason: "x" })).code).toBe("VALIDATION_FAILED");
    const granted = await grant(d.w.users.ADMIN, { role: "DESIGNER", reason: "also designs" });
    expect(MemberResponse.parse(granted.json()).roles).toEqual(["DESIGNER", "SITE_ENGINEER"]);
    expect(problem(await grant(d.w.users.ADMIN, { role: "DESIGNER", reason: "again" })).code).toBe("DUPLICATE_RESOURCE");
    // The new role's actions come from the organization's role → action grants, exactly as for everyone else.
    const me = await asPerson(p.userId, p.email, { method: "GET", url: "/api/v1/me" });
    expect(me.json<{ permissions: string[] }>().permissions).toEqual(expect.arrayContaining(["design_version.author", "room.survey.write"]));
    expect(me.json<{ permissions: string[] }>().permissions).not.toContain("design_version.approve");

    const revoked = await revoke(d.w.users.ADMIN, { role: "DESIGNER", reason: "moved" });
    expect(MemberResponse.parse(revoked.json()).roles).toEqual(["SITE_ENGINEER"]);
    expect(problem(await revoke(d.w.users.ADMIN, { role: "DESIGNER", reason: "moved" })).code).toBe("NOT_FOUND");
    // Re-granting re-activates the same membership row (audited), granted by the current administrator.
    expect(MemberResponse.parse((await grant(d.w.users.ADMIN, { role: "DESIGNER", reason: "back" })).json()).memberships)
      .toContainEqual(expect.objectContaining({ role: "DESIGNER", status: "ACTIVE", grantedBy: d.w.users.ADMIN }));

    // CLIENT identities hold only the CLIENT role (existing guard).
    expect(problem(await grant(d.w.users.ADMIN, { role: "DESIGNER", reason: "x" }, d.w.users.CLIENT)).code).toBe("MEMBERSHIP_RULE_VIOLATION");
    // The last active ADMIN cannot be removed; with a second ADMIN it can.
    expect(problem(await revoke(d.w.users.ADMIN, { role: "ADMIN", reason: "leaving" }, d.w.users.ADMIN)).code).toBe("LAST_ADMIN");
    const second = await onboard(d, ["ADMIN"], "Second Admin");
    expect((await revoke(d.w.users.ADMIN, { role: "ADMIN", reason: "handover" }, second.userId)).statusCode).toBe(200);
    // Every change is in the organization's hash-chained audit log with the actor and reason.
    const audit = await sql<{ reason: string }>("SELECT reason FROM design_os.audit_log WHERE org_id = $1 AND table_name = 'org_membership' AND actor_user_id = $2 ORDER BY id", [d.w.org, d.w.users.ADMIN]);
    expect(audit.map((a) => a.reason)).toEqual(expect.arrayContaining(["also designs", "moved", "back", "handover"]));
    expect((await sql<{ ok: boolean }>("SELECT ok FROM design_os.verify_audit_chain($1)", [d.w.org]))[0]?.ok).toBe(true);
  });
});

describe("named submitter / approver", () => {
  it("onboarded people submit and approve under their own names; the submitter can never approve their own submission", async () => {
    const dd = await domainWorld(api);
    const f = issueFixtures(api, dd);
    const submitter = await onboard(dd, ["DESIGNER", "DESIGN_HEAD"], "Sunil Submitter");
    const approver = await onboard(dd, ["DESIGN_HEAD"], "Anita Approver");
    const { versionId } = await f.draftVersion();
    const [v] = await sql<{ input_hash: string }>("SELECT input_hash FROM design_os.design_version WHERE id = $1", [versionId]);
    await seeded((c) => validationRun(c, dd.w, versionId, v!.input_hash, 0));

    const current = async () => {
      const r = await api.request({ method: "GET", url: `/api/v1/design-versions/${versionId}`, as: dd.w.users.DESIGN_HEAD });
      return { v: VersionResponse.parse(r.json()), etag: r.headers.etag as string };
    };
    const transition = async (person: { userId: string; email: string }, body: Record<string, unknown>) => {
      const bearer = await token(person.userId, { email: person.email, email_verified: true });
      return api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/transitions`, payload: body,
        headers: { authorization: `Bearer ${bearer}`, "if-match": (await current()).etag, "idempotency-key": key() } });
    };
    expect((await transition(submitter, { action: "SUBMIT", reason: "ready for review" })).statusCode).toBe(200);
    const inReview = (await current()).v;
    expect([inReview.status, inReview.submittedBy]).toEqual(["IN_REVIEW", submitter.userId]);

    const self = await transition(submitter, { action: "APPROVE", reason: "approve my own", expectedContentHash: inReview.contentHash });
    expect([self.statusCode, problem(self).code]).toEqual([403, "SEPARATION_OF_DUTIES"]);
    const ok = await transition(approver, { action: "APPROVE", reason: "checked", expectedContentHash: inReview.contentHash });
    expect(ok.statusCode).toBe(200);
    expect(VersionResponse.parse(ok.json())).toMatchObject({ status: "APPROVED", submittedBy: submitter.userId, approvedBy: approver.userId });
    await seeded(async (c) => { expect(await hashOf(c, "design", versionId)).toBe(inReview.contentHash); });

    // The names on record are the administrator-given names of the two different people.
    const members = OrgMemberList.parse((await api.request({ method: "GET", url: "/api/v1/org/members", as: dd.w.users.DESIGN_HEAD })).json()).items;
    expect(members.find((m) => m.userId === submitter.userId)?.displayName).toBe("Sunil Submitter");
    expect(members.find((m) => m.userId === approver.userId)?.displayName).toBe("Anita Approver");
  });
});
