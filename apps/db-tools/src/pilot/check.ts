/**
 * `pilot:check` — is this environment able to run the pilot? Read-only (the database session is READ ONLY).
 *
 * BLOCKING checks fail the command (exit 4); WARNING and INFO checks are reported only. The data checks mirror the
 * API's own readiness gate (GET /api/v1/readiness, PILOT_REQUIRED_TYPES), which is also called when a token is given.
 */
import pg from "pg";
import { TABLES } from "../intake/importer.js";
import type { Migration } from "../migrations.js";
import { status } from "../runner.js";
import type { Classified } from "./environment.js";
import { REHEARSAL_MARKER, REHEARSAL_ORG } from "./rehearsal-dataset.js";

/** The reference data the pilot needs APPROVED / LOCKED (the API's PILOT_REQUIRED_TYPES; an API test guards the equality). */
export const PILOT_REQUIRED_TYPES = [
  "construction_standard", "planning_standard", "edge_band_standard", "material_catalog", "finish_catalog", "hardware_catalog", "product_catalog",
  "hettich_dataset", "pricing_standard", "quotation_policy",
] as const;

export interface Check {
  readonly id: string;
  readonly level: "BLOCKING" | "WARNING" | "INFO";
  readonly status: "PASS" | "FAIL" | "SKIPPED";
  readonly message: string;
}

export interface CheckOptions {
  readonly target: Classified;
  readonly databaseUrl: string | undefined;
  readonly orgCode: string | undefined;
  readonly accessToken: string | undefined;
  readonly migrations: readonly Migration[];
  readonly fetch?: typeof fetch;
}

