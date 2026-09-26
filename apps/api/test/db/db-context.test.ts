/**
 * Database / RLS context propagation: every operation runs as design_os_api with transaction-local claims for the
 * VERIFIED org, re-verified in-transaction; nothing leaks to the next user of a pooled connection; RLS stays final.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import type { RequestScope } from "../../src/common/auth/context.js";
import { UnitOfWork } from "../../src/common/db/unit-of-work.js";
import type { ApiProblem } from "../../src/common/errors/api-problem.js";
import { PG_POOL } from "../../src/common/tokens.js";
import type { Api, Problem } from "../support/harness.js";
import { startApi, world } from "../support/harness.js";
import { ProbeModule } from "../support/probe.module.js";

let api: Api;
let a: World;
let b: World;
beforeAll(async () => {
  api = await startApi([ProbeModule], { poolMax: 1 });
  a = await world();
  b = await world();
});
afterAll(async () => {
  await api.close();
});

describe("context propagation", () => {
  it("operations run as design_os_api (via the NOINHERIT login role) with the verified claims and request id", async () => {
    const requestId = randomUUID();
    const r = await api.request({ method: "GET", url: "/api/v1/__probe/context", as: a.users.SALES, headers: { "x-request-id": requestId } });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ currentUser: string; sessionUser: string; claims: string; orgId: string; requestId: string }>();
    expect(body).toMatchObject({ currentUser: "design_os_api", sessionUser: "lintel_api_test", orgId: a.org, requestId });
    expect(JSON.parse(body.claims)).toEqual({ sub: a.users.SALES, org_id: a.org });
  });
  it("claims, role and request id never leak to the next user of a pooled connection (pool of 1)", async () => {
    expect((await api.request({ method: "GET", url: "/api/v1/__probe/context", as: a.users.SALES })).statusCode).toBe(200);
    const pool = api.app.get<pg.Pool>(PG_POOL);
    const after = (await pool.query<{ u: string; c: string | null; r: string | null }>(
      "SELECT current_user::text AS u, current_setting('request.jwt.claims', true) AS c, current_setting('design_os.request_id', true) AS r")).rows[0];
    expect(after).toEqual({ u: "lintel_api_test", c: "", r: "" });
    const other = await api.request({ method: "GET", url: "/api/v1/__probe/context", as: b.users.SALES });
    expect(JSON.parse(other.json<{ claims: string }>().claims)).toEqual({ sub: b.users.SALES, org_id: b.org });
  });
  it("the login role itself can read nothing: every privilege comes from SET ROLE design_os_api inside a transaction", async () => {
    const pool = api.app.get<pg.Pool>(PG_POOL);
    await expect(pool.query("SELECT count(*) FROM design_os.organization")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("in-transaction re-verification", () => {
  const scope = (w: World, orgId = w.org): RequestScope => ({
    requestId: randomUUID(),
    principal: { userId: w.users.DESIGNER, email: null, emailVerified: false },
    org: { orgId, identityKind: "INTERNAL", roles: ["DESIGNER"], permissions: new Set(["client.read", "client.write"]) },
  });
  it("a stale or forged org context is refused before the operation runs (ORG_ACCESS_DENIED)", async () => {
    const uow = api.app.get(UnitOfWork);
    let ran = false;
    const err = await uow.run(scope(a, b.org), {}, () => { ran = true; return Promise.resolve(); }).catch((e: unknown) => e as ApiProblem);
    expect([err?.code, ran]).toEqual(["ORG_ACCESS_DENIED", false]);
  });
  it("an action no longer (or never) granted is refused in-transaction (PERMISSION_DENIED), whatever the cached context says", async () => {
    const uow = api.app.get(UnitOfWork);
    const err = await uow.run(scope(a), { action: "client.write" }, () => Promise.resolve()).catch((e: unknown) => e as ApiProblem);
    expect(err?.code).toBe("PERMISSION_DENIED");
    await expect(uow.run(scope(a), { action: "client.read" }, () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("RLS remains the final boundary", () => {
  it("with no API-level action check, the database still refuses a DESIGNER's client insert (403 PERMISSION_DENIED)", async () => {
    const denied = await api.request({ method: "POST", url: "/api/v1/__probe/rls-insert", as: a.users.DESIGNER });
    expect([denied.statusCode, denied.json<Problem>().code]).toEqual([403, "PERMISSION_DENIED"]);
    expect((await api.request({ method: "POST", url: "/api/v1/__probe/rls-insert", as: a.users.SALES })).statusCode).toBe(201);
  });
});
