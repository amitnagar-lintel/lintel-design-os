/**
 * The migration set and its comparison with the ledger. Pure: no database access.
 *
 * A migration is `database/migrations/NNNN_name.up.sql` with its rollback `NNNN_name.down.sql`. Its checksum is the
 * SHA-256 of the exact bytes of the up file, which is what `design_os_migrations.applied.checksum` records.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository's migrations (the deploy image carries the repository's `database/` folder). */
export const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "database", "migrations");

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly checksum: string;
}

/** One row of `design_os_migrations.applied`. */
export interface LedgerRow {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export type DriftKind = "CHECKSUM_MISMATCH" | "NAME_MISMATCH" | "UNKNOWN_APPLIED" | "OUT_OF_ORDER";

export interface Drift {
  readonly version: string;
  readonly kind: DriftKind;
  readonly detail: string;
}

export type LedgerState = "UNINITIALISED" | "UP_TO_DATE" | "PENDING" | "DRIFT";

export interface Assessment {
  readonly state: LedgerState;
  readonly applied: readonly string[];
  readonly pending: readonly Migration[];
  readonly drift: readonly Drift[];
}

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Every migration in version order. Refuses a malformed set (bad names, missing rollbacks, duplicate versions). */
export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const ups = files.filter((f) => f.endsWith(".up.sql"));
  const downs = new Set(files.filter((f) => f.endsWith(".down.sql")));
  if (ups.length + downs.size !== files.length) throw new Error("every migration file must end in .up.sql or .down.sql");
  const seen = new Set<string>();
  const migrations = ups.map((f) => {
    const base = f.slice(0, -".up.sql".length);
    const match = /^(\d{4})_([a-z0-9_]+)$/.exec(base);
    if (match === null) throw new Error(`bad migration name ${f}`);
    if (!downs.has(`${base}.down.sql`)) throw new Error(`migration ${base} has no rollback`);
    const version = match[1] ?? "";
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`);
    seen.add(version);
    const up = readFileSync(join(dir, f), "utf8");
    return { version, name: match[2] ?? "", up, down: readFileSync(join(dir, `${base}.down.sql`), "utf8"), checksum: checksumOf(up) };
  });
  const orphans = [...downs].filter((d) => !ups.includes(d.replace(/\.down\.sql$/, ".up.sql")));
  if (orphans.length > 0) throw new Error(`rollback without migration: ${orphans.join(", ")}`);
  return migrations;
}

/**
 * Compare the migration files with the ledger. Fail closed: any applied row that does not match its file exactly
 * (checksum, name), any applied version with no file, and any gap (a later version applied while an earlier one is
 * not) is drift. Pending migrations are only those after the last applied one.
 */
export function assess(migrations: readonly Migration[], ledger: readonly LedgerRow[] | null): Assessment {
  if (ledger === null) return { state: "UNINITIALISED", applied: [], pending: migrations, drift: [] };
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  const appliedSet = new Set(ledger.map((r) => r.version));
  const drift: Drift[] = [];
  for (const row of [...ledger].sort((a, b) => a.version.localeCompare(b.version))) {
    const m = byVersion.get(row.version);
    if (m === undefined) {
      drift.push({ version: row.version, kind: "UNKNOWN_APPLIED", detail: `applied migration ${row.version}_${row.name} has no file` });
      continue;
    }
    if (m.name !== row.name) drift.push({ version: row.version, kind: "NAME_MISMATCH", detail: `applied as "${row.name}", file is "${m.name}"` });
    if (m.checksum !== row.checksum) drift.push({ version: row.version, kind: "CHECKSUM_MISMATCH", detail: `applied checksum ${row.checksum}, file checksum ${m.checksum}` });
  }
  const lastApplied = migrations.reduce((last, m, i) => (appliedSet.has(m.version) ? i : last), -1);
  for (const m of migrations.slice(0, lastApplied + 1)) {
    if (!appliedSet.has(m.version)) drift.push({ version: m.version, kind: "OUT_OF_ORDER", detail: `${m.version}_${m.name} is not applied but a later migration is` });
  }
  const pending = migrations.slice(lastApplied + 1);
  const applied = migrations.filter((m) => appliedSet.has(m.version)).map((m) => m.version);
  const state: LedgerState = drift.length > 0 ? "DRIFT" : pending.length > 0 ? "PENDING" : "UP_TO_DATE";
  return { state, applied, pending, drift };
}
