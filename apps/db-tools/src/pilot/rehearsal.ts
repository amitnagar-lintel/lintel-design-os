/**
 * LOCAL technical rehearsal (M6 STEP 6): a disposable local database, one rehearsal organization, one person per role
 * (onboarded through the API exactly like real users), the rehearsal dataset loaded through the REAL intake CLI
 * (import → submit by the author → approve by a different, authenticated approver), then the pilot workflow.
 *
 * Never production, never staging: `assertRehearsalDatabase` refuses anything but a loopback PostgreSQL database named
 * `lintel_rehearsal*`, and the loader refuses any organization other than REHEARSAL_ORG.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import type { TokenVerifier } from "../intake/approver-token.js";
import { run as intake } from "../intake/intake-cli.js";
import { stableUuid } from "../intake/importer.js";
import type { Migration } from "../migrations.js";
import { orgInit } from "../org-init.js";
import { RefusedError } from "../target.js";
import { REHEARSAL_MARKER, REHEARSAL_ORG, rehearsalDataset } from "./rehearsal-dataset.js";
import type { Http, PilotRole } from "./workflow.js";
import { WorkflowError } from "./workflow.js";

export const REHEARSAL_DB = /^lintel_rehearsal[a-z0-9_]*$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Refuses every database that is not a loopback `lintel_rehearsal*` database. */
export function assertRehearsalDatabase(url: string): { readonly host: string; readonly database: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RefusedError("USAGE", "the rehearsal database URL is not a valid URL");
  }
  const host = u.hostname.toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!LOOPBACK.has(host)) throw new RefusedError("GUARD", `the rehearsal runs only on a loopback database (got host ${host}); never staging or production`);
  if (!REHEARSAL_DB.test(database)) throw new RefusedError("GUARD", `the rehearsal database must be named lintel_rehearsal* (got ${database})`);
  return { host, database };
}

/** One person per role (approval separation needs different people). Local identities only. */
export const REHEARSAL_PEOPLE: Readonly<Record<PilotRole, { readonly email: string; readonly name: string }>> = {
  ADMIN: { email: "admin@rehearsal.local", name: "Rehearsal Admin" },
  SALES: { email: "sales@rehearsal.local", name: "Rehearsal Sales" },
  SITE_ENGINEER: { email: "site@rehearsal.local", name: "Rehearsal Site Engineer" },
  DESIGNER: { email: "designer@rehearsal.local", name: "Rehearsal Designer" },
  DESIGN_HEAD: { email: "design-head@rehearsal.local", name: "Rehearsal Design Head" },
  COSTING: { email: "costing@rehearsal.local", name: "Rehearsal Costing" },
  FINANCE: { email: "finance@rehearsal.local", name: "Rehearsal Finance" },
  PRODUCTION: { email: "production@rehearsal.local", name: "Rehearsal Production" },
  PROCUREMENT: { email: "procurement@rehearsal.local", name: "Rehearsal Procurement" },
};
export const ROLES = Object.keys(REHEARSAL_PEOPLE) as PilotRole[];
export const rehearsalUserId = (role: PilotRole) => stableUuid("lintel-local-rehearsal", REHEARSAL_PEOPLE[role].email);

/** Mints a local access token for a user (the local API's AUTH_JWT_SECRET); never used against a hosted project. */
export type Mint = (userId: string, email: string) => Promise<string>;

