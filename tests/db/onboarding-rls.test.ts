/**
 * Migration 0019 (M6 G4): invitations and self-provisioning are bounded by row-level security. Only an administrator
 * (org.members.manage) of the organization invites or revokes; only the signed-in person whose Supabase Auth email
 * matches a PENDING, unexpired invitation creates their own INTERNAL identity and exactly the invited memberships.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Tx } from "./support/db.js";
import { actAs, attempt, attemptDb, one, tx } from "./support/db.js";
import type { World } from "./support/world.js";
import { createUser, createWorld } from "./support/world.js";

/** The API role with only a verified subject (no org context yet), as for a person signing in for the first time. */
async function asPerson(c: Tx, userId: string): Promise<void> {
  await c.query("RESET ROLE");
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
  await c.query("SET LOCAL ROLE design_os_api");
}

/** A Supabase Auth user with no Design OS identity yet. */
async function authUser(c: Tx, email: string): Promise<string> {
  await actAs(c, null);
  const id = randomUUID();
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
  return id;
}

async function invite(c: Tx, w: World, email: string, roles: string[], name = "Asha Rao"): Promise<string> {
  await actAs(c, w.actor("ADMIN"), { apiRole: true });
  return (await one<{ id: string }>(c, "INSERT INTO design_os.org_invitation (org_id, email, display_name, roles, invited_by) VALUES ($1, $2, $3, $4::design_os.design_os_role[], $5) RETURNING id",
    [w.org, email, name, roles, w.users.ADMIN])).id;
}

const provision = (c: Tx, id: string, email: string, name = "Asha Rao", kind = "INTERNAL") =>
  c.query("INSERT INTO design_os.app_user (id, email, display_name, identity_kind) VALUES ($1, $2, $3, $4)", [id, email, name, kind]);
const member = (c: Tx, org: string, user: string, role: string, grantedBy: string | null) =>
  c.query("INSERT INTO design_os.org_membership (org_id, user_id, role, granted_by) VALUES ($1, $2, $3, $4)", [org, user, role, grantedBy]);
const accept = (c: Tx, invitation: string, user: string) =>
  c.query("UPDATE design_os.org_invitation SET status = 'ACCEPTED', accepted_by = $2, accepted_at = now() WHERE id = $1", [invitation, user]);
const email = () => `person.${randomUUID().slice(0, 8)}@lintel.example`;

describe("invitations (administrators only)", () => {
  it("an ADMIN invites into their own organization, as themselves; nobody else can", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const id = await invite(c, w, email(), ["DESIGNER", "DESIGN_HEAD"]);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const insert = (org: string, invitedBy: string) =>
        c.query("INSERT INTO design_os.org_invitation (org_id, email, display_name, roles, invited_by) VALUES ($1, $2, 'X Y', '{DESIGNER}', $3)", [org, email(), invitedBy]);
      await actAs(c, w.actor("DESIGN_HEAD"), { apiRole: true });
      expect((await attempt(c, () => insert(w.org, w.users.DESIGN_HEAD)))?.message).toContain("row-level security");
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect((await attempt(c, () => insert(w.org, w.users.SALES)))?.message).toContain("row-level security");
      expect((await attempt(c, () => insert(other.org, w.users.ADMIN)))?.message).toContain("row-level security");
      await actAs(c, w.actor("CLIENT"), { apiRole: true });
      expect((await attempt(c, () => insert(w.org, w.users.CLIENT)))?.message).toContain("row-level security");
    });
  });

  it("invitations hold INTERNAL roles only, each once, a normalized email and a name; one PENDING per person", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const e = email();
      await invite(c, w, e, ["SALES"]);
      const bad = (em: string, roles: string, name = "Asha Rao") => attemptDb(c, () =>
        c.query("INSERT INTO design_os.org_invitation (org_id, email, display_name, roles, invited_by) VALUES ($1, $2, $3, $4::design_os.design_os_role[], $5)", [w.org, em, name, roles, w.users.ADMIN]));
      expect((await bad(email(), "{CLIENT}"))?.constraint).toBe("org_invitation_roles");
      expect((await bad(email(), "{DESIGNER,DESIGNER}"))?.constraint).toBe("org_invitation_roles");
      expect((await bad(email(), "{}"))?.constraint).toBe("org_invitation_roles");
      expect((await bad("Mixed@Case.example", "{SALES}"))?.constraint).toBe("org_invitation_email_normalized");
      expect((await bad(email(), "{SALES}", "  "))?.constraint).toBe("org_invitation_display_name");
      expect((await bad(e, "{DESIGNER}"))?.constraint).toBe("org_invitation_pending_unique");
    });
  });

  it("administrators of the organization see its invitations; others see only invitations addressed to them", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const e = email();
      await invite(c, w, e, ["DESIGNER"]);
      const person = await authUser(c, e);
      const stranger = await authUser(c, email());
      const count = async () => Number((await one<{ n: string }>(c, "SELECT count(*) AS n FROM design_os.org_invitation")).n);
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect(await count()).toBe(1);
      await actAs(c, w.actor("DESIGN_HEAD"), { apiRole: true });
      expect(await count()).toBe(0);
      await actAs(c, other.actor("ADMIN"), { apiRole: true });
      expect(await count()).toBe(0);
      await asPerson(c, person);
      expect(await count()).toBe(1);
      await asPerson(c, stranger);
      expect(await count()).toBe(0);
    });
  });

  it("an ADMIN revokes a PENDING invitation (as themselves); an ACCEPTED one can no longer change", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await invite(c, w, email(), ["DESIGNER"]);
      await actAs(c, w.actor("DESIGN_HEAD"), { apiRole: true });
      expect((await c.query("UPDATE design_os.org_invitation SET status = 'REVOKED', revoked_by = $2, revoked_at = now() WHERE id = $1", [id, w.users.DESIGN_HEAD])).rowCount).toBe(0);
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect((await attempt(c, () => c.query("UPDATE design_os.org_invitation SET status = 'REVOKED', revoked_by = $2, revoked_at = now() WHERE id = $1", [id, w.users.SALES])))?.message).toContain("row-level security");
      expect((await c.query("UPDATE design_os.org_invitation SET status = 'REVOKED', revoked_by = $2, revoked_at = now() WHERE id = $1", [id, w.users.ADMIN])).rowCount).toBe(1);
      expect((await c.query("UPDATE design_os.org_invitation SET status = 'PENDING', revoked_by = NULL, revoked_at = NULL WHERE id = $1", [id])).rowCount).toBe(0);
      // Invitation content is not updatable by the API role at all.
      expect((await attempt(c, () => c.query("UPDATE design_os.org_invitation SET roles = '{ADMIN}' WHERE id = $1", [id])))?.message).toContain("permission denied");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.org_invitation WHERE id = $1", [id])))?.message).toContain("permission denied");
    });
  });
});

