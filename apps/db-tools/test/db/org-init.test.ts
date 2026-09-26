/**
 * Organization initialisation (M6 G4) on a database migrated by the runner (LOCAL / CI only): an organization with
 * the default role grants and one PENDING ADMIN invitation; idempotent; refused on a conflicting name, on pending
 * migrations, and for hosted targets without confirmation.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadMigrations } from "../../src/migrations.js";
import { run } from "../../src/org-cli.js";
import { orgInit } from "../../src/org-init.js";
import { up } from "../../src/runner.js";
import { applyBootstrap } from "../../../../tests/db/support/migrate.js";
import type {} from "../../../../tests/db/support/global-setup.js";

const DB = `design_os_org_init_${String(process.pid)}`;
let url = "";
let client: pg.Client;

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: inject("dbUrl") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${DB}`);
  });
  const u = new URL(inject("dbUrl"));
  u.pathname = `/${DB}`;
  url = u.toString();
  client = new pg.Client({ connectionString: url });
  await client.connect();
  await applyBootstrap(client);
});

afterAll(async () => {
  await client.end();
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
});

const input = { code: "LINTEL_TEST", name: "Lintel Test Org", adminEmail: "First.Admin@Lintel.example", adminName: "First Admin" };

describe("org init", () => {
  it("refuses while migrations are not up to date", async () => {
    expect(await orgInit(client, loadMigrations(), input, "ci")).toEqual({ outcome: "REFUSED", reason: "migrations are UNINITIALISED; run db:migrate first" });
    expect((await up(client, loadMigrations())).outcome).toBe("APPLIED");
  });

  it("creates the organization, its default role grants and one PENDING ADMIN invitation; audited", async () => {
    const r = await orgInit(client, loadMigrations(), input, "ci-operator");
    expect(r.outcome).toBe("CREATED");
    if (r.outcome === "REFUSED") return;
    const org = (await client.query("SELECT code, name, status FROM design_os.organization WHERE id = $1", [r.orgId])).rows;
    expect(org).toEqual([{ code: "LINTEL_TEST", name: "Lintel Test Org", status: "ACTIVE" }]);
    const grants = Number((await client.query<{ n: string }>("SELECT count(*) AS n FROM design_os.role_permission WHERE org_id = $1", [r.orgId])).rows[0]?.n);
    const defaults = Number((await client.query<{ n: string }>("SELECT count(*) AS n FROM design_os.default_role_permission")).rows[0]?.n);
    expect(grants).toBe(defaults);
    const inv = (await client.query("SELECT email, display_name, roles::text[] AS roles, status, invited_by FROM design_os.org_invitation WHERE org_id = $1", [r.orgId])).rows;
    expect(inv).toEqual([{ email: "first.admin@lintel.example", display_name: "First Admin", roles: ["ADMIN"], status: "PENDING", invited_by: null }]);
    expect((await client.query("SELECT count(*)::int AS n FROM design_os.org_membership WHERE org_id = $1", [r.orgId])).rows[0]).toEqual({ n: 0 });
    const audit = (await client.query("SELECT DISTINCT table_name, reason FROM design_os.audit_log WHERE org_id = $1 AND table_name IN ('organization', 'org_invitation')", [r.orgId])).rows;
    expect(audit).toEqual(expect.arrayContaining([
      { table_name: "organization", reason: "organization initialised by operator ci-operator" },
      { table_name: "org_invitation", reason: "organization initialised by operator ci-operator" }]));
    expect((await client.query<{ ok: boolean }>("SELECT ok FROM design_os.verify_audit_chain($1)", [r.orgId])).rows[0]?.ok).toBe(true);
  });

  it("is idempotent, refuses a conflicting name or a second admin email, and reports an initialised organization", async () => {
    const again = await orgInit(client, loadMigrations(), input, "ci");
    expect(again.outcome).toBe("INVITATION_PENDING");
    expect(await orgInit(client, loadMigrations(), { ...input, name: "Other" }, "ci")).toEqual({ outcome: "REFUSED", reason: 'organization LINTEL_TEST exists with the name "Lintel Test Org"' });
    expect((await orgInit(client, loadMigrations(), { ...input, adminEmail: "someone@else.example" }, "ci")).outcome).toBe("REFUSED");
    expect((await client.query("SELECT count(*)::int AS n FROM design_os.organization WHERE code = 'LINTEL_TEST'")).rows[0]).toEqual({ n: 1 });

    // Once an ADMIN is active the organization is initialised: nothing more is written.
    if (again.outcome === "REFUSED") return;
    await client.query("INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-000000000001', 'first.admin@lintel.example')");
    await client.query("INSERT INTO design_os.app_user (id, email, display_name, identity_kind) VALUES ('00000000-0000-4000-8000-000000000001', 'first.admin@lintel.example', 'First Admin', 'INTERNAL')");
    await client.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, '00000000-0000-4000-8000-000000000001', 'ADMIN')", [again.orgId]);
    expect(await orgInit(client, loadMigrations(), input, "ci")).toEqual({ outcome: "ALREADY_INITIALISED", orgId: again.orgId, invitationId: null });
  });

  it("CLI: validates input and refuses hosted targets without confirmation", async () => {
    const io = () => { const out: string[] = []; const err: string[] = []; return { out, err, io: { env: { MIGRATION_DATABASE_URL: url }, out: (l: string) => out.push(l), err: (l: string) => err.push(l) } }; };
    let t = io();
    expect(await run(["init", "--env", "ci", "--code", "bad code", "--name", "N", "--admin-email", "a@b.example", "--admin-name", "A", "--operator", "ci"], t.io)).toBe(64);
    t = io();
    expect(await run(["init", "--env", "production", "--code", "X", "--name", "N", "--admin-email", "a@b.example", "--admin-name", "A", "--operator", "ci"], t.io)).toBe(4);
    t = io();
    expect(await run(["init", "--env", "ci", "--code", "SECOND", "--name", "Second", "--admin-email", "a@b.example", "--admin-name", "A", "--operator", "ci", "--json"], t.io)).toBe(0);
    expect(JSON.parse(t.out[0]!)).toMatchObject({ outcome: "CREATED" });
  });
});
