/**
 * The pilot commands (run from the repository root):
 *
 *   pnpm pilot:check [--org <CODE>] [--confirm <ref>] [--json]
 *       Read-only readiness of an environment: classification (LOCAL / STAGING / PRODUCTION), database, migrations,
 *       organization, required APPROVED reference data, rehearsal isolation, API /ready (+ /readiness with
 *       PILOT_ACCESS_TOKEN), UI and UI → API connectivity. Exit 0 ready, 4 not ready / refused, 64 usage.
 *       Env: PILOT_ENV (default LOCAL), MIGRATION_DATABASE_URL, PILOT_API_URL, PILOT_WEB_URL, PILOT_ACCESS_TOKEN.
 *
 *   pnpm pilot:demo [--reset] [--rehearse] [--no-web]
 *       LOCAL ONLY. A disposable PostgreSQL database `lintel_rehearsal` (on PILOT_POSTGRES_URL, a loopback admin
 *       connection), migrated; the API and the UI started against it; the rehearsal organization onboarded; the
 *       rehearsal dataset (LOCAL REHEARSAL ONLY, synthetic) loaded and approved through the intake CLI; one access token
 *       per person written to .pilot/tokens. Runs until Ctrl-C.
 *
 *   pnpm pilot:templates [--out <dir>]
 *       Writes the production intake templates (NULL = still to be provided) and their README to docs/pilot/intake-templates.
 *
 *   pnpm pilot:rehearse
 *       LOCAL ONLY. `pilot:demo --reset --rehearse --no-web`, then exits: the whole pilot workflow with the real engines;
 *       report in .pilot/rehearsal-report.json, issued PDFs in .pilot/rehearsal-pdfs.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SignJWT } from "jose";
import pg from "pg";
import { EXIT } from "../migrate-cli.js";
import { DEFAULT_MIGRATIONS_DIR, loadMigrations } from "../migrations.js";
import { up } from "../runner.js";
import { allowFlags, parseArgs, RefusedError, stringFlag } from "../target.js";
import { pilotCheck } from "./check.js";
import { classify } from "./environment.js";
import { templateReports, templatesReadme } from "./templates.js";
import { REHEARSAL_ORG } from "./rehearsal-dataset.js";
import { assertRehearsalDatabase, loadRehearsalData, onboardRehearsal, REHEARSAL_PEOPLE, rehearsalUserId, ROLES } from "./rehearsal.js";
import { fetchHttp, runPilotWorkflow } from "./workflow.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const STATE = join(ROOT, ".pilot");
const BOOTSTRAP = join(ROOT, "database", "bootstrap", "ci-supabase-stubs.sql");
const DEMO_DB = "lintel_rehearsal";
const API_LOGIN = "lintel_api_local";
const LOCAL_ISSUER = "http://127.0.0.1/local-auth/v1";

interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

interface LocalSecrets { readonly authSecret: string; readonly cursorSecret: string; readonly fileSecret: string; readonly apiLoginPassword: string }

/** Per-machine secrets of the LOCAL demo (never used anywhere else), kept in .pilot/ (git-ignored). */
function localSecrets(): LocalSecrets {
  const file = join(STATE, "local-secrets.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as LocalSecrets;
  mkdirSync(STATE, { recursive: true });
  const s: LocalSecrets = { authSecret: randomBytes(32).toString("hex"), cursorSecret: randomBytes(32).toString("hex"), fileSecret: randomBytes(32).toString("hex"), apiLoginPassword: randomBytes(16).toString("hex") };
  writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

const mintLocal = (secret: string) => (userId: string, email: string) => new SignJWT({ role: "authenticated", email, email_verified: true })
  .setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuer(LOCAL_ISSUER).setAudience("authenticated")
  .setIssuedAt().setExpirationTime("12h").sign(new TextEncoder().encode(secret));

function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (user !== undefined) { u.username = user; u.password = password ?? ""; }
  return u.toString();
}

async function waitFor(url: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).status === 200) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function demo(args: ReturnType<typeof parseArgs>, io: Io, migrationsDir: string): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...io.env, PILOT_ENV: "LOCAL" };
  const adminUrl = env.PILOT_POSTGRES_URL ?? "postgresql://postgres@127.0.0.1:5432/postgres";
  const dbUrl = withDatabase(adminUrl, DEMO_DB);
  assertRehearsalDatabase(dbUrl);
  const apiPort = Number(env.PILOT_API_PORT ?? 3000);
  const webPort = Number(env.PILOT_WEB_PORT ?? 5173);
  const apiUrl = `http://127.0.0.1:${String(apiPort)}`;
  const webUrl = `http://127.0.0.1:${String(webPort)}`;
  const s = localSecrets();
  const reset = args.flags.get("reset") === true;
  const rehearse = args.flags.get("rehearse") === true;
  const web = args.flags.get("no-web") !== true && existsSync(join(ROOT, "apps", "web", "package.json"));
  const exitAfter = args.flags.get("exit") === true;

  // 1. The disposable database, the CI stand-ins of Supabase (LOCAL only), migrations, the API's login role.
  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  try {
    if (reset) await root.query(`DROP DATABASE IF EXISTS ${DEMO_DB} WITH (FORCE)`);
    if ((await root.query("SELECT 1 FROM pg_database WHERE datname = $1", [DEMO_DB])).rowCount === 0) await root.query(`CREATE DATABASE ${DEMO_DB}`);
  } finally {
    await root.end();
  }
  const client = new pg.Client({ connectionString: dbUrl, application_name: "lintel-design-os-pilot-demo" });
  await client.connect();
  const children: ChildProcess[] = [];
  const stop = () => { for (const c of children) c.kill("SIGTERM"); };
  try {
    await client.query(readFileSync(BOOTSTRAP, "utf8"));
    const migrations = loadMigrations(migrationsDir);
    const m = await up(client, migrations);
    if (m.outcome !== "APPLIED") throw new RefusedError("GUARD", `migrations: ${m.outcome}`);
    io.out(`database   ${DEMO_DB}: migrations up to date`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${API_LOGIN}') THEN CREATE ROLE ${API_LOGIN} LOGIN NOINHERIT; END IF; END $$`);
    await client.query(`ALTER ROLE ${API_LOGIN} PASSWORD '${s.apiLoginPassword}'`);
    await client.query(`GRANT design_os_api TO ${API_LOGIN}`);

    // 2. The API against it (LOCAL settings: HS256 local auth, local file storage under .pilot/files).
    const apiEnv: NodeJS.ProcessEnv = {
      ...process.env, DATABASE_URL: withDatabase(adminUrl, DEMO_DB, API_LOGIN, s.apiLoginPassword), API_PORT: String(apiPort), AUTH_ISSUER: LOCAL_ISSUER, AUTH_JWT_SECRET: s.authSecret,
      CURSOR_SECRET: s.cursorSecret, CORS_ORIGINS: webUrl, FILE_STORAGE: "local", FILE_STORAGE_ROOT: join(STATE, "files"), FILE_URL_SECRET: s.fileSecret, FILE_URL_BASE: apiUrl,
      API_LOG: "false", RATE_LIMIT_ENABLED: "false", SENTRY_DSN: "",
    };
    delete apiEnv.SENTRY_DSN;
    const api = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { cwd: join(ROOT, "apps", "api"), env: apiEnv, stdio: ["ignore", "inherit", "inherit"] });
    children.push(api);
    if (!await waitFor(`${apiUrl}/api/v1/ready`, 90)) throw new RefusedError("GUARD", `the API did not become ready at ${apiUrl}`);
    io.out(`api        ${apiUrl} ready`);

    // 3. People (onboarded through the API) and the rehearsal dataset (through the intake CLI).
    const http = fetchHttp(apiUrl);
    const tokens = await onboardRehearsal(client, migrations, http, mintLocal(s.authSecret), io.out);
    mkdirSync(join(STATE, "tokens"), { recursive: true });
    for (const r of ROLES) writeFileSync(join(STATE, "tokens", `${r}.txt`), `${tokens[r]}\n`, { mode: 0o600 });
    const authEnv = { MIGRATION_DATABASE_URL: dbUrl, AUTH_ISSUER: LOCAL_ISSUER, AUTH_AUDIENCE: "authenticated", AUTH_JWT_SECRET: s.authSecret };
    const loaded = await loadRehearsalData({ env: authEnv, tokens, dir: join(STATE, "intake"), log: io.out });
    io.out(`data       ${String(loaded.approved)} rehearsal reference versions APPROVED (LOCAL REHEARSAL ONLY — synthetic, not Lintel data)`);

    // 4. Optional: the automated rehearsal.
    if (rehearse) {
      const report = await runPilotWorkflow(http, tokens, undefined, io.out);
      const pdfDir = join(STATE, "rehearsal-pdfs");
      mkdirSync(pdfDir, { recursive: true });
      for (const p of report.pdfs) {
        const u = await http("GET", `/api/v1/files/${p.fileId}/url?disposition=attachment`, { token: tokens.DESIGNER });
        const got = await http("GET", (u.body as { url?: string } | null)?.url ?? "");
        writeFileSync(join(pdfDir, `${p.drawingNumber}.pdf`), got.bytes);
      }
      writeFileSync(join(STATE, "rehearsal-report.json"), `${JSON.stringify(report, null, 2)}\n`);
      io.out(`rehearsal  PASSED: design version ${report.designVersionId} ${report.designStatus}; ${String(Object.keys(report.outputs).length)} outputs; quotation + ${String(report.issued.drawings.length)} drawings issued; ${String(report.pdfs.length)} PDFs verified`);
      io.out(`           report .pilot/rehearsal-report.json, PDFs .pilot/rehearsal-pdfs/`);
    }

    // 5. The UI.
    if (web) {
      const w = spawn("pnpm", ["--filter", "@lintel/web", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
        cwd: ROOT, env: { ...process.env, LINTEL_API_URL: apiUrl, VITE_APP_ENV: "local" }, stdio: ["ignore", "inherit", "inherit"],
      });
      children.push(w);
      if (!await waitFor(webUrl, 60)) throw new RefusedError("GUARD", `the UI did not start at ${webUrl}`);
      io.out(`ui         ${webUrl}`);
    }
    if (exitAfter) {
      stop();
      return EXIT.OK;
    }
    io.out("");
    io.out(`LOCAL pilot demo (organization ${REHEARSAL_ORG}; rehearsal data only). Sign in at ${webUrl} with a token file:`);
    for (const r of ROLES) io.out(`  ${r.padEnd(14)} ${REHEARSAL_PEOPLE[r].email.padEnd(30)} .pilot/tokens/${r}.txt  (user ${rehearsalUserId(r)})`);
    io.out("Ctrl-C stops the API and the UI.");
    await new Promise<void>((resolve) => { process.once("SIGINT", () => { resolve(); }); process.once("SIGTERM", () => { resolve(); }); });
    stop();
    return EXIT.OK;
  } catch (e) {
    stop();
    throw e;
  } finally {
    await client.end();
  }
}