describe("self-provisioning from an invitation", () => {
  it("the invited person creates their own INTERNAL identity and exactly the invited memberships, then accepts", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const e = email();
      const inv = await invite(c, w, e, ["DESIGNER", "SITE_ENGINEER"]);
      const person = await authUser(c, e);
      await asPerson(c, person);
      await provision(c, person, e);
      await member(c, w.org, person, "DESIGNER", w.users.ADMIN);
      await member(c, w.org, person, "SITE_ENGINEER", w.users.ADMIN);
      expect((await accept(c, inv, person)).rowCount).toBe(1);

      // The organization is now selectable and yields exactly the invited roles' actions.
      await actAs(c, { userId: person, orgId: w.org }, { apiRole: true });
      expect((await c.query("SELECT org_id FROM design_os.current_memberships()")).rows).toEqual([{ org_id: w.org }]);
      const perms = await one<{ approve: boolean; author: boolean; survey: boolean; manage: boolean }>(c,
        "SELECT design_os.has_permission('design_version.approve') AS approve, design_os.has_permission('design_version.author') AS author, design_os.has_permission('room.survey.write') AS survey, design_os.has_permission('org.members.manage') AS manage");
      expect(perms).toEqual({ approve: false, author: true, survey: true, manage: false });
      const granted = await c.query("SELECT role, granted_by, status FROM design_os.org_membership WHERE user_id = $1 ORDER BY role", [person]);
      expect(granted.rows).toEqual([{ role: "DESIGNER", granted_by: w.users.ADMIN, status: "ACTIVE" }, { role: "SITE_ENGINEER", granted_by: w.users.ADMIN, status: "ACTIVE" }]);

      // The acceptance and the memberships are in the organization's audit chain, with the person as actor.
      await actAs(c, null);
      const audit = await c.query("SELECT table_name, action FROM design_os.audit_log WHERE org_id = $1 AND actor_user_id = $2 ORDER BY id", [w.org, person]);
      expect(audit.rows).toEqual([
        { table_name: "org_membership", action: "INSERT" }, { table_name: "org_membership", action: "INSERT" }, { table_name: "org_invitation", action: "UPDATE" }]);
    });
  });

  it("refuses anything beyond the invitation: another identity, email, name, kind, role, grantor or organization", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const e = email();
      await invite(c, w, e, ["DESIGNER"]);
      const person = await authUser(c, e);
      const stranger = await authUser(c, email());
      const rls = async (fn: () => Promise<unknown>) => { expect((await attempt(c, fn))?.message).toContain("row-level security"); };

      await asPerson(c, stranger);
      await rls(() => provision(c, stranger, e));                    // not their email
      await rls(() => provision(c, person, e));                      // not their identity
      await asPerson(c, person);
      await rls(() => provision(c, person, e, "Someone Else"));      // not the name the administrator gave
      await rls(() => provision(c, person, e, "Asha Rao", "CLIENT")); // never a CLIENT identity
      await provision(c, person, e);
      await rls(() => member(c, w.org, person, "ADMIN", w.users.ADMIN));        // not an invited role
      await rls(() => member(c, w.org, person, "DESIGNER", w.users.DESIGN_HEAD)); // not the inviter
      await rls(() => member(c, w.org, person, "DESIGNER", null));
      await rls(() => member(c, other.org, person, "DESIGNER", other.users.ADMIN)); // not the inviting organization
      await rls(() => member(c, w.org, stranger, "DESIGNER", w.users.ADMIN));   // not for someone else
      // No organization context exists until a membership does.
      await actAs(c, { userId: person, orgId: w.org }, { apiRole: true });
      expect((await one<{ org: string | null }>(c, "SELECT design_os.current_org_id() AS org")).org).toBeNull();
    });
  });

  it("an invitation someone else received cannot be accepted, and expired, revoked or accepted invitations grant nothing", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const e = email();
      const inv = await invite(c, w, e, ["DESIGNER"]);
      const person = await authUser(c, e);
      const stranger = await authUser(c, email());
      await asPerson(c, stranger);
      expect((await accept(c, inv, stranger)).rowCount).toBe(0);

      // Accepted: nothing more can be claimed with it.
      await asPerson(c, person);
      await provision(c, person, e);
      await member(c, w.org, person, "DESIGNER", w.users.ADMIN);
      expect((await accept(c, inv, person)).rowCount).toBe(1);
      expect((await attempt(c, () => member(c, w.org, person, "DESIGNER", w.users.ADMIN)))?.message).toMatch(/duplicate key|row-level security/);

      // Expired.
      const e2 = email();
      const expired = await invite(c, w, e2, ["SALES"]);
      await actAs(c, null);
      await c.query("UPDATE design_os.org_invitation SET created_at = now() - interval '20 days', expires_at = now() - interval '1 day' WHERE id = $1", [expired]);
      const late = await authUser(c, e2);
      await asPerson(c, late);
      expect((await attempt(c, () => provision(c, late, e2)))?.message).toContain("row-level security");
      expect((await accept(c, expired, late)).rowCount).toBe(0);

      // Revoked.
      const e3 = email();
      const revoked = await invite(c, w, e3, ["SALES"]);
      await c.query("UPDATE design_os.org_invitation SET status = 'REVOKED', revoked_by = $2, revoked_at = now() WHERE id = $1", [revoked, w.users.ADMIN]);
      const gone = await authUser(c, e3);
      await asPerson(c, gone);
      expect((await attempt(c, () => provision(c, gone, e3)))?.message).toContain("row-level security");
    });
  });

  it("an existing member invited to more roles re-activates a revoked membership of an invited role only", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      const designer = w.users.DESIGNER;
      const e = (await one<{ email: string }>(c, "SELECT email FROM design_os.app_user WHERE id = $1", [designer])).email;
      await c.query("UPDATE design_os.org_membership SET status = 'REVOKED' WHERE org_id = $1 AND user_id = $2 AND role = 'DESIGNER'", [w.org, designer]);
      const inv = await invite(c, w, e, ["DESIGNER"], e);
      await asPerson(c, designer);
      expect((await c.query("UPDATE design_os.org_membership SET status = 'ACTIVE', granted_by = $3, granted_at = now() WHERE org_id = $1 AND user_id = $2 AND role = 'DESIGNER'", [w.org, designer, w.users.ADMIN])).rowCount).toBe(1);
      expect((await accept(c, inv, designer)).rowCount).toBe(1);
      expect((await c.query("UPDATE design_os.org_membership SET status = 'ACTIVE' WHERE org_id = $1 AND user_id = $2", [w.org, designer])).rowCount).toBe(0);
    });
  });

  it("a CLIENT identity can never take an internal role through an invitation (existing membership guard)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      const e = email();
      const clientUser = await createUser(c, e, "CLIENT");
      await invite(c, w, e, ["DESIGNER"], e);
      await asPerson(c, clientUser);
      expect((await attemptDb(c, () => member(c, w.org, clientUser, "DESIGNER", w.users.ADMIN)))?.code).toBe("LD018");
    });
  });
});
