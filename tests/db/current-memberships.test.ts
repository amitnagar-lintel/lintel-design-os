/**
 * design_os.current_memberships(): the only data the API reads before it has an org context. It must return the
 * caller's own ACTIVE memberships (org ids only), derived from auth.uid() alone, and nothing about anyone else.
 * X-Org can only select one of these; it never establishes access by itself.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Tx } from "./support/db.js";
import { actAs, attemptDb, one, tx } from "./support/db.js";
import { createUser, createWorld } from "./support/world.js";

async function memberships(c: Tx, sub: string | null, orgClaim: string | null = null): Promise<string[]> {
  await c.query("RESET ROLE");
  const claims = sub === null ? "" : JSON.stringify(orgClaim === null ? { sub } : { sub, org_id: orgClaim });
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [claims]);
  await c.query("SET LOCAL ROLE design_os_api");
  const r = await c.query<{ org_id: string }>("SELECT * FROM design_os.current_memberships()");
  await c.query("RESET ROLE");
  return r.rows.map((x) => x.org_id);
}

describe("current_memberships() returns only the caller's own active memberships", () => {
  it("lists every org the identity is an ACTIVE member of — once, even with several roles", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const b = await createWorld(c);
      await actAs(c, null);
      await c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'DESIGNER')", [b.org, a.users.ADMIN]);
      await c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'SALES')", [a.org, a.users.ADMIN]);
      expect((await memberships(c, a.users.ADMIN)).sort()).toEqual([a.org, b.org].sort());
    });
  });
  it("never exposes another user's memberships (cross-user)", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const b = await createWorld(c);
      expect(await memberships(c, a.users.DESIGNER)).toEqual([a.org]);
      expect(await memberships(c, b.users.DESIGNER)).toEqual([b.org]);
      const stranger = await createUser(c, `stranger.${randomUUID().slice(0, 6)}@example.test`, "INTERNAL");
      expect(await memberships(c, stranger)).toEqual([]);
    });
  });
  it("an X-Org / org_id claim cannot widen the result (cross-tenant)", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const b = await createWorld(c);
      expect(await memberships(c, a.users.DESIGNER, b.org)).toEqual([a.org]);
      // …and naming a foreign org establishes no org context at all.
      await actAs(c, { userId: a.users.DESIGNER, orgId: b.org }, { apiRole: true });
      expect((await one<{ o: string | null }>(c, "SELECT design_os.current_org_id() AS o")).o).toBeNull();
    });
  });
  it("excludes revoked memberships, disabled users and suspended organizations", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const b = await createWorld(c);
      await actAs(c, null);
      await c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'DESIGNER')", [b.org, a.users.SALES]);
      expect((await memberships(c, a.users.SALES)).sort()).toEqual([a.org, b.org].sort());
      await c.query("UPDATE design_os.org_membership SET status = 'REVOKED' WHERE org_id = $1 AND user_id = $2", [b.org, a.users.SALES]);
      expect(await memberships(c, a.users.SALES)).toEqual([a.org]);
      await c.query("UPDATE design_os.organization SET status = 'SUSPENDED' WHERE id = $1", [a.org]);
      expect(await memberships(c, a.users.SALES)).toEqual([]);
      await c.query("UPDATE design_os.app_user SET status = 'DISABLED' WHERE id = $1", [b.users.DESIGNER]);
      expect(await memberships(c, b.users.DESIGNER)).toEqual([]);
    });
  });
  it("returns nothing without an authenticated identity", async () => {
    await tx(async (c) => {
      await createWorld(c);
      expect(await memberships(c, null)).toEqual([]);
    });
  });
  it("a CLIENT identity sees only its own CLIENT membership", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      await createWorld(c);
      expect(await memberships(c, a.users.CLIENT)).toEqual([a.org]);
    });
  });
});

describe("current_memberships() definition and privileges", () => {
  it("is SECURITY DEFINER with a fixed search_path, takes no parameters, returns org ids only, and derives identity from auth.uid()", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const f = await one<{ secdef: boolean; config: string[] | null; nargs: number; result: string; owner: string; src: string }>(c, `
        SELECT prosecdef AS secdef, proconfig AS config, pronargs::int AS nargs, pg_get_function_result(oid) AS result, proowner::regrole::text AS owner, prosrc AS src
        FROM pg_proc WHERE oid = 'design_os.current_memberships()'::regprocedure`);
      expect(f).toMatchObject({ secdef: true, config: ["search_path=pg_catalog, pg_temp"], nargs: 0, result: "TABLE(org_id uuid)", owner: "design_os_owner" });
      expect(f.src).toContain("auth.uid()");
      expect(f.src).not.toMatch(/claims|current_user_id|current_setting/);
    });
  });
  it("is executable by the API role only — not by PUBLIC, anon, authenticated or service_role", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      const can = async (role: string) => (await one<{ ok: boolean }>(c, "SELECT has_function_privilege($1, 'design_os.current_memberships()', 'EXECUTE') AS ok", [role])).ok;
      expect(await can("design_os_api")).toBe(true);
      for (const role of ["anon", "authenticated", "service_role"]) expect([role, await can(role)]).toEqual([role, false]);
      const publicGrant = await one<{ n: number }>(c, `
        SELECT count(*)::int AS n FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = 'design_os.current_memberships()'::regprocedure AND a.grantee = 0`);
      expect(publicGrant.n).toBe(0);
    });
  });
});

/** current_org_id() as the API's org context sees it: claims {sub, org_id}, API role. */
async function orgContext(c: Tx, sub: string, org: string): Promise<string | null> {
  await actAs(c, { userId: sub, orgId: org }, { apiRole: true });
  const r = await one<{ o: string | null }>(c, "SELECT design_os.current_org_id() AS o");
  await c.query("RESET ROLE");
  return r.o;
}

