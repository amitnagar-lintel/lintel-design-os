/**
 * Which database a command acts on, and the guard that keeps a runner from being pointed at the wrong one. Pure.
 *
 * - The connection comes only from MIGRATION_DATABASE_URL: never the API's DATABASE_URL (the API's login role has no
 *   DDL rights) and never a Lintel Ops variable. It is never read from the command line (it holds a password).
 * - `--env` names the environment. `staging` and `production` additionally need `--confirm <target>`, where the target
 *   is the Supabase project ref (from the host `db.<ref>.supabase.co` or the pooler user `postgres.<ref>`) or, for any
 *   other server, `host:port/database`. A mismatch refuses before anything is written.
 * - `local` / `ci` never accept a hosted Supabase URL, and a hosted URL always needs `staging` or `production`.
 */
export const ENVIRONMENTS = ["local", "ci", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const MIGRATION_URL_VARIABLE = "MIGRATION_DATABASE_URL";

export class RefusedError extends Error {
  constructor(readonly code: "USAGE" | "GUARD", message: string) {
    super(message);
    this.name = "RefusedError";
  }
}

const SUPABASE_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/i;
const SUPABASE_POOLER_HOST = /\.pooler\.supabase\.com$/i;
const POOLER_USER = /^[a-z_]+\.([a-z0-9]+)$/i;

export interface Target {
  /** What `--confirm` must equal. */
  readonly identity: string;
  readonly hosted: boolean;
  /** A Supabase pooler endpoint (Supavisor, transaction or session mode): never used for schema changes or intake. */
  readonly pooled: boolean;
  /** For readouts: host, port and database, never the user or password. */
  readonly display: string;
}

export function targetOf(connectionString: string): Target {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new RefusedError("USAGE", `${MIGRATION_URL_VARIABLE} is not a valid URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new RefusedError("USAGE", `${MIGRATION_URL_VARIABLE} must be a postgres:// URL`);
  const host = url.hostname.toLowerCase();
  const port = url.port === "" ? "5432" : url.port;
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  const display = `${host}:${port}/${database}`;
  const direct = SUPABASE_HOST.exec(host);
  if (direct?.[1] !== undefined) return { identity: direct[1].toLowerCase(), hosted: true, pooled: port === "6543", display };
  if (SUPABASE_POOLER_HOST.test(host)) {
    const ref = POOLER_USER.exec(decodeURIComponent(url.username))?.[1];
    if (ref === undefined) throw new RefusedError("USAGE", "a Supabase pooler URL must name the project in its user (postgres.<project-ref>)");
    return { identity: ref.toLowerCase(), hosted: true, pooled: true, display };
  }
  return { identity: display, hosted: /supabase\.(co|com)$/i.test(host), pooled: false, display };
}

/**
 * Refuse unless the environment, the URL and the confirmation agree. Writes (migrations, organization initialisation,
 * intake) use a DIRECT Postgres connection only: never a Supabase pooler (transaction mode breaks session-level
 * migration semantics; the pooler belongs to the API runtime, which has its own, separate connection).
 */
export function guard(env: Environment, target: Target, confirm: string | undefined): void {
  if (target.pooled) throw new RefusedError("GUARD", "a Supabase pooler connection is never used for migrations or data intake: use the project's direct connection (db.<project-ref>.supabase.co:5432)");
  const protectedEnv = env === "staging" || env === "production";
  if (!protectedEnv && target.hosted) throw new RefusedError("GUARD", `a hosted Supabase database needs --env staging or --env production (got --env ${env})`);
  if (!protectedEnv) return;
  if (confirm === undefined) throw new RefusedError("GUARD", `--env ${env} needs --confirm ${target.identity}`);
  if (confirm.toLowerCase() !== target.identity) throw new RefusedError("GUARD", `--confirm ${confirm} does not match the target database ${target.identity}`);
}

export interface Args {
  readonly command: string | undefined;
  readonly flags: ReadonlyMap<string, string | true>;
}

/** `command --flag value --switch`. Unknown flags are refused by the caller. */
export function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string | true>();
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(a.slice(2), next);
        i++;
      } else {
        flags.set(a.slice(2), true);
      }
    } else if (command === undefined) {
      command = a;
    } else {
      throw new RefusedError("USAGE", `unexpected argument ${a}`);
    }
  }
  return { command, flags };
}

export function allowFlags(args: Args, allowed: readonly string[]): void {
  for (const k of args.flags.keys()) if (!allowed.includes(k)) throw new RefusedError("USAGE", `unknown option --${k}`);
}

export function stringFlag(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  if (v === true) throw new RefusedError("USAGE", `--${name} needs a value`);
  return v;
}

export function environmentFlag(args: Args): Environment {
  const v = stringFlag(args, "env");
  if (v === undefined) throw new RefusedError("USAGE", `--env is required (${ENVIRONMENTS.join(" | ")})`);
  if (!(ENVIRONMENTS as readonly string[]).includes(v)) throw new RefusedError("USAGE", `--env must be one of ${ENVIRONMENTS.join(", ")}`);
  return v as Environment;
}

export function connectionString(env: NodeJS.ProcessEnv): string {
  const url = env[MIGRATION_URL_VARIABLE];
  if (url === undefined || url === "") throw new RefusedError("USAGE", `${MIGRATION_URL_VARIABLE} is required`);
  return url;
}
