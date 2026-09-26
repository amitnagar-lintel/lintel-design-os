/**
 * The production migration runner (G6) against real PostgreSQL 17 (LOCAL / CI only): success, rerun / idempotency,
 * a failing migration, drift detection, missing prerequisites, concurrent runners and the CLI readout. Each scenario
 * gets its own fresh database; the full migration set is also applied by the suite's global setup through this runner.
 */
import { copyFileSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { EXIT, run } from "../../src/migrate-cli.js";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations } from "../../src/migrations.js";
import { readLedger, status, up } from "../../src/runner.js";
import { applyBootstrap } from "../../../../tests/db/support/migrate.js";
import type {} from "../../../../tests/db/support/global-setup.js";

const created: string[] = [];
const dirs: string[] = [];

function urlOf(db: string): string {
  const u = new URL(inject("dbUrl"));
  u.pathname = `/${db}`;
  return u.toString();
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: inject("dbUrl") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** A fresh, empty database (optionally with the CI Supabase stand-ins) and a connection to it. */
async function freshDb(opts: { readonly supabase?: boolean } = {}): Promise<{ url: string; client: pg.Client }> {
  const name = `design_os_runner_${String(created.length)}_${String(process.pid)}`;
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).then(() => c.query(`CREATE DATABASE ${name}`)));
  created.push(name);
  const client = new pg.Client({ connectionString: urlOf(name) });
  await client.connect();
  if (opts.supabase !== false) await applyBootstrap(client);
  return { url: urlOf(name), client };
}

/** A migrations folder holding the first `n` real migrations (plus optional extra files). */
function migrationsDir(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "design-os-migrations-"));
  dirs.push(dir);
  const files = readdirSync(DEFAULT_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const keep = new Set(loadMigrations().slice(0, n).map((m) => m.version));
  for (const f of files) if (keep.has(f.slice(0, 4))) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
  return dir;
}

