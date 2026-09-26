/**
 * Readiness and audit read (M6 G7) against PostgreSQL, and error reporting of server errors (Sentry, OD-M6-6).
 * Read-only, permission-controlled, tenant-safe, deterministic, no secrets; BLOCKING vs WARNING vs INFO.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { constructionStandard, dependencies, transition } from "../../../../tests/db/support/world.js";
import type { World } from "../../../../tests/db/support/world.js";
import type { ErrorReport, ErrorReporter } from "../../src/common/observability/error-reporter.js";
import { AuditChainResponse, AuditEntry, ReadinessReport, ReadyResponse } from "../../src/modules/readiness/readiness.schemas.js";
import { PILOT_REQUIRED_TYPES } from "../../src/modules/readiness/readiness.service.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";
import { seeded } from "../support/issue-fixtures.js";
import { ProbeModule } from "../support/probe.module.js";
import { z } from "zod";

let api: Api;
let empty: World;
let full: World;
const reports: ErrorReport[] = [];
const recorder: ErrorReporter = { enabled: true, capture: (r) => { reports.push(r); }, flush: () => Promise.resolve(true) };
const problem = (r: { json: () => unknown }) => r.json() as Problem;
const get = (url: string, as?: string) => api.request({ method: "GET", url: `/api/v1${url}`, ...(as === undefined ? {} : { as }) });
const report = async (as: string) => ReadinessReport.parse((await get("/readiness", as)).json());

beforeAll(async () => {
  api = await startApi([ProbeModule], { errorReporter: recorder });
  empty = await world();
  full = await world();
  await seeded(async (c) => { await dependencies(c, full, { commercial: "approved" }); });
});
afterAll(async () => {
  await api.close();
});

describe("GET /ready (public)", () => {
  it("is 200 with every check passing, and shows no details", async () => {
    const r = await get("/ready");
    expect(r.statusCode).toBe(200);
    expect(ReadyResponse.parse(r.json())).toEqual({ status: "ready", checks: { database: "pass", migrations: "pass", engineManifest: "pass" } });
  });

  it("is 503 when the database's migrations differ from the build's (drift)", async () => {
    await sql("INSERT INTO design_os_migrations.applied (version, name, checksum) VALUES ('9999', 'not_in_this_build', 'x')");
    try {
      const r = await get("/ready");
      expect([r.statusCode, ReadyResponse.parse(r.json()).checks.migrations]).toEqual([503, "fail"]);
      const m = (await report(full.users.ADMIN)).checks.find((c) => c.id === "database.migrations")!;
      expect(m).toMatchObject({ level: "BLOCKING", status: "FAIL", details: { state: "DRIFT", drift: [{ version: "9999", kind: "UNKNOWN_APPLIED" }] } });
    } finally {
      await sql("DELETE FROM design_os_migrations.applied WHERE version = '9999'");
    }
    expect((await get("/ready")).statusCode).toBe(200);
  });
});

describe("GET /readiness (audit.read)", () => {
  it("an organization without approved production data is NOT_READY: every required data set is a BLOCKING failure", async () => {
    const r = await report(empty.users.ADMIN);
    expect(r.status).toBe("NOT_READY");
    const byId = new Map(r.checks.map((c) => [c.id, c]));
    expect(byId.get("database.migrations")).toMatchObject({ level: "BLOCKING", status: "PASS", details: { state: "UP_TO_DATE" } });
    expect(byId.get("audit.chain")).toMatchObject({ level: "BLOCKING", status: "PASS" });
    expect(byId.get("build.engine_manifest")).toMatchObject({ level: "INFO", status: "PASS" });
    for (const t of PILOT_REQUIRED_TYPES) {
      expect([t, byId.get(`data.${t}.approved`)?.level, byId.get(`data.${t}.approved`)?.status]).toEqual([t, "BLOCKING", "FAIL"]);
      expect(byId.get(`data.${t}.dependencies`)?.status).toBe("SKIPPED");
    }
    expect(r.summary).toEqual({ blockingFailures: PILOT_REQUIRED_TYPES.length, warnings: 0, checks: 3 + 3 * PILOT_REQUIRED_TYPES.length });
    expect(r.checks.map((c) => c.id)).toEqual([...r.checks.map((c) => c.id)].sort());
  });

  it("is READY with approved data; a newer version awaiting approval is only a WARNING; responses are deterministic", async () => {
    const r = await report(full.users.ADMIN);
    expect([r.status, r.summary.blockingFailures, r.summary.warnings]).toEqual(["READY", 0, 0]);
    expect(await report(full.users.ADMIN)).toEqual(r);
    expect(r.build.revision).toMatch(/^[0-9A-Za-z._+-]{7,}$/);

    // A newer ConstructionStandard version submitted for approval (IN_REVIEW).
    await seeded(async (c) => {
      const [e] = (await c.query("SELECT v.entity_id FROM design_os.construction_standard_version v WHERE v.org_id = $1 AND v.status = 'APPROVED'", [full.org])).rows as { entity_id: string }[];
      const id = await constructionStandard(c, full, { complete: true, entityId: e!.entity_id, versionNumber: 2 });
      await transition(c, full, "PRODUCTION", "construction_standard", id, "SUBMIT");
    });
    const w = await report(full.users.ADMIN);
    expect([w.status, w.summary.warnings]).toEqual(["READY", 1]);
    expect(w.checks.find((c) => c.id === "data.construction_standard.pending")).toMatchObject({ level: "WARNING", status: "FAIL", details: { pending: [{ versionNumber: 2, status: "IN_REVIEW" }] } });
  });

  it("is tenant-safe and permission-controlled; it exposes no secrets", async () => {
    // Each organization sees only its own data.
    expect((await report(empty.users.ADMIN)).status).toBe("NOT_READY");
    expect((await report(full.users.ADMIN)).status).toBe("READY");
    expect(problem(await get("/readiness", full.users.DESIGNER)).code).toBe("PERMISSION_DENIED");
    expect(problem(await get("/readiness", full.users.SALES)).code).toBe("PERMISSION_DENIED");
    expect(problem(await get("/readiness", full.users.CLIENT)).code).toBe("IDENTITY_KIND_MISMATCH");
    expect((await get("/readiness", full.users.FINANCE)).statusCode).toBe(200);
    expect((await get("/readiness")).statusCode).toBe(401);
    const text = JSON.stringify(await report(full.users.ADMIN));
    for (const secret of ["postgres", "test-cursor-secret", "test-file-url-secret", "password", "BEGIN PRIVATE"]) expect(text).not.toContain(secret);
    for (const method of ["POST", "PUT", "DELETE"] as const) expect([404, 405]).toContain((await api.request({ method, url: "/api/v1/readiness", as: full.users.ADMIN })).statusCode);
  });
});

describe("audit read (audit.read)", () => {
  it("lists only the caller's organization's audit trail, newest first, filtered and paged; the chain verifies", async () => {
    const page = z.strictObject({ items: z.array(AuditEntry), nextCursor: z.string().nullable() });
    const first = page.parse((await get("/audit?limit=2", full.users.ADMIN)).json());
    expect(first.items).toHaveLength(2);
    expect(first.items[0]!.id).toBeGreaterThan(first.items[1]!.id);
    const second = page.parse((await get(`/audit?limit=2&cursor=${first.nextCursor!}`, full.users.ADMIN)).json());
    expect(second.items[0]!.id).toBeLessThan(first.items[1]!.id);
    const orgIds = await sql<{ n: string }>("SELECT count(*)::text AS n FROM design_os.audit_log WHERE org_id = $1 AND id = ANY ($2::bigint[])", [full.org, [...first.items, ...second.items].map((i) => i.id)]);
    expect(Number(orgIds[0]!.n)).toBe(4);
    const filtered = page.parse((await get("/audit?table=construction_standard_version&limit=200", full.users.ADMIN)).json());
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(new Set(filtered.items.map((i) => i.table))).toEqual(new Set(["construction_standard_version"]));
    // Another organization's cursor and data are not reachable.
    expect(problem(await get(`/audit?limit=2&cursor=${first.nextCursor!}`, empty.users.ADMIN)).code).toBe("INVALID_CURSOR");
    const theirs = page.parse((await get("/audit?limit=200", empty.users.ADMIN)).json());
    expect(theirs.items.some((i) => first.items.some((f) => f.id === i.id))).toBe(false);
    expect(problem(await get("/audit", full.users.DESIGNER)).code).toBe("PERMISSION_DENIED");
    expect(AuditChainResponse.parse((await get("/audit/verify", full.users.ADMIN)).json())).toMatchObject({ ok: true, firstBadId: null });
  });
});

describe("error reporting", () => {
  it("reports server errors (5xx) with the route template and problem code — never client errors", async () => {
    reports.length = 0;
    expect((await get("/__probe/errors/division", full.users.DESIGNER)).statusCode).toBe(500);
    expect((await get("/__probe/errors/not-found", full.users.DESIGNER)).statusCode).toBe(404);
    expect((await get("/readiness", full.users.DESIGNER)).statusCode).toBe(403);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ method: "GET", route: "/api/v1/__probe/errors/:kind", status: 500, code: "INTERNAL_DATABASE_ERROR" });
    expect(reports[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
