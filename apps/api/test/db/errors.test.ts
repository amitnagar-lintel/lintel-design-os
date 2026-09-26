/**
 * Error-code mapping end to end, and parity between the API's registries and the database: problem codes vs
 * design_os.error_code, the action vocabulary vs design_os.permission, idempotency scopes vs the database CHECK.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import { constructionStandard } from "../../../../tests/db/support/world.js";
import type { Tx } from "../../../../tests/db/support/db.js";
import { PERMISSION_ACTIONS } from "../../src/common/auth/permissions.js";
import { DATABASE_ERROR_CODES, INTERNAL_DATABASE_SQLSTATES, PROBLEM_CODES } from "../../src/common/errors/problem-codes.js";
import { IDEMPOTENCY_SCOPES } from "../../src/common/idempotency/idempotency.service.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, world } from "../support/harness.js";
import { ProbeModule } from "../support/probe.module.js";

let api: Api;
let w: World;
beforeAll(async () => {
  api = await startApi([ProbeModule]);
  w = await world();
});
afterAll(async () => {
  await api.close();
});

describe("database errors become RFC 9457 problems by SQLSTATE", () => {
  it("LD005 (tenant-safe not found) → 404 NOT_FOUND, with no database message", async () => {
    const r = await api.request({ method: "GET", url: "/api/v1/__probe/errors/not-found", as: w.users.DESIGNER });
    const p = r.json<Problem>();
    expect([r.statusCode, p.code, p.type]).toEqual([404, "NOT_FOUND", "urn:lintel-design-os:problem:not-found"]);
    expect(r.body).not.toMatch(/transition|design_os|SQL/i);
    expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
  });
  it("LD006 → 409 LIFECYCLE_TRANSITION_REJECTED with only the allow-listed context", async () => {
    const c = await admin();
    let id: string;
    try {
      await c.query("BEGIN");
      id = await constructionStandard(c as unknown as Tx, w, { code: `CS_${w.org.slice(0, 6)}` });
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    const r = await api.request({ method: "GET", url: `/api/v1/__probe/errors/lifecycle?id=${id}`, as: w.users.DESIGN_HEAD });
    expect([r.statusCode, r.json<Problem>().code, r.json<Problem>().context]).toEqual([409, "LIFECYCLE_TRANSITION_REJECTED", { status: "DRAFT" }]);
  });
  it("23505 in design_os → 409 DUPLICATE_RESOURCE (constraint name not exposed)", async () => {
    const r = await api.request({ method: "GET", url: "/api/v1/__probe/errors/duplicate", as: w.users.SALES });
    expect([r.statusCode, r.json<Problem>().code]).toEqual([409, "DUPLICATE_RESOURCE"]);
    expect(r.body).not.toMatch(/client_org|unique|constraint/i);
  });
  it("an unexpected database error → 500 INTERNAL_DATABASE_ERROR with no raw details", async () => {
    const r = await api.request({ method: "GET", url: "/api/v1/__probe/errors/division", as: w.users.DESIGNER });
    expect([r.statusCode, r.json<Problem>().code]).toEqual([500, "INTERNAL_DATABASE_ERROR"]);
    const { instance, ...rest } = r.json<Problem>();
    expect(instance).toBe("/api/v1/__probe/errors/division");
    expect(JSON.stringify(rest)).not.toMatch(/division|22012|zero/i);
    expect(Object.keys(r.json<Problem>()).sort()).toEqual(["code", "instance", "requestId", "status", "title", "type"]);
  });
});

describe("registry parity with the database", () => {
  it("every design_os.error_code row maps to the same API code and HTTP status", async () => {
    const rows = await sql<{ sqlstate: string; code: string; http_status: number; api_facing: boolean }>("SELECT sqlstate, code, http_status, api_facing FROM design_os.error_code ORDER BY sqlstate");
    for (const r of rows) {
      if (r.api_facing) {
        expect([r.sqlstate, DATABASE_ERROR_CODES[r.sqlstate]]).toEqual([r.sqlstate, r.code]);
        expect([r.code, PROBLEM_CODES[r.code as keyof typeof PROBLEM_CODES].status]).toEqual([r.code, r.http_status]);
      } else {
        expect(INTERNAL_DATABASE_SQLSTATES).toContain(r.sqlstate);
      }
    }
    expect(Object.keys(DATABASE_ERROR_CODES).sort()).toEqual(rows.filter((r) => r.api_facing).map((r) => r.sqlstate));
    expect([...INTERNAL_DATABASE_SQLSTATES].sort()).toEqual(rows.filter((r) => !r.api_facing).map((r) => r.sqlstate));
  });
  it("the API action vocabulary equals design_os.permission (46 actions)", async () => {
    const actions = (await sql<{ action: string }>("SELECT action FROM design_os.permission ORDER BY action")).map((r) => r.action);
    expect([...PERMISSION_ACTIONS].sort()).toEqual(actions);
    expect(actions).toHaveLength(46);
  });
  it("the API idempotency scopes equal the database CHECK", async () => {
    const def = (await sql<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'design_os.idempotency_record'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%scope%'"))[0]?.def ?? "";
    const scopes = [...def.matchAll(/'([a-z_.]+)'::text/g)].map((m) => m[1]);
    expect(scopes.sort()).toEqual([...IDEMPOTENCY_SCOPES].sort());
  });
});