function io(url: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { env: { MIGRATION_DATABASE_URL: url }, out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

afterAll(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  await admin(async (c) => {
    for (const name of created) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });
});

describe("migration runner (G6)", () => {
  it("applies every migration in order, records version, name and checksum, and reports UP_TO_DATE", async () => {
    const { client } = await freshDb();
    try {
      const all = loadMigrations();
      expect((await status(client, all)).state).toBe("UNINITIALISED");
      const r = await up(client, all);
      expect(r.outcome).toBe("APPLIED");
      expect(r.applied).toEqual(all.map((m) => m.version));
      expect(await readLedger(client)).toEqual(all.map((m) => ({ version: m.version, name: m.name, checksum: m.checksum })));
      const s = await status(client, all);
      expect([s.state, s.pending.length, s.drift.length]).toEqual(["UP_TO_DATE", 0, 0]);
      // Same objects as the suite's database (also built by this runner): the migrations' semantics are untouched.
      const count = async (c: pg.ClientBase) => Number((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_class WHERE relnamespace = 'design_os'::regnamespace")).rows[0]?.n);
      expect(await count(client)).toBe(await admin(count));
    } finally {
      await client.end();
    }
  });

  it("is idempotent: a rerun applies nothing and changes nothing; --to stops at a version and the rest stays pending", async () => {
    const dir = migrationsDir(4);
    const migrations = loadMigrations(dir);
    const { client } = await freshDb();
    try {
      const first = await up(client, migrations, { to: "0002" });
      expect(first.applied).toEqual(["0001", "0002"]);
      const mid = await status(client, migrations);
      expect([mid.state, mid.pending.map((m) => m.version)]).toEqual(["PENDING", ["0003", "0004"]]);
      expect((await up(client, migrations)).applied).toEqual(["0003", "0004"]);
      const ledger = await client.query<{ version: string; applied_at: Date }>("SELECT version, applied_at FROM design_os_migrations.applied ORDER BY version");
      const again = await up(client, migrations);
      expect([again.outcome, again.applied]).toEqual(["APPLIED", []]);
      expect((await client.query("SELECT version, applied_at FROM design_os_migrations.applied ORDER BY version")).rows).toEqual(ledger.rows);
    } finally {
      await client.end();
    }
  });

  it("a dry run reports the plan and writes nothing (not even the ledger)", async () => {
    const migrations = loadMigrations(migrationsDir(3));
    const { client } = await freshDb();
    try {
      const r = await up(client, migrations, { dryRun: true });
      expect([r.outcome, r.applied]).toEqual(["APPLIED", ["0001", "0002", "0003"]]);
      expect(await readLedger(client)).toBeNull();
      expect((await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'design_os'")).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("a failing migration is rolled back completely; earlier ones stay committed; the fixed file then applies", async () => {
    const dir = migrationsDir(3);
    writeFileSync(join(dir, "0004_broken.up.sql"), "SET LOCAL ROLE design_os_owner;\nCREATE TABLE design_os.half_done (id int);\nSELECT 1 / 0;\n");
    writeFileSync(join(dir, "0004_broken.down.sql"), "SET LOCAL ROLE design_os_owner;\nDROP TABLE design_os.half_done;\n");
    const { client } = await freshDb();
    try {
      const r = await up(client, loadMigrations(dir));
      expect(r.outcome).toBe("FAILED");
      if (r.outcome !== "FAILED") return;
      expect(r.applied).toEqual(["0001", "0002", "0003"]);
      expect([r.failed.version, r.failed.name, r.failed.sqlstate]).toEqual(["0004", "broken", "22012"]);
      expect((await readLedger(client))?.map((x) => x.version)).toEqual(["0001", "0002", "0003"]);
      expect((await client.query("SELECT to_regclass('design_os.half_done') AS t")).rows[0]).toEqual({ t: null });
      expect((await status(client, loadMigrations(dir))).state).toBe("PENDING");

      // A never-applied file may still be corrected (no drift); it then applies normally.
      writeFileSync(join(dir, "0004_broken.up.sql"), "SET LOCAL ROLE design_os_owner;\nCREATE TABLE design_os.half_done (id int);\n");
      const fixed = await up(client, loadMigrations(dir));
      expect([fixed.outcome, fixed.applied]).toEqual(["APPLIED", ["0004"]]);
    } finally {
      await client.end();
    }
  });

  it("fails closed on drift: checksum, name, unknown and out-of-order versions — nothing further is applied", async () => {
    const dir = migrationsDir(3);
    const { client } = await freshDb();
    try {
      expect((await up(client, loadMigrations(dir), { to: "0002" })).applied).toEqual(["0001", "0002"]);
      const refused = async (kind: string, version: string) => {
        const migrations = loadMigrations(dir);
        const s = await status(client, migrations);
        expect(s.state).toBe("DRIFT");
        expect(s.drift).toContainEqual(expect.objectContaining({ version, kind }));
        const r = await up(client, migrations);
        expect([r.outcome, r.applied]).toEqual(["DRIFT", []]);
        expect((await readLedger(client))?.length).toBeGreaterThan(0);
        expect((await client.query("SELECT to_regclass('design_os.construction_variable') AS t")).rows[0]).toEqual({ t: null }); // 0003 never ran
      };

      // 1. An applied file changed after it was applied.
      const f1 = readdirSync(dir).find((f) => f.startsWith("0001_") && f.endsWith(".up.sql"))!;
      appendFileSync(join(dir, f1), "\n-- edited after apply\n");
      await refused("CHECKSUM_MISMATCH", "0001");
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, f1), join(dir, f1));

      // 2. An applied migration renamed.
      const f2 = readdirSync(dir).filter((f) => f.startsWith("0002_"));
      for (const f of f2) renameSync(join(dir, f), join(dir, f.replace(/^0002_[a-z0-9_]+/, "0002_renamed")));
      await refused("NAME_MISMATCH", "0002");
      for (const f of f2) renameSync(join(dir, f.replace(/^0002_[a-z0-9_]+/, "0002_renamed")), join(dir, f));

      // 3. The ledger names a migration that has no file.
      await client.query("INSERT INTO design_os_migrations.applied (version, name, checksum) VALUES ('0099', 'from_elsewhere', 'x')");
      await refused("UNKNOWN_APPLIED", "0099");
      await client.query("DELETE FROM design_os_migrations.applied WHERE version = '0099'");

      // 4. A gap: a later version applied while an earlier one is not.
      const row = (await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM design_os_migrations.applied WHERE version = '0001'")).rows[0]!;
      await client.query("DELETE FROM design_os_migrations.applied WHERE version = '0001'");
      await refused("OUT_OF_ORDER", "0001");
      await client.query("INSERT INTO design_os_migrations.applied (version, name, checksum) VALUES ('0001', $1, $2)", [row.name, row.checksum]);

      // Back in agreement: the runner continues.
      expect((await up(client, loadMigrations(dir))).applied).toEqual(["0003"]);
    } finally {
      await client.end();
    }
  });

  it("refuses a database without the Supabase prerequisites (auth.users, auth.uid()) and writes nothing", async () => {
    const { client } = await freshDb({ supabase: false });
    try {
      const r = await up(client, loadMigrations(migrationsDir(2)));
      expect(r.outcome).toBe("PREREQUISITES_MISSING");
      expect(r.status.prerequisites).toEqual(["auth.users (Supabase Auth) does not exist", "auth.uid() (Supabase Auth) does not exist"]);
      expect(await readLedger(client)).toBeNull();
    } finally {
      await client.end();
    }
  });

  it("concurrent runners apply each migration exactly once", async () => {
    const migrations = loadMigrations(migrationsDir(5));
    const { url, client } = await freshDb();
    const other = new pg.Client({ connectionString: url });
    await other.connect();
    try {
      const [a, b] = await Promise.all([up(client, migrations), up(other, migrations)]);
      expect([a.outcome, b.outcome]).toEqual(["APPLIED", "APPLIED"]);
      expect([...a.applied, ...b.applied].sort()).toEqual(migrations.map((m) => m.version));
      expect((await readLedger(client))?.map((r) => r.version)).toEqual(migrations.map((m) => m.version));
    } finally {
      await other.end();
      await client.end();
    }
  });

  it("CLI: machine-readable status and exit codes for deployment automation", async () => {
    const dir = migrationsDir(3);
    const { url, client } = await freshDb();
    await client.end();

    let t = io(url);
    expect(await run(["status", "--json"], t.io, dir)).toBe(EXIT.OK);
    expect(JSON.parse(t.out[0]!)).toMatchObject({ state: "UNINITIALISED", applied: [], pending: ["0001_foundation", "0002_tenancy_access", "0003_standards"], drift: [] });
    t = io(url);
    expect(await run(["status", "--check"], t.io, dir)).toBe(EXIT.PENDING);

    t = io(url);
    expect(await run(["up", "--env", "ci", "--json"], t.io, dir)).toBe(EXIT.OK);
    expect(JSON.parse(t.out[0]!)).toMatchObject({ outcome: "APPLIED", applied: ["0001", "0002", "0003"], status: { state: "UP_TO_DATE" } });
    t = io(url);
    expect(await run(["status", "--check", "--json"], t.io, dir)).toBe(EXIT.OK);

    // Hosted environments need an exact confirmation; nothing is contacted when it is missing or wrong.
    t = io(url);
    expect(await run(["up", "--env", "production"], t.io, dir)).toBe(EXIT.REFUSED);
    expect(t.err[0]).toMatch(/--confirm/);
    t = io(url);
    expect(await run(["up", "--env", "staging", "--confirm", "someone-else"], t.io, dir)).toBe(EXIT.REFUSED);
    t = io(url);
    expect(await run(["up"], t.io, dir)).toBe(EXIT.USAGE);

    // Drift is exit 2 for status and for up.
    const f = readdirSync(dir).find((x) => x.startsWith("0002_") && x.endsWith(".up.sql"))!;
    appendFileSync(join(dir, f), "\n-- drift\n");
    t = io(url);
    expect(await run(["status"], t.io, dir)).toBe(EXIT.DRIFT);
    expect(t.out.join("\n")).toMatch(/DRIFT\s+0002 CHECKSUM_MISMATCH/);
    t = io(url);
    expect(await run(["up", "--env", "ci"], t.io, dir)).toBe(EXIT.DRIFT);
  });
});
