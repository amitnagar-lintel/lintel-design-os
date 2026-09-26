/**
 * `pnpm -s db:org init --env <local|ci|staging|production> [--confirm <target>] --code <CODE> --name <name>
 *   --admin-email <email> --admin-name <name> --operator <who> [--json]`
 *
 * Creates an organization and the PENDING invitation of its first ADMIN (see org-init.ts). The person then signs in
 * through Supabase Auth with that email and accepts in the API (`POST /api/v1/me/invitations/{id}/accept`).
 * Exit 0 done / nothing to do, 4 refused, 64 usage, 1 error. Connection: MIGRATION_DATABASE_URL only.
 */
import { pathToFileURL } from "node:url";
import pg from "pg";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations } from "./migrations.js";
import { EXIT } from "./migrate-cli.js";
import { orgInit } from "./org-init.js";
import { allowFlags, connectionString, environmentFlag, guard, parseArgs, RefusedError, stringFlag, targetOf } from "./target.js";

interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function required(args: ReturnType<typeof parseArgs>, name: string): string {
  const v = stringFlag(args, name);
  if (v === undefined || v.trim() === "") throw new RefusedError("USAGE", `--${name} is required`);
  return v;
}

export async function run(argv: readonly string[], io: Io, migrationsDir = DEFAULT_MIGRATIONS_DIR): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.command !== "init") throw new RefusedError("USAGE", "usage: db:org init --env <env> --code <CODE> --name <name> --admin-email <email> --admin-name <name> --operator <who>");
    allowFlags(args, ["env", "confirm", "code", "name", "admin-email", "admin-name", "operator", "json"]);
    const env = environmentFlag(args);
    const input = { code: required(args, "code"), name: required(args, "name"), adminEmail: required(args, "admin-email"), adminName: required(args, "admin-name") };
    const operator = required(args, "operator");
    const url = connectionString(io.env);
    const target = targetOf(url);
    guard(env, target, stringFlag(args, "confirm"));
    const client = new pg.Client({ connectionString: url, application_name: "lintel-design-os-org-init" });
    await client.connect();
    try {
      const r = await orgInit(client, loadMigrations(migrationsDir), input, operator);
      if (args.flags.get("json") === true) io.out(JSON.stringify({ target: target.display, ...r }));
      else if (r.outcome === "REFUSED") io.err(`refused: ${r.reason}`);
      else io.out(`${r.outcome}: organization ${input.code} (${r.orgId})${r.invitationId === null ? "" : `, ADMIN invitation ${r.invitationId} for ${input.adminEmail.toLowerCase()}`}`);
      return r.outcome === "REFUSED" ? EXIT.REFUSED : EXIT.OK;
    } finally {
      await client.end();
    }
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
