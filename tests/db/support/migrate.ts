/**
 * Migration runner for LOCAL / CI PostgreSQL 17 only (M5 step 3). Never pointed at a hosted Supabase project.
 * Each migration file runs in its own transaction; applied versions are tracked in `design_os_migrations.applied`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "database");
export const MIGRATIONS_DIR = join(ROOT, "migrations");
export const BOOTSTRAP_FILE = join(ROOT, "bootstrap", "ci-supabase-stubs.sql");

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly checksum: string;
}

export function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ups = files.filter((f) => f.endsWith(".up.sql"));
  const downs = new Set(files.filter((f) => f.endsWith(".down.sql")));
  if (ups.length + downs.size !== files.length) throw new Error("every migration file must end in .up.sql or .down.sql");
  return ups.map((f) => {
    const base = f.slice(0, -".up.sql".length);
    const match = /^(\d{4})_([a-z0-9_]+)$/.exec(base);
    if (match === null) throw new Error(`bad migration name ${f}`);
    if (!downs.has(`${base}.down.sql`)) throw new Error(`migration ${base} has no rollback`);
    const up = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    return { version: match[1] ?? "", name: match[2] ?? "", up, down: readFileSync(join(MIGRATIONS_DIR, `${base}.down.sql`), "utf8"), checksum: createHash("sha256").update(up).digest("hex") };
  });
}

async function inTransaction(client: pg.Client, sql: string, after: () => Promise<unknown>): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    // Migrations switch to design_os_owner for their DDL; bookkeeping runs as the migration user.
    await client.query("RESET ROLE");
    await after();
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

export async function applyBootstrap(client: pg.Client): Promise<void> {
  await client.query(readFileSync(BOOTSTRAP_FILE, "utf8"));
  await client.query("CREATE SCHEMA IF NOT EXISTS design_os_migrations");
  await client.query("CREATE TABLE IF NOT EXISTS design_os_migrations.applied (version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
}

export async function appliedVersions(client: pg.Client): Promise<string[]> {
  const r = await client.query<{ version: string }>("SELECT version FROM design_os_migrations.applied ORDER BY version");
  return r.rows.map((x) => x.version);
}

export async function migrateUp(client: pg.Client): Promise<string[]> {
  const done = new Set(await appliedVersions(client));
  const applied: string[] = [];
  for (const m of loadMigrations()) {
    if (done.has(m.version)) continue;
    await inTransaction(client, m.up, () => client.query("INSERT INTO design_os_migrations.applied (version, name, checksum) VALUES ($1, $2, $3)", [m.version, m.name, m.checksum]));
    applied.push(m.version);
  }
  return applied;
}

export async function migrateDown(client: pg.Client): Promise<string[]> {
  const done = new Set(await appliedVersions(client));
  const reverted: string[] = [];
  for (const m of loadMigrations().reverse()) {
    if (!done.has(m.version)) continue;
    await inTransaction(client, m.down, () => client.query("DELETE FROM design_os_migrations.applied WHERE version = $1", [m.version]));
    reverted.push(m.version);
  }
  return reverted;
}
