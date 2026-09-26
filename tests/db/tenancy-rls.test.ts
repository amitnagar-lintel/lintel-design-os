/** Tenant isolation, default-deny RLS, action-based permissions and client isolation (D4, D9, D10). */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Tx } from "./support/db.js";
import { actAs, attempt, one, tx } from "./support/db.js";
import type { World } from "./support/world.js";
import { constructionStandard, createUser, createWorld, dependencies, designVersion, project } from "./support/world.js";

const count = async (c: Tx, sql: string, params: unknown[] = []): Promise<number> => Number((await one<{ n: string }>(c, sql.replace(/^SELECT\s+\*/, "SELECT count(*) AS n"), params)).n);

/** Make the world's CLIENT identity an ACTIVE contact of a project's client and a CLIENT member of that project. */
async function clientOnProject(c: Tx, w: World, projectId: string, clientId: string): Promise<void> {
  await actAs(c, null);
  const contact = (await one<{ id: string }>(c,
    "INSERT INTO design_os.client_contact (org_id, client_id, email, display_name, user_id, status, invited_by) VALUES ($1, $2, $3, 'Client', $4, 'ACTIVE', $5) RETURNING id",
    [w.org, clientId, `contact.${randomUUID().slice(0, 6)}@client.example`, w.users.CLIENT, w.users.SALES])).id;
  await c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, client_contact_id, granted_by) VALUES ($1, $2, $3, 'CLIENT', $4, $5)",
    [w.org, projectId, w.users.CLIENT, contact, w.users.SALES]);
}

describe("default deny", () => {
  it("the API role sees nothing and can write nothing without verified claims", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await project(c, w);
      await actAs(c, null, { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.organization")).toBe(0);
      expect(await count(c, "SELECT * FROM design_os.project")).toBe(0);
      expect(await count(c, "SELECT * FROM design_os.role_permission")).toBe(0);
      expect((await attempt(c, () => c.query("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, 'X', 'X')", [w.org])))?.message).toContain("row-level security");
    });
  });
  it("Supabase REST roles (anon, authenticated) have no access to the schema", async () => {
    await tx(async (c) => {
      for (const role of ["anon", "authenticated"]) {
        await actAs(c, null);
        await c.query(`SET LOCAL ROLE ${role}`);
        expect((await attempt(c, () => c.query("SELECT 1 FROM design_os.project")))?.message).toContain("permission denied for schema design_os");
      }
    });
  });
  it("an org claim without membership is ignored (the org is never trusted from the client)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      await project(c, other);
      await actAs(c, { userId: w.users.ADMIN, orgId: other.org }, { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.project")).toBe(0);
      expect(await count(c, "SELECT * FROM design_os.organization")).toBe(0);
    });
  });
});

describe("tenant isolation", () => {
  it("members see only their own organization's reference data and projects", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      await constructionStandard(c, w);
      await constructionStandard(c, other);
      await project(c, w);
      await project(c, other);
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.construction_standard_version")).toBe(1);
      expect(await count(c, "SELECT * FROM design_os.project")).toBe(1);
      expect(await count(c, "SELECT * FROM design_os.project WHERE org_id = $1", [other.org])).toBe(0);
    });
  });
  it("cross-tenant references are structurally impossible (composite org foreign keys)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const { clientId: foreignClient } = await project(c, other);
      await actAs(c, null);
      expect((await attempt(c, () => c.query("INSERT INTO design_os.project (org_id, client_id, project_code, name) VALUES ($1, $2, 'P', 'P')", [w.org, foreignClient])))?.message).toContain("project_client_fk");
      const deps = await dependencies(c, w);
      const foreignDeps = await dependencies(c, other);
      const err = await attempt(c, () => designVersion(c, w, { ...deps, pins: { ...deps.pins, construction_standard_version_id: foreignDeps.pins.construction_standard_version_id } }));
      expect(err?.message).toContain("design_version_construction_fk");
    });
  });
  it("writing into another tenant is refused by RLS even with a valid permission", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      await actAs(c, w.actor("SALES"), { apiRole: true });
      expect((await attempt(c, () => c.query("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, 'X', 'X')", [other.org])))?.message).toContain("row-level security");
      await c.query("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, 'OWN', 'Own client')", [w.org]);
    });
  });
});

