/**
 * `pnpm -s db:intake <command> …` — the reviewed reference-data intake (M6 G2).
 *
 *   validate --file <intake.json> [--json]
 *       Offline: schema, TEST_FIXTURE, identity, lifecycle, provenance and completeness report. Exit 0 accepted, 5 refused.
 *   import --file <intake.json> --env <env> [--confirm <target>] --org <CODE> --as <author email> --operator <who> [--dry-run] [--json]
 *       Writes ONE new DRAFT version as the named author (RLS, audited). Exit 0 CREATED / WOULD_CREATE / UNCHANGED, 4 refused, 5 invalid.
 *   status --org <CODE> --type <type> --entity <CODE> --version <n> [--json]
 *       Read-only: lifecycle, content hash and the database's approval preconditions.
 *   submit  --env … --org … --type … --entity … --version … --as <author email> --operator <who> --reason <text> [--json]
 *   approve --env … --org … --type … --entity … --version … --as <approver email> --operator <who> --reason <text> --expected-content-hash <sha256:…> [--json]
 *       Through design_os.transition() only; the database enforces permission, separation of duties and the reviewed hash.
 *
 * Connection: MIGRATION_DATABASE_URL (a direct connection; never a pooler). Usage errors exit 64.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { EXIT } from "../migrate-cli.js";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations } from "../migrations.js";
import type { Args } from "../target.js";
import { allowFlags, connectionString, environmentFlag, guard, parseArgs, RefusedError, stringFlag, targetOf } from "../target.js";
import { importIntake } from "./importer.js";
import { transitionVersion, versionState } from "./lifecycle.js";
import type { Finding, IntakeType } from "./spec.js";
import { INTAKE_TYPES, validateIntake } from "./spec.js";

export const INTAKE_EXIT = { ...EXIT, INVALID: 5 } as const;

interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly readFile?: (path: string) => string;
}

function required(args: Args, name: string): string {
  const v = stringFlag(args, name);
  if (v === undefined || v.trim() === "") throw new RefusedError("USAGE", `--${name} is required`);
  return v;
}
function typeFlag(args: Args): IntakeType {
  const t = required(args, "type");
  if (!(INTAKE_TYPES as readonly string[]).includes(t)) throw new RefusedError("USAGE", `--type must be one of ${INTAKE_TYPES.join(", ")}`);
  return t as IntakeType;
}
function versionFlag(args: Args): number {
  const v = Number(required(args, "version"));
  if (!Number.isInteger(v) || v < 1) throw new RefusedError("USAGE", "--version must be a positive integer");
  return v;
}

function printFindings(findings: readonly Finding[], io: Io): void {
  for (const x of findings) io.out(`${x.level.padEnd(10)} ${x.code.padEnd(28)} ${x.path}  ${x.message}`);
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, application_name: "lintel-design-os-intake" });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function run(argv: readonly string[], io: Io, migrationsDir = DEFAULT_MIGRATIONS_DIR): Promise<number> {
  // `pnpm --filter` runs in the package directory: a relative --file is resolved from where the command was typed.
  const read = io.readFile ?? ((p: string) => readFileSync(resolve(io.env.INIT_CWD ?? process.cwd(), p), "utf8"));
  try {
    const args = parseArgs(argv);
    const json = args.flags.get("json") === true;
    switch (args.command) {
      case "validate": {
        allowFlags(args, ["file", "json"]);
        const v = validateIntake(read(required(args, "file")));
        const report = { accepted: v.accepted, fileHash: v.fileHash, type: v.file?.type ?? null, entityCode: v.file?.entityCode ?? null, versionNumber: v.file?.versionNumber ?? null, intent: v.file?.intent ?? null, findings: v.findings };
        if (json) io.out(JSON.stringify(report));
        else {
          printFindings(v.findings, io);
          io.out(`${v.accepted ? "ACCEPTED" : "REFUSED"}  ${report.type ?? "?"} ${report.entityCode ?? "?"} v${String(report.versionNumber ?? "?")} (${report.intent ?? "?"}) ${v.fileHash}`);
        }
        return v.accepted ? INTAKE_EXIT.OK : INTAKE_EXIT.INVALID;
      }
      case "import": {
        allowFlags(args, ["file", "env", "confirm", "org", "as", "operator", "dry-run", "json"]);
        const env = environmentFlag(args);
        const file = required(args, "file");
        const opts = { orgCode: required(args, "org"), authorEmail: required(args, "as"), operator: required(args, "operator"), dryRun: args.flags.get("dry-run") === true };
        const url = connectionString(io.env);
        guard(env, targetOf(url), stringFlag(args, "confirm"));
        const v = validateIntake(read(file));
        if (v.file === null || !v.accepted) {
          if (json) io.out(JSON.stringify({ outcome: "REFUSED", fileHash: v.fileHash, findings: v.findings }));
          else { printFindings(v.findings, io); io.out("outcome:   REFUSED (validation)"); }
          return INTAKE_EXIT.INVALID;
        }
        const s = await withClient(url, (c) => importIntake(c, loadMigrations(migrationsDir), v, opts));
        if (json) io.out(JSON.stringify(s));
        else {
          printFindings(s.findings, io);
          for (const [t, n] of Object.entries(s.rows)) io.out(`rows       ${t}: ${String(n)}`);
          io.out(`outcome:   ${s.outcome} ${s.type} ${s.entityCode} v${String(s.versionNumber)} ${s.versionId ?? ""} ${s.contentHash ?? ""}`);
        }
        return s.outcome === "REFUSED" ? INTAKE_EXIT.REFUSED : INTAKE_EXIT.OK;
      }
      case "status": {
        allowFlags(args, ["org", "type", "entity", "version", "json"]);
        const url = connectionString(io.env);
        const s = await withClient(url, (c) => versionState(c, required(args, "org"), typeFlag(args), required(args, "entity"), versionFlag(args)));
        if (s === null) throw new RefusedError("GUARD", "no such version");
        if (json) io.out(JSON.stringify(s));
        else {
          io.out(`${s.type} ${s.entityCode} v${String(s.versionNumber)} ${s.versionId}: ${s.status} ${s.contentHash}`);
          for (const p of s.approvalProblems) io.out(`PROBLEM    ${p.code}: ${p.message}`);
        }
        return INTAKE_EXIT.OK;
      }
      case "submit":
      case "approve": {
        allowFlags(args, ["env", "confirm", "org", "type", "entity", "version", "as", "operator", "reason", "expected-content-hash", "json"]);
        const env = environmentFlag(args);
        const opts = {
          orgCode: required(args, "org"), type: typeFlag(args), entityCode: required(args, "entity"), versionNumber: versionFlag(args),
          actorEmail: required(args, "as"), operator: required(args, "operator"), reason: required(args, "reason"),
          ...(stringFlag(args, "expected-content-hash") === undefined ? {} : { expectedContentHash: stringFlag(args, "expected-content-hash") ?? "" }),
        };
        const url = connectionString(io.env);
        guard(env, targetOf(url), stringFlag(args, "confirm"));
        const r = await withClient(url, (c) => transitionVersion(c, args.command === "submit" ? "SUBMIT" : "APPROVE", opts));
        if (json) io.out(JSON.stringify(r));
        else if (r.outcome === "DONE") io.out(`${r.action} ${opts.type} ${opts.entityCode} v${String(opts.versionNumber)}: ${r.before.status} → ${r.after.status} by ${r.actor}`);
        else {
          io.err(`refused: ${r.code}: ${r.message}`);
          for (const p of r.state?.approvalProblems ?? []) io.err(`PROBLEM    ${p.code}: ${p.message}`);
        }
        return r.outcome === "DONE" ? INTAKE_EXIT.OK : INTAKE_EXIT.REFUSED;
      }
      case undefined:
      default:
        throw new RefusedError("USAGE", "usage: db:intake <validate|import|status|submit|approve> [options]");
    }
  } catch (e) {
    if (e instanceof RefusedError) {
      io.err(`refused: ${e.message}`);
      return e.code === "USAGE" ? INTAKE_EXIT.USAGE : INTAKE_EXIT.REFUSED;
    }
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return INTAKE_EXIT.FAILED;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), { env: process.env, out: (l) => { console.log(l); }, err: (l) => { console.error(l); } });
}
