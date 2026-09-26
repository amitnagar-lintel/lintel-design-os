/** Clients, projects and project membership over HTTP (M5 Step 5): isolation, permissions, ETags, pagination, audit. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import { ClientResponse } from "../../src/modules/clients/clients.schemas.js";
import { MemberResponse, ProjectResponse } from "../../src/modules/projects/projects.schemas.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";

let api: Api;
let w: World;
let other: World;
let clientId: string;
beforeAll(async () => {
  api = await startApi();
  w = await world();
  other = await world();
  const c = await api.request({ method: "POST", url: "/api/v1/clients", as: w.users.SALES, payload: { clientCode: "MEHTA", name: "Mehta Residence", contact: { phone: "+91 00000 00000" }, opsClientRef: "OPS-C-1" } });
  expect(c.statusCode).toBe(201);
  clientId = ClientResponse.parse(c.json()).id;
});
afterAll(async () => {
  await api.close();
});

const problem = (r: { json: () => unknown }) => r.json() as Problem;
const createProject = (code: string, as = w.users.SALES) =>
  api.request({ method: "POST", url: "/api/v1/projects", as, payload: { clientId, projectCode: code, name: `Project ${code}`, siteAddress: { city: "Mumbai" } } });

describe("clients", () => {
  it("create (201 + ETag + Location), read, and the unique client code makes creation idempotent (409 on repeat)", async () => {
    const r = await api.request({ method: "GET", url: `/api/v1/clients/${clientId}`, as: w.users.DESIGNER });
    expect(ClientResponse.parse(r.json())).toMatchObject({ clientCode: "MEHTA", contact: { phone: "+91 00000 00000" }, opsClientRef: "OPS-C-1" });
    expect(r.headers.etag).toMatch(/^"sha256:[0-9a-f]{64}"$/);
    const dup = await api.request({ method: "POST", url: "/api/v1/clients", as: w.users.SALES, payload: { clientCode: "MEHTA", name: "again" } });
    expect([dup.statusCode, problem(dup).code]).toEqual([409, "DUPLICATE_RESOURCE"]);
  });
  it("update needs If-Match; DESIGNER (client.read only) cannot write; other tenants see nothing", async () => {
    const etag = (await api.request({ method: "GET", url: `/api/v1/clients/${clientId}`, as: w.users.SALES })).headers.etag as string;
    expect((await api.request({ method: "PATCH", url: `/api/v1/clients/${clientId}`, as: w.users.SALES, payload: { name: "Mehta Family" } })).statusCode).toBe(428);
    const ok = await api.request({ method: "PATCH", url: `/api/v1/clients/${clientId}`, as: w.users.SALES, payload: { name: "Mehta Family" }, headers: { "if-match": etag } });
    expect([ok.statusCode, ClientResponse.parse(ok.json()).name]).toEqual([200, "Mehta Family"]);
    expect((await api.request({ method: "PATCH", url: `/api/v1/clients/${clientId}`, as: w.users.SALES, payload: { name: "x" }, headers: { "if-match": etag } })).statusCode).toBe(412);
    expect(problem(await api.request({ method: "POST", url: "/api/v1/clients", as: w.users.DESIGNER, payload: { clientCode: "X", name: "x" } })).code).toBe("PERMISSION_DENIED");
    expect((await api.request({ method: "GET", url: `/api/v1/clients/${clientId}`, as: other.users.SALES })).statusCode).toBe(404);
    expect((await api.request({ method: "PATCH", url: `/api/v1/clients/${clientId}`, as: w.users.SALES, payload: { clientCode: "RENAMED" }, headers: { "if-match": etag } })).statusCode).toBe(400);
  });
});

describe("projects", () => {
  it("create with the client association; read; update with If-Match; the client and code are fixed", async () => {
    const created = await createProject("P-001");
    expect(created.statusCode).toBe(201);
    const p = ProjectResponse.parse(created.json());
    expect(p).toMatchObject({ clientId, projectCode: "P-001", currency: "INR", unitSystem: "MM", siteAddress: { city: "Mumbai" } });
    expect(created.headers.location).toBe(`/api/v1/projects/${p.id}`);
    const upd = await api.request({ method: "PATCH", url: `/api/v1/projects/${p.id}`, as: w.users.SALES, payload: { name: "Renamed" }, headers: { "if-match": created.headers.etag as string } });
    expect([upd.statusCode, ProjectResponse.parse(upd.json()).name]).toEqual([200, "Renamed"]);
    expect((await api.request({ method: "PATCH", url: `/api/v1/projects/${p.id}`, as: w.users.SALES, payload: { clientId: randomUUID() }, headers: { "if-match": upd.headers.etag as string } })).statusCode).toBe(400);
  });
  it("a client of another organization can never be associated (422, existence not revealed)", async () => {
    const foreignClient = (await api.request({ method: "POST", url: "/api/v1/clients", as: other.users.SALES, payload: { clientCode: "FOREIGN", name: "Foreign" } })).json<{ id: string }>().id;
    const r = await api.request({ method: "POST", url: "/api/v1/projects", as: w.users.SALES, payload: { clientId: foreignClient, projectCode: "P-X", name: "x" } });
    expect([r.statusCode, problem(r).code]).toEqual([422, "INVALID_REFERENCE"]);
  });
  it("only project.write roles create projects; a DESIGNER sees a project only once assigned", async () => {
    expect(problem(await createProject("P-DSG", w.users.DESIGNER)).code).toBe("PERMISSION_DENIED");
    const p = ProjectResponse.parse((await createProject("P-VIS")).json());
    expect((await api.request({ method: "GET", url: `/api/v1/projects/${p.id}`, as: w.users.DESIGNER })).statusCode).toBe(404);
    const list = await api.request({ method: "GET", url: "/api/v1/projects?limit=200", as: w.users.DESIGNER });
    expect(list.json<{ items: { id: string }[] }>().items.map((x) => x.id)).not.toContain(p.id);
    const m = await api.request({ method: "POST", url: `/api/v1/projects/${p.id}/members`, as: w.users.SALES, payload: { userId: w.users.DESIGNER, role: "DESIGNER" } });
    expect([m.statusCode, MemberResponse.parse(m.json()).grantedBy]).toEqual([201, w.users.SALES]);
    expect((await api.request({ method: "GET", url: `/api/v1/projects/${p.id}`, as: w.users.DESIGNER })).statusCode).toBe(200);
    expect((await api.request({ method: "GET", url: `/api/v1/projects/${p.id}`, as: other.users.DESIGN_HEAD })).statusCode).toBe(404);
  });
  it("lists are cursor-paginated (newest first) over exactly the visible projects", async () => {
    for (const code of ["P-L1", "P-L2", "P-L3"]) expect((await createProject(code)).statusCode).toBe(201);
    const first = await api.request({ method: "GET", url: "/api/v1/projects?limit=2", as: w.users.SALES });
    const body = first.json<{ items: { projectCode: string }[]; nextCursor: string }>();
    expect(body.items).toHaveLength(2);
    const second = await api.request({ method: "GET", url: `/api/v1/projects?limit=200&cursor=${body.nextCursor}`, as: w.users.SALES });
    const all = [...body.items, ...second.json<{ items: { projectCode: string }[] }>().items].map((x) => x.projectCode);
    const expected = (await sql<{ project_code: string }>("SELECT project_code FROM design_os.project WHERE org_id = $1 ORDER BY created_at DESC, id DESC", [w.org])).map((r) => r.project_code);
    expect(all).toEqual(expected);
  });
});

describe("project membership", () => {
  it("assign (natural key: repeat → 409), membership rules from the database (a CLIENT needs its contact), revoke with an audited reason", async () => {
    const p = ProjectResponse.parse((await createProject("P-MEM")).json());
    const url = `/api/v1/projects/${p.id}/members`;
    expect((await api.request({ method: "POST", url, as: w.users.SALES, payload: { userId: w.users.PRODUCTION, role: "PRODUCTION" } })).statusCode).toBe(201);
    expect(problem(await api.request({ method: "POST", url, as: w.users.SALES, payload: { userId: w.users.PRODUCTION, role: "PRODUCTION" } })).code).toBe("DUPLICATE_RESOURCE");
    const client = await api.request({ method: "POST", url, as: w.users.SALES, payload: { userId: w.users.CLIENT, role: "CLIENT" } });
    expect([client.statusCode, problem(client).code]).toEqual([400, "VALIDATION_FAILED"]);
    const unknownContact = await api.request({ method: "POST", url, as: w.users.SALES, payload: { userId: w.users.CLIENT, role: "CLIENT", clientContactId: randomUUID() } });
    expect([unknownContact.statusCode, problem(unknownContact).code]).toEqual([409, "MEMBERSHIP_RULE_VIOLATION"]);
    expect((await api.request({ method: "POST", url, as: w.users.SALES, payload: { userId: w.users.COSTING, role: "COSTING", clientContactId: randomUUID() } })).statusCode).toBe(400);
    expect(problem(await api.request({ method: "POST", url, as: w.users.DESIGNER, payload: { userId: w.users.COSTING, role: "COSTING" } })).code).toBe("PERMISSION_DENIED");
    const members = (await api.request({ method: "GET", url, as: w.users.SALES })).json<{ items: { userId: string; role: string }[] }>().items;
    expect(members.map((m) => m.role)).toEqual(["PRODUCTION"]);
    const revoke = await api.request({ method: "POST", url: `${url}/revoke`, as: w.users.SALES, payload: { userId: w.users.PRODUCTION, role: "PRODUCTION", reason: "moved to another project" } });
    expect(revoke.statusCode).toBe(200);
    expect((await api.request({ method: "POST", url: `${url}/revoke`, as: w.users.SALES, payload: { userId: w.users.PRODUCTION, role: "PRODUCTION", reason: "again" } })).statusCode).toBe(404);
    const audit = await sql<{ reason: string; action: string }>("SELECT reason, action FROM design_os.audit_log WHERE org_id = $1 AND table_name = 'project_member' AND action = 'DELETE'", [w.org]);
    expect(audit).toEqual([{ reason: "moved to another project", action: "DELETE" }]);
  });
});
