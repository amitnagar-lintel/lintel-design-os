/**
 * The production migration runner (G6). Forward-only. Applies `database/migrations` exactly as written and records
 * each one in the existing ledger `design_os_migrations.applied` (version, name, checksum, applied_at).
 *
 * - One transaction per migration: the SQL, then its ledger row. A failure rolls both back; earlier migrations stay.
 * - Every transaction first takes a transaction-scoped advisory lock and re-reads the ledger under it, so concurrent
 *   runners apply each migration exactly once.
 * - It runs over a DIRECT Postgres connection only (MIGRATION_DATABASE_URL); a Supabase pooler is refused by the
 *   target guard. The API runtime connection is separate and never used for migrations.
 * - Fail closed: any drift between the ledger and the files (checksum, name, unknown or out-of-order version) stops the
 *   runner before it writes anything, and is re-checked before every migration.
 * - It never creates what Supabase provides (`auth.users`, `auth.uid()`): a database without them is refused.
 *   (The CI stand-ins in database/bootstrap are applied by the test suite only, never by this runner.)
 */
import type pg from "pg";
import type { Assessment, LedgerRow, Migration } from "./migrations.js";
import { assess } from "./migrations.js";

/** Constant advisory-lock key of the migration runner ("design_os_migrations"). */
export const MIGRATION_LOCK_KEY = "design_os_migrations";

export interface DatabaseInfo {
  readonly serverVersion: string;
  readonly currentUser: string;
  readonly database: string;
}

export interface Status extends Assessment {
  readonly database: DatabaseInfo;
  readonly prerequisites: readonly string[];
}

export interface UpOptions {
  /** Apply up to and including this version only. */
  readonly to?: string;
  readonly dryRun?: boolean;
  /** `lock_timeout` for each migration's transaction (e.g. "30s"), so a migration never waits forever on a busy table. */
  readonly lockTimeout?: string;
  /** Called after each migration commits. */
  readonly onApplied?: (m: Migration, ms: number) => void;
}

export type UpResult =
  | { readonly outcome: "APPLIED"; readonly applied: readonly string[]; readonly dryRun: boolean; readonly status: Status }
  | { readonly outcome: "DRIFT"; readonly applied: readonly string[]; readonly status: Status }
  | { readonly outcome: "PREREQUISITES_MISSING"; readonly applied: readonly string[]; readonly status: Status }
  | { readonly outcome: "FAILED"; readonly applied: readonly string[]; readonly failed: { readonly version: string; readonly name: string; readonly sqlstate: string | null; readonly message: string }; readonly status: Status };

const LEDGER_DDL = [
  "CREATE SCHEMA IF NOT EXISTS design_os_migrations",
  "CREATE TABLE IF NOT EXISTS design_os_migrations.applied (version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
];

export async function databaseInfo(client: pg.ClientBase): Promise<DatabaseInfo> {
  const r = await client.query<{ v: string; u: string; d: string }>("SELECT current_setting('server_version') AS v, current_user AS u, current_database() AS d");
  const row = r.rows[0];
  return { serverVersion: row?.v ?? "", currentUser: row?.u ?? "", database: row?.d ?? "" };
}

/** The ledger rows, or null when the ledger does not exist yet. */
export async function readLedger(client: pg.ClientBase): Promise<LedgerRow[] | null> {
  const exists = await client.query<{ t: string | null }>("SELECT to_regclass('design_os_migrations.applied')::text AS t");
  if (exists.rows[0]?.t == null) return null;
  return (await client.query<LedgerRow>("SELECT version, name, checksum FROM design_os_migrations.applied ORDER BY version")).rows;
}