describe("action-based permissions", () => {
  it("internal users see a project only with project.read_all or project membership", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const { projectId } = await project(c, w);
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.project WHERE id = $1", [projectId])).toBe(0);
      await actAs(c, null);
      await c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, granted_by) VALUES ($1, $2, $3, 'DESIGNER', $4)", [w.org, projectId, w.users.DESIGNER, w.users.DESIGN_HEAD]);
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.project WHERE id = $1", [projectId])).toBe(1);
      await actAs(c, w.actor("DESIGN_HEAD"), { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.project WHERE id = $1", [projectId])).toBe(1);
    });
  });
  it("finance approvals can only ever be granted to FINANCE (D9)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      for (const [role, action] of [["ADMIN", "pricing_standard.approve"], ["COSTING", "pricing_standard.approve"], ["COSTING", "quotation_policy.approve"], ["ADMIN", "commercial_config.approve"]]) {
        expect((await attempt(c, () => c.query("INSERT INTO design_os.role_permission (org_id, role, action) VALUES ($1, $2, $3)", [w.org, role, action])))?.message).toContain("role_permission_finance_only");
      }
      const finance = await count(c, "SELECT * FROM design_os.role_permission WHERE org_id = $1 AND action = ANY ($2) AND role <> 'FINANCE'", [w.org, ["pricing_standard.approve", "quotation_policy.approve", "commercial_config.approve"]]);
      expect(finance).toBe(0);
    });
  });
  it("a CLIENT can never be granted approval, assignment or management actions", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      for (const action of ["design_version.approve", "project_members.assign", "org.members.manage", "client.write", "project.read_all"]) {
        expect((await attempt(c, () => c.query("INSERT INTO design_os.role_permission (org_id, role, action) VALUES ($1, 'CLIENT', $2)", [w.org, action])))?.message).toContain("role_permission_client_whitelist");
      }
    });
  });
});

describe("client isolation (D10)", () => {
  it("a client sees only projects they are explicitly a member of, never by supplying a project id", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const mine = await project(c, w);
      const notMine = await project(c, w);
      await clientOnProject(c, w, mine.projectId, mine.clientId);
      await actAs(c, w.actor("CLIENT"), { apiRole: true });
      expect(await count(c, "SELECT * FROM design_os.project WHERE id = $1", [mine.projectId])).toBe(1);
      expect(await count(c, "SELECT * FROM design_os.project WHERE id = $1", [notMine.projectId])).toBe(0);
      expect(await count(c, "SELECT * FROM design_os.project")).toBe(1);
    });
  });
  it("a client sees no designs, drafts, reference data, costs or audit history", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps);
      await clientOnProject(c, w, d.projectId, d.clientId);
      await actAs(c, w.actor("CLIENT"), { apiRole: true });
      for (const t of ["design_version", "design_object", "room", "construction_standard_version", "pricing_standard_version", "audit_log", "approval_decision", "bom_snapshot", "pricing_snapshot", "quotation_snapshot", "client"]) {
        expect([t, await count(c, `SELECT * FROM design_os.${t}`)]).toEqual([t, 0]);
      }
    });
  });
  it("a client cannot assign themselves (or anyone) to a project, nor create organizations", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const mine = await project(c, w);
      const other = await project(c, w);
      await clientOnProject(c, w, mine.projectId, mine.clientId);
      await actAs(c, w.actor("CLIENT"), { apiRole: true });
      const self = await attempt(c, () => c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, granted_by) VALUES ($1, $2, $3, 'DESIGNER', $3)", [w.org, other.projectId, w.users.CLIENT]));
      // Refused either by the membership integrity trigger (runs first) or by RLS; never inserted.
      expect(self?.message).toMatch(/row-level security|project_member/);
      expect((await attempt(c, () => c.query("INSERT INTO design_os.organization (code, name) VALUES ('EVIL', 'Evil')")))?.message).toContain("permission denied");
      const ownContact = (await one<{ id: string }>(c, "SELECT client_contact_id AS id FROM design_os.project_member WHERE user_id = $1", [w.users.CLIENT])).id;
      const viaContact = await attempt(c, () => c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, client_contact_id, granted_by) VALUES ($1, $2, $3, 'CLIENT', $4, $5)",
        [w.org, other.projectId, w.users.CLIENT, ownContact, w.users.SALES]));
      expect(viaContact?.message).toMatch(/row-level security|project_member/);
      await actAs(c, null);
      expect(await count(c, "SELECT * FROM design_os.project_member WHERE project_id = $1", [other.projectId])).toBe(0);
    });
  });
  it("a client identity can never hold an internal role, and a contact of another client cannot join the project", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      expect((await attempt(c, () => c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'DESIGNER')", [w.org, w.users.CLIENT])))?.message).toContain("requires a INTERNAL identity");
      const a = await project(c, w);
      const b = await project(c, w);
      const outsider = await createUser(c, `outsider.${randomUUID().slice(0, 6)}@client.example`, "CLIENT");
      await actAs(c, null);
      const contactOfB = (await one<{ id: string }>(c,
        "INSERT INTO design_os.client_contact (org_id, client_id, email, display_name, user_id, status, invited_by) VALUES ($1, $2, 'b@client.example', 'B', $3, 'ACTIVE', $4) RETURNING id",
        [w.org, b.clientId, outsider, w.users.SALES])).id;
      const err = await attempt(c, () => c.query("INSERT INTO design_os.project_member (org_id, project_id, user_id, role, client_contact_id, granted_by) VALUES ($1, $2, $3, 'CLIENT', $4, $5)",
        [w.org, a.projectId, outsider, contactOfB, w.users.SALES]));
      expect(err?.message).toContain("must be an ACTIVE contact of this project's client");
    });
  });
});