describe("current_org_id() applies exactly the same organization-status rule as current_memberships()", () => {
  it("active org → allowed; suspended org, inactive org and revoked membership → rejected", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const u = a.users.DESIGNER;
      expect(await orgContext(c, u, a.org)).toBe(a.org);
      await actAs(c, null);
      await c.query("UPDATE design_os.organization SET status = 'SUSPENDED' WHERE id = $1", [a.org]);
      expect(await orgContext(c, u, a.org)).toBeNull();
      await actAs(c, null);
      await c.query("UPDATE design_os.organization SET status = 'INACTIVE' WHERE id = $1", [a.org]);
      expect(await orgContext(c, u, a.org)).toBeNull();
      await actAs(c, null);
      await c.query("UPDATE design_os.organization SET status = 'ACTIVE' WHERE id = $1", [a.org]);
      expect(await orgContext(c, u, a.org)).toBe(a.org);
      await actAs(c, null);
      await c.query("UPDATE design_os.org_membership SET status = 'REVOKED' WHERE org_id = $1 AND user_id = $2", [a.org, u]);
      expect(await orgContext(c, u, a.org)).toBeNull();
    });
  });
  it("a non-ACTIVE organization yields no org context, so definer functions refuse it (LD002)", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      await actAs(c, null);
      await c.query("UPDATE design_os.organization SET status = 'SUSPENDED' WHERE id = $1", [a.org]);
      await actAs(c, a.actor("DESIGNER"), { apiRole: true });
      const err = await attemptDb(c, () => c.query("SELECT design_os.transition('design', gen_random_uuid(), 'SUBMIT', 'r', NULL)"));
      expect(err?.code).toBe("LD002");
    });
  });
  it("the two functions can never disagree: every membership × user × organization status combination", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const u = a.users.SALES;
      let checked = 0;
      for (const org of ["ACTIVE", "SUSPENDED", "INACTIVE"]) for (const member of ["ACTIVE", "REVOKED"]) for (const user of ["ACTIVE", "DISABLED"]) {
        await actAs(c, null);
        await c.query("UPDATE design_os.organization SET status = $2 WHERE id = $1", [a.org, org]);
        await c.query("UPDATE design_os.org_membership SET status = $3 WHERE org_id = $1 AND user_id = $2", [a.org, u, member]);
        await c.query("UPDATE design_os.app_user SET status = $2 WHERE id = $1", [u, user]);
        const listed = (await memberships(c, u)).includes(a.org);
        const context = (await orgContext(c, u, a.org)) === a.org;
        const expected = org === "ACTIVE" && member === "ACTIVE" && user === "ACTIVE";
        expect({ org, member, user, listed, context }).toEqual({ org, member, user, listed: expected, context: expected });
        checked++;
      }
      expect(checked).toBe(12);
    });
  });
  it("both functions read the same identity claim (auth.uid() = current_user_id())", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      // Same claims as the API sets; read directly (the API role itself has no access to the auth schema).
      await actAs(c, a.actor("DESIGNER"));
      const r = await one<{ uid: string; cu: string }>(c, "SELECT auth.uid()::text AS uid, design_os.current_user_id()::text AS cu");
      expect(r).toEqual({ uid: a.users.DESIGNER, cu: a.users.DESIGNER });
    });
  });
  it("organizations accept only ACTIVE, SUSPENDED and INACTIVE", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      await actAs(c, null);
      const err = await attemptDb(c, () => c.query("UPDATE design_os.organization SET status = 'ARCHIVED' WHERE id = $1", [a.org]));
      expect([err?.code, err?.constraint]).toEqual(["23514", "organization_status_check"]);
    });
  });
});
