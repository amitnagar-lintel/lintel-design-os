/**
 * `pnpm db:migrate <status|up> [options]` — the production migration runner (G6).
 *
 *   status [--check] [--json]
 *       Read-only readout of the target. Exit 0, or 2 on drift, or (with --check) 3 while migrations are pending.
 *   up --env <local|ci|staging|production> [--confirm <target>] [--to <version>] [--dry-run] [--lock-timeout 30s] [--json]
 *       Apply pending migrations in order. Exit 0 applied / nothing to do, 1 a migration failed (rolled back),
 *       2 drift (nothing applied), 4 refused (guard or missing prerequisites).
 *
 * Connection: MIGRATION_DATABASE_URL only. Usage errors exit 64.
 */
import { pathToFileURL } from "node:url";
import pg from "pg";
import type { Migration } from "./migrations.js";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations } from "./migrations.js";
import type { Status, UpResult } from "./runner.js";
import { status as readStatus, up } from "./runner.js";
import type { Args } from "./target.js";
import { allowFlags, connectionString, environmentFlag, guard, parseArgs, RefusedError, stringFlag, targetOf } from "./target.js";

export const EXIT = { OK: 0, FAILED: 1, DRIFT: 2, PENDING: 3, REFUSED: 4, USAGE: 64 } as const;

interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function statusJson(s: Status, target: string) {
  return {
    target,
    state: s.state,
    database: s.database,
    applied: s.applied,
    pending: s.pending.map((m) => `${m.version}_${m.name}`),
    drift: s.drift,
    prerequisitesMissing: s.prerequisites,
  };
}

function printStatus(s: Status, target: string, io: Io): void {
  io.out(`target:    ${target} (PostgreSQL ${s.database.serverVersion}, user ${s.database.currentUser})`);
  io.out(`state:     ${s.state}`);
  io.out(`applied:   ${s.applied.length === 0 ? "none" : `${s.applied.length} (last ${s.applied[s.applied.length - 1] ?? ""})`}`);
  io.out(`pending:   ${s.pending.length === 0 ? "none" : s.pending.map((m) => `${m.version}_${m.name}`).join(", ")}`);
  for (const d of s.drift) io.out(`DRIFT      ${d.version} ${d.kind}: ${d.detail}`);
  for (const p of s.prerequisites) io.out(`MISSING    ${p}`);
}

function upJson(r: UpResult, target: string) {
  return { outcome: r.outcome, applied: r.applied, ...(r.outcome === "FAILED" ? { failed: r.failed } : {}), ...(r.outcome === "APPLIED" ? { dryRun: r.dryRun } : {}), status: statusJson(r.status, target) };
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, application_name: "lintel-design-os-migrate" });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function run(argv: readonly string[], io: Io, migrationsDir = DEFAULT_MIGRATIONS_DIR): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
    const json = args.flags.get("json") === true;
    const migrations: Migration[] = loadMigrations(migrationsDir);
    if (args.command === "status") {
      allowFlags(args, ["check", "json"]);
      const url = connectionString(io.env);
      const target = targetOf(url);
      const s = await withClient(url, (c) => readStatus(c, migrations));
      if (json) io.out(JSON.stringify(statusJson(s, target.display)));
      else printStatus(s, target.display, io);
      if (s.state === "DRIFT") return EXIT.DRIFT;
      return args.flags.get("check") === true && s.pending.length > 0 ? EXIT.PENDING : EXIT.OK;
    }
    if (args.command === "up") {
      allowFlags(args, ["env", "confirm", "to", "dry-run", "lock-timeout", "json"]);
      const env = environmentFlag(args);
      const url = connectionString(io.env);
      const target = targetOf(url);
      guard(env, target, stringFlag(args, "confirm"));
      const to = stringFlag(args, "to");
      const lockTimeout = stringFlag(args, "lock-timeout") ?? "30s";
      if (!/^\d+(ms|s|min)$/.test(lockTimeout)) throw new RefusedError("USAGE", "--lock-timeout must look like 500ms, 30s or 2min");
      const r = await withClient(url, (c) => up(c, migrations, {
        ...(to === undefined ? {} : { to }),
        dryRun: args.flags.get("dry-run") === true,
        lockTimeout,
        onApplied: (m, ms) => { if (!json) io.out(`applied    ${m.version}_${m.name} (${ms} ms)`); },
      }));
      if (json) io.out(JSON.stringify(upJson(r, target.display)));
      else {
        if (r.outcome === "APPLIED" && r.dryRun) for (const v of r.applied) io.out(`would apply ${v}`);
        if (r.outcome === "FAILED") io.err(`FAILED     ${r.failed.version}_${r.failed.name} [${r.failed.sqlstate ?? "?"}] ${r.failed.message} — rolled back; ${r.applied.length} earlier migration(s) committed`);
        printStatus(r.status, target.display, io);
        io.out(`outcome:   ${r.outcome}`);
      }
      switch (r.outcome) {
        case "APPLIED": return EXIT.OK;
        case "DRIFT": return EXIT.DRIFT;
        case "PREREQUISITES_MISSING": return EXIT.REFUSED;
        case "FAILED": return EXIT.FAILED;
      }
    }
    throw new RefusedError("USAGE", "usage: db:migrate <status|up> [options]");
  } catch (e) {
    if (e instanceof RefusedError) {
      io.err(`refused: ${e.message}`);
      return e.code === "USAGE" ? EXIT.USAGE : EXIT.REFUSED;
    }
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.FAILED;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), { env: process.env, out: (l) => { console.log(l); }, err: (l) => { console.error(l); } });
}