async function get(f: typeof fetch, url: string, token?: string): Promise<{ status: number; text: string } | null> {
  try {
    const r = await f(url, { headers: token === undefined ? {} : { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    return { status: r.status, text: await r.text() };
  } catch {
    return null;
  }
}

export async function pilotCheck(o: CheckOptions): Promise<Check[]> {
  const out: Check[] = [];
  const add = (id: string, level: Check["level"], ok: boolean | null, message: string) => out.push({ id, level, status: ok === null ? "SKIPPED" : ok ? "PASS" : "FAIL", message });
  const f = o.fetch ?? fetch;
  const t = o.target;
  add("environment", "INFO", true, `${t.env}: database ${t.database ?? "(not configured)"}, API ${t.apiUrl}, UI ${t.webUrl}`);

  // ---- database: connection, migrations, organization, required data, rehearsal isolation
  if (o.databaseUrl === undefined || o.databaseUrl === "") {
    add("database.connect", "BLOCKING", false, "MIGRATION_DATABASE_URL is not set");
  } else {
    const client = new pg.Client({ connectionString: o.databaseUrl, application_name: "lintel-design-os-pilot-check" });
    try {
      await client.connect();
      add("database.connect", "BLOCKING", true, `connected to ${t.database ?? ""}`);
      await client.query("BEGIN READ ONLY");
      const s = await status(client, o.migrations);
      add("database.migrations", "BLOCKING", s.state === "UP_TO_DATE", `migrations ${s.state}${s.pending.length > 0 ? ` (pending: ${s.pending.map((m) => m.version).join(", ")})` : ""}`);
      if (s.state === "UP_TO_DATE") await dataChecks(client, o, add);
      await client.query("ROLLBACK");
    } catch (e) {
      add("database.connect", "BLOCKING", false, `cannot use the database: ${e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "<url>") : String(e)}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  // ---- API and UI
  const ready = await get(f, `${t.apiUrl}/api/v1/ready`);
  add("api.ready", "BLOCKING", ready?.status === 200, ready === null ? `API not reachable at ${t.apiUrl}` : `GET /api/v1/ready → ${String(ready.status)} ${ready.text.slice(0, 200)}`);
  if (o.accessToken === undefined) {
    add("api.readiness", "WARNING", null, "no PILOT_ACCESS_TOKEN (an ADMIN / DESIGN_HEAD / FINANCE access token): the API's own gate report was not read");
  } else {
    const r = await get(f, `${t.apiUrl}/api/v1/readiness`, o.accessToken);
    let st = "";
    try {
      const v = (JSON.parse(r?.text ?? "{}") as { status?: unknown }).status;
      st = typeof v === "string" ? v : "";
    } catch { /* not JSON */ }
    add("api.readiness", "BLOCKING", r?.status === 200 && st === "READY", r === null ? "API not reachable" : `GET /api/v1/readiness → ${String(r.status)} ${st}`);
  }
  const web = await get(f, t.webUrl);
  add("ui.reachable", "BLOCKING", web?.status === 200 && web.text.includes('id="root"'), web === null ? `UI not reachable at ${t.webUrl}` : `GET ${t.webUrl} → ${String(web.status)}`);
  const proxied = await get(f, `${t.webUrl}/api/v1/ready`);
  add("ui.api_connectivity", "BLOCKING", proxied?.status === 200, proxied === null ? "UI → API not reachable" : `UI ${t.webUrl}/api/v1/ready → ${String(proxied.status)}`);
  return out;
}

type Add = (id: string, level: Check["level"], ok: boolean | null, message: string) => void;

async function dataChecks(client: pg.Client, o: CheckOptions, add: Add): Promise<void> {
  const t = o.target;
  // Rehearsal data must never exist outside LOCAL.
  const orgs = (await client.query<{ code: string }>("SELECT code FROM design_os.organization WHERE code = $1", [REHEARSAL_ORG])).rows;
  const marked: string[] = [];
  for (const type of PILOT_REQUIRED_TYPES) {
    const tb = TABLES[type];
    const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM design_os.${tb.version} WHERE source LIKE '%' || $1 || '%'`, [REHEARSAL_MARKER]);
    if (Number(r.rows[0]?.n ?? 0) > 0) marked.push(type);
  }
  if (t.env === "LOCAL") add("data.rehearsal_isolation", "INFO", true, orgs.length > 0 ? `the local rehearsal organization ${REHEARSAL_ORG} exists (synthetic data, LOCAL only)` : "no rehearsal data");
  else add("data.rehearsal_isolation", "BLOCKING", orgs.length === 0 && marked.length === 0, orgs.length === 0 && marked.length === 0 ? "no rehearsal data" : `REHEARSAL data found in ${t.env}: ${[...orgs.map((x) => x.code), ...marked].join(", ")}`);

  if (o.orgCode === undefined) {
    add("data.organization", "BLOCKING", false, "no --org <CODE>: name the pilot organization");
    return;
  }
  const org = (await client.query<{ id: string; admins: string }>(`SELECT o.id, (SELECT count(*) FROM design_os.org_membership m WHERE m.org_id = o.id AND m.role = 'ADMIN' AND m.status = 'ACTIVE')::text AS admins
    FROM design_os.organization o WHERE o.code = $1 AND o.status = 'ACTIVE'`, [o.orgCode])).rows[0];
  if (org === undefined) {
    add("data.organization", "BLOCKING", false, `organization ${o.orgCode} does not exist: run db:org init`);
    return;
  }
  add("data.organization", "BLOCKING", Number(org.admins) > 0, `organization ${o.orgCode}: ${org.admins} active ADMIN(s)`);
  if (o.orgCode === REHEARSAL_ORG && t.env !== "LOCAL") add("data.organization.rehearsal", "BLOCKING", false, `${REHEARSAL_ORG} is the LOCAL rehearsal organization`);
  for (const type of PILOT_REQUIRED_TYPES) {
    const tb = TABLES[type];
    const r = await client.query<{ code: string; version_number: number; status: string }>(
      `SELECT e.code, v.version_number, v.status::text AS status FROM design_os.${tb.version} v JOIN design_os.${tb.entity} e ON e.id = v.entity_id
       WHERE v.org_id = $1 ORDER BY e.code, v.version_number DESC`, [org.id]);
    const usable = r.rows.filter((x) => x.status === "APPROVED" || x.status === "LOCKED");
    const other = r.rows.filter((x) => x.status !== "APPROVED" && x.status !== "LOCKED" && x.status !== "SUPERSEDED" && x.status !== "RETIRED");
    add(`data.${type}`, "BLOCKING", usable.length > 0, usable.length > 0
      ? usable.map((x) => `${x.code} v${String(x.version_number)} ${x.status}`).join(", ")
      : r.rows.length === 0 ? "no version: import it (docs/pilot/intake-templates)" : `no APPROVED / LOCKED version (${other.map((x) => `${x.code} v${String(x.version_number)} ${x.status}`).join(", ")})`);
  }
}