/** What the target database must provide before any migration can run (Supabase provides these; see gate item 9). */
export async function missingPrerequisites(client: pg.ClientBase, pending: readonly Migration[]): Promise<string[]> {
  const r = await client.query<{ users: boolean; uid: boolean; roles: boolean; create_role: boolean }>(`SELECT
      to_regclass('auth.users') IS NOT NULL AS users,
      to_regprocedure('auth.uid()') IS NOT NULL AS uid,
      (SELECT count(*) = 2 FROM pg_roles WHERE rolname IN ('design_os_owner', 'design_os_api')) AS roles,
      (SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = current_user) AS create_role`);
  const p = r.rows[0];
  const missing: string[] = [];
  if (p?.users !== true) missing.push("auth.users (Supabase Auth) does not exist");
  if (p?.uid !== true) missing.push("auth.uid() (Supabase Auth) does not exist");
  if (pending.some((m) => m.version === "0001") && p?.roles !== true && p?.create_role !== true) missing.push("the migration user cannot create the design_os_owner / design_os_api roles");
  return missing;
}

/** Read-only readout of the target: nothing is created or changed. */
export async function status(client: pg.ClientBase, migrations: readonly Migration[]): Promise<Status> {
  const a = assess(migrations, await readLedger(client));
  return { ...a, database: await databaseInfo(client), prerequisites: a.pending.length > 0 ? await missingPrerequisites(client, a.pending) : [] };
}

async function lockAndAssess(client: pg.ClientBase, migrations: readonly Migration[]): Promise<Assessment> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [MIGRATION_LOCK_KEY]);
  return assess(migrations, await readLedger(client));
}

function sqlstateOf(e: unknown): string | null {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : null;
}

/** Apply every pending migration (or up to `to`) in order. Never throws for a migration failure: it reports it. */
export async function up(client: pg.ClientBase, migrations: readonly Migration[], opts: UpOptions = {}): Promise<UpResult> {
  if (opts.to !== undefined && !migrations.some((m) => m.version === opts.to)) throw new Error(`--to ${opts.to} is not a migration version`);
  const inScope = (m: Migration) => opts.to === undefined || m.version <= opts.to;
  const before = await status(client, migrations);
  if (before.state === "DRIFT") return { outcome: "DRIFT", applied: [], status: before };
  if (before.pending.filter(inScope).length === 0) return { outcome: "APPLIED", applied: [], dryRun: opts.dryRun === true, status: before };
  if (before.prerequisites.length > 0) return { outcome: "PREREQUISITES_MISSING", applied: [], status: before };
  if (opts.dryRun === true) return { outcome: "APPLIED", applied: before.pending.filter(inScope).map((m) => m.version), dryRun: true, status: before };

  // The ledger itself (idempotent, serialized by the same lock).
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [MIGRATION_LOCK_KEY]);
    for (const ddl of LEDGER_DDL) await client.query(ddl);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  const applied: string[] = [];
  for (;;) {
    await client.query("BEGIN");
    let next: Migration | undefined;
    try {
      const now = await lockAndAssess(client, migrations);
      if (now.state === "DRIFT") {
        await client.query("ROLLBACK");
        return { outcome: "DRIFT", applied, status: await status(client, migrations) };
      }
      next = now.pending[0];
      if (next === undefined || !inScope(next)) {
        await client.query("COMMIT");
        return { outcome: "APPLIED", applied, dryRun: false, status: await status(client, migrations) };
      }
      if (opts.lockTimeout !== undefined) await client.query("SELECT set_config('lock_timeout', $1, true)", [opts.lockTimeout]);
      const started = Date.now();
      await client.query(next.up);
      // Migrations switch to design_os_owner for their DDL; the ledger row is written as the migration user.
      await client.query("RESET ROLE");
      await client.query("INSERT INTO design_os_migrations.applied (version, name, checksum) VALUES ($1, $2, $3)", [next.version, next.name, next.checksum]);
      await client.query("COMMIT");
      applied.push(next.version);
      opts.onApplied?.(next, Date.now() - started);
    } catch (e) {
      await client.query("ROLLBACK");
      if (next === undefined) throw e;
      return {
        outcome: "FAILED",
        applied,
        failed: { version: next.version, name: next.name, sqlstate: sqlstateOf(e), message: e instanceof Error ? e.message : String(e) },
        status: await status(client, migrations),
      };
    }
  }
}
