/**
 * OD-2: an operation with an Idempotency-Key executes at most once per (org, scope, key). The database enforces
 * the uniqueness and the claim protocol; the API only calls claim_idempotency() / complete_idempotency() inside
 * the request transaction.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { contentHash } from "@lintel/persistence";
import type { Actor, Tx } from "./support/db.js";
import { actAs, attemptDb, one, tx } from "./support/db.js";
import { createWorld } from "./support/world.js";

interface Claim {
  readonly outcome: "EXECUTE" | "REPLAY";
  readonly record_id: string;
  readonly response_status: number | null;
  readonly response_body: unknown;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
}

const KEY = () => randomUUID();
const H = (s: string) => contentHash(s);

async function claim(c: Tx | pg.Client, actor: Actor, scope: string, key: string, requestHash: string): Promise<Claim> {
  await c.query("RESET ROLE");
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor.userId, org_id: actor.orgId })]);
  await c.query("SET LOCAL ROLE design_os_api");
  const r = await c.query<Claim>("SELECT * FROM design_os.claim_idempotency($1, $2, $3)", [scope, key, requestHash]);
  const row = r.rows[0];
  if (row === undefined) throw new Error("no claim row");
  return row;
}

async function complete(c: Tx | pg.Client, id: string, status: number, body: unknown, resource: [string, string] | null = null): Promise<void> {
  await c.query("SELECT design_os.complete_idempotency($1, $2::smallint, $3::jsonb, $4, $5)", [id, status, body === null ? null : JSON.stringify(body), resource?.[0] ?? null, resource?.[1] ?? null]);
}

async function code(c: Tx, fn: () => Promise<unknown>): Promise<string | undefined> {
  return (await attemptDb(c, fn))?.code;
}

describe("claim → execute once → replay; conflicts are refused", () => {
  it("the first request executes and stores its result; an identical retry replays it", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const key = KEY();
      const first = await claim(c, w.actor("DESIGNER"), "transition", key, H("request A"));
      expect(first).toMatchObject({ outcome: "EXECUTE", response_status: null });
      await complete(c, first.record_id, 200, { status: "IN_REVIEW" });
      const again = await claim(c, w.actor("DESIGNER"), "transition", key, H("request A"));
      expect(again).toEqual({ outcome: "REPLAY", record_id: first.record_id, response_status: 200, response_body: { status: "IN_REVIEW" }, resource_type: null, resource_id: null });
    });
  });
  it("a large result replays through its durable resource reference", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const key = KEY();
      const snapshot = randomUUID();
      const first = await claim(c, w.actor("DESIGNER"), "snapshot.bom.generate", key, H("bom request"));
      await complete(c, first.record_id, 201, null, ["bom_snapshot", snapshot]);
      expect(await claim(c, w.actor("DESIGNER"), "snapshot.bom.generate", key, H("bom request"))).toMatchObject({ outcome: "REPLAY", response_status: 201, resource_type: "bom_snapshot", resource_id: snapshot });
    });
  });
  it("the same key with a different request hash, or by another user, is IDEMPOTENCY_CONFLICT (LD022)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const key = KEY();
      const first = await claim(c, w.actor("DESIGNER"), "transition", key, H("request A"));
      await complete(c, first.record_id, 200, { ok: true });
      expect(await code(c, () => claim(c, w.actor("DESIGNER"), "transition", key, H("request B")))).toBe("LD022");
      expect(await code(c, () => claim(c, w.actor("DESIGN_HEAD"), "transition", key, H("request A")))).toBe("LD022");
    });
  });
  it("scopes and organizations are independent key spaces", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const key = KEY();
      const a = await claim(c, w.actor("DESIGNER"), "transition", key, H("x"));
      await complete(c, a.record_id, 200, { ok: 1 });
      expect((await claim(c, w.actor("DESIGNER"), "validation_run.record", key, H("x"))).outcome).toBe("EXECUTE");
      expect((await claim(c, other.actor("DESIGNER"), "transition", key, H("x"))).outcome).toBe("EXECUTE");
    });
  });
  it("a repeated claim before completion in the same transaction is IDEMPOTENCY_IN_PROGRESS (LD023)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const key = KEY();
      await claim(c, w.actor("DESIGNER"), "transition", key, H("x"));
      expect(await code(c, () => claim(c, w.actor("DESIGNER"), "transition", key, H("x")))).toBe("LD023");
    });
  });
  it("an expired record frees its key: the next claim executes again", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const key = KEY();
      await actAs(c, null);
      const old = (await one<{ id: string }>(c, `
        INSERT INTO design_os.idempotency_record (org_id, scope, idempotency_key, actor_user_id, request_hash, status, response_status, response_body, created_at, completed_at, expires_at)
        VALUES ($1, 'transition', $2, $3, $4, 'COMPLETED', 200, '{"old":true}', now() - interval '2 days', now() - interval '2 days', now() - interval '1 day') RETURNING id`,
        [w.org, key, w.users.DESIGN_HEAD, H("old request")])).id;
      const again = await claim(c, w.actor("DESIGNER"), "transition", key, H("new request"));
      expect(again).toMatchObject({ outcome: "EXECUTE", record_id: old });
    });
  });
  it("claims need an authenticated member of the organization", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      expect(await code(c, () => claim(c, { userId: other.users.DESIGNER, orgId: w.org }, "transition", KEY(), H("x")))).toBe("LD002");
    });
  });
  it("only the claiming identity can complete a claim", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const first = await claim(c, w.actor("DESIGNER"), "transition", KEY(), H("x"));
      await actAs(c, w.actor("DESIGN_HEAD"), { apiRole: true });
      expect(await code(c, () => complete(c, first.record_id, 200, {}))).toBe("LD005");
    });
  });
});

describe("the database enforces the protocol", () => {
  it("(org_id, scope, idempotency_key) is UNIQUE in the database", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await actAs(c, null);
      const insert = (hash: string) => c.query("INSERT INTO design_os.idempotency_record (org_id, scope, idempotency_key, actor_user_id, request_hash, expires_at) VALUES ($1, 'transition', 'fixed-key-0000000001', $2, $3, now() + interval '1 hour')", [w.org, w.users.DESIGNER, hash]);
      await insert(H("a"));
      const err = await attemptDb(c, () => insert(H("b")));
      expect([err?.code, err?.constraint]).toEqual(["23505", "idempotency_record_key"]);
    });
  });
  it("scope, key and request hash are validated", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      expect(await code(c, () => claim(c, w.actor("DESIGNER"), "delete_everything", KEY(), H("x")))).toBe("23514");
      expect(await code(c, () => claim(c, w.actor("DESIGNER"), "transition", "short", H("x")))).toBe("23514");
      expect(await code(c, () => claim(c, w.actor("DESIGNER"), "transition", KEY(), "not-a-hash"))).toBe("23514");
    });
  });
  it("a claim cannot commit unless it was completed (LD905)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await claim(c, w.actor("DESIGNER"), "transition", KEY(), H("x"));
      expect(await code(c, () => c.query("SET CONSTRAINTS design_os.idempotency_must_complete IMMEDIATE"))).toBe("LD905");
    });
    await tx(async (c) => {
      const w = await createWorld(c);
      const first = await claim(c, w.actor("DESIGNER"), "transition", KEY(), H("x"));
      await complete(c, first.record_id, 200, { ok: true });
      await c.query("SET CONSTRAINTS design_os.idempotency_must_complete IMMEDIATE");
    });
  });
  it("completed results are immutable and records are never deleted (LD015)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const first = await claim(c, w.actor("DESIGNER"), "transition", KEY(), H("x"));
      await complete(c, first.record_id, 200, { ok: true });
      await actAs(c, null);
      expect(await code(c, () => c.query("UPDATE design_os.idempotency_record SET response_body = '{\"forged\":true}' WHERE id = $1", [first.record_id]))).toBe("LD015");
      expect(await code(c, () => c.query("UPDATE design_os.idempotency_record SET scope = 'drawing.issue' WHERE id = $1", [first.record_id]))).toBe("LD015");
      expect(await code(c, () => c.query("DELETE FROM design_os.idempotency_record WHERE id = $1", [first.record_id]))).toBe("LD015");
    });
  });
  it("the API role has no direct write access, and reads only its own records in the current org", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const other = await createWorld(c);
      const mine = await claim(c, w.actor("DESIGNER"), "transition", KEY(), H("mine"));
      await complete(c, mine.record_id, 200, { ok: true });
      const theirs = await claim(c, w.actor("SALES"), "quotation.issue", KEY(), H("theirs"));
      await complete(c, theirs.record_id, 201, { ok: true });
      const foreign = await claim(c, other.actor("DESIGNER"), "transition", KEY(), H("foreign"));
      await complete(c, foreign.record_id, 200, { ok: true });
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      expect((await c.query<{ id: string }>("SELECT id FROM design_os.idempotency_record")).rows.map((r) => r.id)).toEqual([mine.record_id]);
      expect(await code(c, () => c.query("INSERT INTO design_os.idempotency_record (org_id, scope, idempotency_key, actor_user_id, request_hash, expires_at) VALUES ($1, 'transition', 'direct-insert-00000001', $2, $3, now() + interval '1 hour')", [w.org, w.users.DESIGNER, H("x")]))).toBe("42501");
      expect(await code(c, () => c.query("UPDATE design_os.idempotency_record SET response_status = 204"))).toBe("42501");
      expect(await code(c, () => c.query("DELETE FROM design_os.idempotency_record"))).toBe("42501");
    });
  });
  it("no privileges for PUBLIC or the Supabase REST roles", async () => {
    await tx(async (c) => {
      await actAs(c, null);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const t = await one<{ ok: boolean }>(c, "SELECT has_table_privilege($1, 'design_os.idempotency_record', 'SELECT') AS ok", [role]);
        const f = await one<{ ok: boolean }>(c, "SELECT has_function_privilege($1, 'design_os.claim_idempotency(text, text, text, interval)', 'EXECUTE') AS ok", [role]);
        expect([role, t.ok, f.ok]).toEqual([role, false, false]);
      }
      const publicFns = await one<{ n: number }>(c, `
        SELECT count(*)::int AS n FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.pronamespace = 'design_os'::regnamespace AND a.grantee = 0
          AND p.proname IN ('claim_idempotency', 'complete_idempotency', 'guard_idempotency_record', 'check_idempotency_completed', 'current_memberships', 'approval_problem_items')`);
      expect(publicFns.n).toBe(0);
    });
  });
});

/**
 * Real concurrency across connections. These commit, so they run in the separate race database (a copy of the
 * migrated schema that is dropped when the suite ends).
 */
