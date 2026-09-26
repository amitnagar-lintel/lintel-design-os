/**
 * Migrations for the LOCAL / CI test databases. Applying uses the production migration runner (apps/db-tools, G6),
 * so every database test runs on a schema the runner built. The CI Supabase stand-ins and the rollback path are
 * test-only: the runner never creates what Supabase provides and is forward-only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { Migration } from "../../../apps/db-tools/src/migrations.js";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations as load } from "../../../apps/db-tools/src/migrations.js";
import { readLedger, up } from "../../../apps/db-tools/src/runner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "database");
export const MIGRATIONS_DIR = DEFAULT_MIGRATIONS_DIR;
export const BOOTSTRAP_FILE = join(ROOT, "bootstrap", "ci-supabase-stubs.sql");
export type { Migration };

export function loadMigrations(): Migration[] {
  return load(MIGRATIONS_DIR);
}

/** The CI stand-ins for what a Supabase project provides (LOCAL / CI only). */
export async function applyBootstrap(client: pg.Client): Promise<void> {
  await client.query(readFileSync(BOOTSTRAP_FILE, "utf8"));
}

export async function appliedVersions(client: pg.Client): Promise<string[]> {
  return ((await readLedger(client)) ?? []).map((r) => r.version);
}

/** All pending migrations through the production runner; any other outcome than APPLIED fails the setup. */
export async function migrateUp(client: pg.Client): Promise<string[]> {
  const r = await up(client, loadMigrations());
  if (r.outcome !== "APPLIED") throw new Error(`migration runner: ${r.outcome}${r.outcome === "FAILED" ? ` at ${r.failed.version}: ${r.failed.message}` : ""}`);
  return [...r.applied];
}

/** Test-only rollback of every applied migration, newest first (proves each down script). */
export async function migrateDown(client: pg.Client): Promise<string[]> {
  const done = new Set(await appliedVersions(client));
  const reverted: string[] = [];
  for (const m of loadMigrations().reverse()) {
    if (!done.has(m.version)) continue;
    await client.query("BEGIN");
    try {
      await client.query(m.down);
      await client.query("RESET ROLE");
      await client.query("DELETE FROM design_os_migrations.applied WHERE version = $1", [m.version]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    reverted.push(m.version);
  }
  return reverted;
}