export async function run(argv: readonly string[], io: Io, migrationsDir = DEFAULT_MIGRATIONS_DIR): Promise<number> {
  try {
    const args = parseArgs(argv);
    switch (args.command) {
      case "check": {
        allowFlags(args, ["org", "confirm", "json"]);
        const localDb = withDatabase(io.env.PILOT_POSTGRES_URL ?? "postgresql://postgres@127.0.0.1:5432/postgres", DEMO_DB);
        const env = (io.env.PILOT_ENV ?? "LOCAL").toUpperCase() === "LOCAL" && io.env.MIGRATION_DATABASE_URL === undefined ? { ...io.env, MIGRATION_DATABASE_URL: localDb } : io.env;
        const target = classify(env, stringFlag(args, "confirm"));
        const localToken = join(STATE, "tokens", "ADMIN.txt");
        const token = io.env.PILOT_ACCESS_TOKEN ?? (target.env === "LOCAL" && existsSync(localToken) ? readFileSync(localToken, "utf8").trim() : undefined);
        const orgCode = stringFlag(args, "org") ?? (target.env === "LOCAL" ? REHEARSAL_ORG : undefined);
        const checks = await pilotCheck({ target, databaseUrl: env.MIGRATION_DATABASE_URL, orgCode, accessToken: token, migrations: loadMigrations(migrationsDir) });
        const blocked = checks.filter((c) => c.level === "BLOCKING" && c.status === "FAIL");
        if (args.flags.get("json") === true) io.out(JSON.stringify({ environment: target.env, ready: blocked.length === 0, checks }));
        else {
          io.out(`ENVIRONMENT: ${target.env}`);
          for (const c of checks) io.out(`${c.status.padEnd(8)} ${c.level.padEnd(9)} ${c.id.padEnd(34)} ${c.message}`);
          io.out(blocked.length === 0 ? `READY (${target.env})` : `NOT READY (${target.env}): ${String(blocked.length)} blocking failure(s)`);
        }
        return blocked.length === 0 ? EXIT.OK : EXIT.REFUSED;
      }
      case "templates": {
        allowFlags(args, ["out"]);
        const dir = stringFlag(args, "out") ?? join(ROOT, "docs", "pilot", "intake-templates");
        const reports = templateReports();
        const bad = reports.filter((r) => !r.accepted);
        if (bad.length > 0) throw new RefusedError("GUARD", `templates refused by the validator: ${bad.map((r) => `${r.template.name} ${JSON.stringify(r.errors)}`).join("; ")}`);
        mkdirSync(dir, { recursive: true });
        for (const r of reports) writeFileSync(join(dir, r.template.name), `${JSON.stringify(r.template.file, null, 2)}\n`);
        writeFileSync(join(dir, "README.md"), templatesReadme(reports));
        io.out(`${String(reports.length)} templates, ${String(reports.reduce((n, r) => n + r.missing.length, 0))} values missing → ${dir}`);
        return EXIT.OK;
      }
      case "demo":
        allowFlags(args, ["reset", "rehearse", "no-web", "exit"]);
        return await demo(args, io, migrationsDir);
      case "rehearse":
        allowFlags(args, []);
        return await demo(parseArgs(["demo", "--reset", "--rehearse", "--no-web", "--exit"]), io, migrationsDir);
      case undefined:
      default:
        throw new RefusedError("USAGE", "usage: pilot <check|demo|rehearse|templates> [options]");
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
