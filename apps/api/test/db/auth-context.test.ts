/**
 * Authentication → verified membership → org context → identity kind → action permission, through HTTP against
 * the real database. X-Org only selects among the identity's ACTIVE memberships; it never establishes access.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";
import { ProbeModule } from "../support/probe.module.js";

let api: Api;
let a: World;
let b: World;
beforeAll(async () => {
  api = await startApi([ProbeModule]);
  a = await world();
  b = await world();
});
afterAll(async () => {
  await api.close();
});

const problem = (r: { json: () => unknown }) => r.json() as Problem;

describe("authentication", () => {
  it("no token, a garbage token or a token for an unknown identity never reach data", async () => {
    expect((await api.request({ method: "GET", url: "/api/v1/me" })).statusCode).toBe(401);
    expect((await api.request({ method: "GET", url: "/api/v1/me", headers: { authorization: "Bearer x.y.z" } })).statusCode).toBe(401);
    const stranger = await api.request({ method: "GET", url: "/api/v1/me", as: randomUUID() });
    expect([stranger.statusCode, problem(stranger).code]).toEqual([403, "ORG_ACCESS_DENIED"]);
  });
  it("GET /me: the verified identity, org context and the effective permissions of the role", async () => {
    const r = await api.request({ method: "GET", url: "/api/v1/me", as: a.users.DESIGNER });
    expect(r.statusCode).toBe(200);
    const me = r.json<{ userId: string; orgId: string; identityKind: string; roles: string[]; permissions: string[] }>();
    expect(me).toMatchObject({ userId: a.users.DESIGNER, orgId: a.org, identityKind: "INTERNAL", roles: ["DESIGNER"] });
    const granted = (await sql<{ action: string }>("SELECT action FROM design_os.role_permission WHERE org_id = $1 AND role = 'DESIGNER' ", [a.org])).map((x) => x.action).sort(); // code-point order: independent of the server collation
    expect(me.permissions).toEqual(granted);
    expect(me.permissions).toContain("design_version.author");
    expect(me.permissions).not.toContain("design_version.approve");
  });
});

describe("X-Org → authenticated membership resolution", () => {
  it("one membership: X-Org is optional; several: X-Org is required and selects among them", async () => {
    const u = a.users.SALES;
    await sql("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'SALES')", [b.org, u]);
    try {
      const ambiguous = await api.request({ method: "GET", url: "/api/v1/me", as: u });
      expect([ambiguous.statusCode, problem(ambiguous).code]).toEqual([400, "ORG_SELECTION_REQUIRED"]);
      expect((await api.request({ method: "GET", url: "/api/v1/me", as: u, org: a.org })).json<{ orgId: string }>().orgId).toBe(a.org);
      expect((await api.request({ method: "GET", url: "/api/v1/me", as: u, org: b.org.toUpperCase() })).json<{ orgId: string }>().orgId).toBe(b.org);
      const orgs = await api.request({ method: "GET", url: "/api/v1/me/organizations", as: u });
      expect(orgs.json<{ items: { orgId: string }[] }>().items.map((x) => x.orgId).sort()).toEqual([a.org, b.org].sort());
    } finally {
      await sql("DELETE FROM design_os.org_membership WHERE org_id = $1 AND user_id = $2", [b.org, u]);
    }
  });
  it("X-Org of another tenant and of a non-existent org get the SAME 403 (existence is never revealed)", async () => {
    const foreign = await api.request({ method: "GET", url: "/api/v1/me", as: a.users.DESIGNER, org: b.org });
    const missing = await api.request({ method: "GET", url: "/api/v1/me", as: a.users.DESIGNER, org: randomUUID() });
    const strip = (p: Problem) => ({ ...p, requestId: "-" });
    expect([foreign.statusCode, missing.statusCode]).toEqual([403, 403]);
    expect(strip(problem(foreign))).toEqual(strip(problem(missing)));
    expect(problem(foreign).code).toBe("ORG_ACCESS_DENIED");
    expect(JSON.stringify(problem(foreign))).not.toContain(b.org);
  });
  it("a malformed X-Org is a validation error, not an access decision", async () => {
    const r = await api.request({ method: "GET", url: "/api/v1/me", as: a.users.DESIGNER, org: "not-a-uuid" });
    expect([r.statusCode, problem(r).code, problem(r).errors?.[0]?.path]).toEqual([400, "VALIDATION_FAILED", "headers.x-org"]);
  });
  it("suspended / inactive organizations and revoked memberships are refused on the very next request", async () => {
    const w = await world();
    const u = w.users.DESIGNER;
    expect((await api.request({ method: "GET", url: "/api/v1/me", as: u })).statusCode).toBe(200);
    for (const status of ["SUSPENDED", "INACTIVE"]) {
      await sql("UPDATE design_os.organization SET status = $2 WHERE id = $1", [w.org, status]);
      const r = await api.request({ method: "GET", url: "/api/v1/me", as: u, org: w.org });
      expect([status, r.statusCode, problem(r).code]).toEqual([status, 403, "ORG_ACCESS_DENIED"]);
      expect((await api.request({ method: "GET", url: "/api/v1/me/organizations", as: u })).json()).toEqual({ items: [] });
    }
    await sql("UPDATE design_os.organization SET status = 'ACTIVE' WHERE id = $1", [w.org]);
    expect((await api.request({ method: "GET", url: "/api/v1/me", as: u })).statusCode).toBe(200);
    await sql("UPDATE design_os.org_membership SET status = 'REVOKED' WHERE org_id = $1 AND user_id = $2", [w.org, u]);
    expect(problem(await api.request({ method: "GET", url: "/api/v1/me", as: u, org: w.org })).code).toBe("ORG_ACCESS_DENIED");
  });
});

describe("identity kind and action permissions", () => {
  it("CLIENT identities cannot use internal routes; internal identities cannot use client routes", async () => {
    const c = await api.request({ method: "GET", url: "/api/v1/__probe/internal", as: a.users.CLIENT });
    expect([c.statusCode, problem(c).code]).toEqual([403, "IDENTITY_KIND_MISMATCH"]);
    expect((await api.request({ method: "GET", url: "/api/v1/__probe/portal", as: a.users.CLIENT })).statusCode).toBe(200);
    const i = await api.request({ method: "GET", url: "/api/v1/__probe/portal", as: a.users.DESIGNER });
    expect([i.statusCode, problem(i).code]).toEqual([403, "IDENTITY_KIND_MISMATCH"]);
    expect((await api.request({ method: "GET", url: "/api/v1/me", as: a.users.CLIENT })).json<{ identityKind: string; permissions: string[] }>())
      .toMatchObject({ identityKind: "CLIENT", permissions: ["output.read.issued"] });
  });
  it("the guard maps routes to the database action vocabulary: allowed roles pass, others get PERMISSION_DENIED", async () => {
    for (const [role, status] of [["SALES", 200], ["DESIGN_HEAD", 200], ["ADMIN", 200], ["DESIGNER", 403], ["COSTING", 403], ["FINANCE", 403]] as const) {
      const r = await api.request({ method: "GET", url: "/api/v1/__probe/write-guarded", as: a.users[role] });
      expect([role, r.statusCode, r.statusCode === 403 ? problem(r).code : "ok"]).toEqual([role, status, status === 403 ? "PERMISSION_DENIED" : "ok"]);
    }
  });
});