/** Organization + one ADMIN (org init), then every other person invited by the ADMIN and accepted through the API. */
export async function onboardRehearsal(client: pg.ClientBase, migrations: readonly Migration[], http: Http, mint: Mint, log: (l: string) => void = () => undefined): Promise<Record<PilotRole, string>> {
  const tokens = {} as Record<PilotRole, string>;
  for (const r of ROLES) {
    tokens[r] = await mint(rehearsalUserId(r), REHEARSAL_PEOPLE[r].email);
    // The local stand-in of Supabase Auth's sign-up (auth.users exists locally only through the CI stubs).
    await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [rehearsalUserId(r), REHEARSAL_PEOPLE[r].email]);
  }
  const init = await orgInit(client, migrations, { code: REHEARSAL_ORG, name: `Local rehearsal (${REHEARSAL_MARKER})`, adminEmail: REHEARSAL_PEOPLE.ADMIN.email, adminName: REHEARSAL_PEOPLE.ADMIN.name }, "pilot-rehearsal");
  if (init.outcome === "REFUSED") throw new WorkflowError("org init", init.reason);
  const accept = async (role: PilotRole) => {
    const mine = await http("GET", "/api/v1/me/invitations", { token: tokens[role] });
    if (mine.status !== 200) throw new WorkflowError(`invitations of ${role}`, `HTTP ${String(mine.status)} ${JSON.stringify(mine.body)}`, mine.body);
    const items = ((mine.body as { items?: { id: string }[] } | null)?.items) ?? [];
    for (const i of items) {
      const r = await http("POST", `/api/v1/me/invitations/${i.id}/accept`, { token: tokens[role] });
      if (r.status !== 200 && r.status !== 201) throw new WorkflowError(`accept ${role}`, `HTTP ${String(r.status)}`, r.body);
    }
  };
  if (init.outcome !== "ALREADY_INITIALISED") await accept("ADMIN");
  const members = await http("GET", "/api/v1/org/members?limit=100", { token: tokens.ADMIN });
  const existing = new Set((((members.body as { items?: { email: string }[] } | null)?.items) ?? []).map((m) => m.email.toLowerCase()));
  for (const role of ROLES.filter((r) => r !== "ADMIN")) {
    const p = REHEARSAL_PEOPLE[role];
    if (existing.has(p.email)) continue;
    const inv = await http("POST", "/api/v1/org/invitations", { token: tokens.ADMIN, body: { email: p.email, displayName: p.name, roles: [role] } });
    if (inv.status !== 201) throw new WorkflowError(`invite ${role}`, `HTTP ${String(inv.status)} ${JSON.stringify(inv.body)}`, inv.body);
    await accept(role);
    log(`ok  onboarded ${role} (${p.email})`);
  }
  return tokens;
}

export interface LoadOptions {
  /** Environment for the intake CLI: MIGRATION_DATABASE_URL and the AUTH_* verification settings. */
  readonly env: NodeJS.ProcessEnv;
  readonly tokens: Readonly<Record<PilotRole, string>>;
  /** Where the intake files are written (kept for inspection). */
  readonly dir: string;
  /** Tests only. */
  readonly verifier?: TokenVerifier;
  readonly log?: (l: string) => void;
}

/** Every rehearsal intake file through the real CLI: import (author) → submit (author) → approve (authenticated approver). */
export async function loadRehearsalData(o: LoadOptions): Promise<{ readonly approved: number }> {
  const log = o.log ?? (() => undefined);
  mkdirSync(o.dir, { recursive: true });
  const cli = async (argv: string[], env: NodeJS.ProcessEnv = o.env): Promise<Record<string, unknown>> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await intake([...argv, "--json"], { env, out: (l) => out.push(l), err: (l) => err.push(l), ...(o.verifier === undefined ? {} : { verifier: o.verifier }) });
    const last = out.at(-1);
    const parsed = last === undefined ? {} : JSON.parse(last) as Record<string, unknown>;
    if (code !== 0) throw new WorkflowError(`intake ${argv[0] ?? ""}`, `exit ${String(code)}: ${err.join(" ")} ${JSON.stringify(parsed)}`, parsed);
    return parsed;
  };
  let approved = 0;
  for (const [i, f] of rehearsalDataset().entries()) {
    const file = join(o.dir, `${String(i + 1).padStart(2, "0")}-${f.type}-${f.entityCode}.json`);
    writeFileSync(file, `${JSON.stringify(f.file, null, 2)}\n`);
    const common = ["--env", "local", "--org", REHEARSAL_ORG, "--operator", "pilot-rehearsal"];
    const id = ["--type", f.type, "--entity", f.entityCode, "--version", "1"];
    const state = await cli(["status", "--org", REHEARSAL_ORG, ...id]).catch(() => null);
    if (state?.status === "APPROVED" || state?.status === "LOCKED") { approved++; continue; }
    if (state === null) await cli(["import", "--file", file, ...common, "--as", personOf(f.author)]);
    const now = await cli(["status", "--org", REHEARSAL_ORG, ...id]);
    if (now.status === "DRAFT") await cli(["submit", ...common, ...id, "--as", personOf(f.author), "--reason", `${REHEARSAL_MARKER}: submit`]);
    const reviewed = await cli(["status", "--org", REHEARSAL_ORG, ...id]);
    await cli(["approve", ...common, ...id, "--reason", `${REHEARSAL_MARKER}: approve`, "--expected-content-hash", String(reviewed.contentHash)], { ...o.env, APPROVER_ACCESS_TOKEN: o.tokens[f.approver] });
    approved++;
    log(`ok  ${f.type} ${f.entityCode}: APPROVED (${f.author} → ${f.approver})`);
  }
  return { approved };
}

const personOf = (role: PilotRole) => REHEARSAL_PEOPLE[role].email;