describe("concurrent duplicates never execute twice", () => {
  async function connect(): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: inject("raceDbUrl") });
    await client.connect();
    return client;
  }
  async function setupWorld(): Promise<{ actor: Actor; org: string }> {
    const c = await connect();
    try {
      await c.query("BEGIN");
      const w = await createWorld(c as unknown as Tx);
      await c.query("COMMIT");
      return { actor: w.actor("DESIGNER"), org: w.org };
    } finally {
      await c.end();
    }
  }
  /** The protected operation: claim, and only on EXECUTE create one client row (the effect), then complete. */
  async function operation(c: pg.Client, actor: Actor, key: string, name: string): Promise<Claim> {
    const got = await claim(c, actor, "client_contact.invite", key, H(`invite ${name}`));
    if (got.outcome === "EXECUTE") {
      await c.query("RESET ROLE");
      const id = (await c.query<{ id: string }>("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, $2, $3) RETURNING id", [actor.orgId, `C_${key.slice(0, 8)}`, name])).rows[0]?.id ?? "";
      await c.query("SET LOCAL ROLE design_os_api");
      await complete(c, got.record_id, 201, null, ["client", id]);
    }
    return got;
  }
  async function effects(org: string, name: string): Promise<number> {
    const c = await connect();
    try {
      return Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM design_os.client WHERE org_id = $1 AND name = $2", [org, name])).rows[0]?.n);
    } finally {
      await c.end();
    }
  }

  it("a duplicate waiting on a committed original replays it; the effect exists once", async () => {
    const { actor, org } = await setupWorld();
    const key = KEY();
    const a = await connect();
    const b = await connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      const first = await operation(a, actor, key, "race-commit");
      const second = operation(b, actor, key, "race-commit"); // blocks on the unique key
      await new Promise((r) => setTimeout(r, 200));
      await a.query("COMMIT");
      const replay = await second;
      await b.query("COMMIT");
      expect(first.outcome).toBe("EXECUTE");
      expect(replay).toMatchObject({ outcome: "REPLAY", record_id: first.record_id, response_status: 201, resource_type: "client" });
      expect(await effects(org, "race-commit")).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });
  it("a duplicate waiting on a rolled-back original executes instead; still exactly one effect", async () => {
    const { actor, org } = await setupWorld();
    const key = KEY();
    const a = await connect();
    const b = await connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      await operation(a, actor, key, "race-rollback");
      const second = operation(b, actor, key, "race-rollback");
      await new Promise((r) => setTimeout(r, 200));
      await a.query("ROLLBACK");
      expect((await second).outcome).toBe("EXECUTE");
      await b.query("COMMIT");
      expect(await effects(org, "race-rollback")).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });
  it("a duplicate of a still-running original gets IDEMPOTENCY_IN_PROGRESS (LD023) after the lock timeout", async () => {
    const { actor, org } = await setupWorld();
    const key = KEY();
    const a = await connect();
    const b = await connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      await operation(a, actor, key, "race-timeout");
      const err = await operation(b, actor, key, "race-timeout").then(() => null, (e: unknown) => e as Error & { code?: string });
      expect(err?.code).toBe("LD023");
      await b.query("ROLLBACK");
      await a.query("COMMIT");
      expect(await effects(org, "race-timeout")).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  }, 15_000);
});
