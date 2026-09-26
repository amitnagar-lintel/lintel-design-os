import { contentHash } from "@lintel/persistence";
import { ApiProblem } from "../errors/api-problem.js";

/**
 * ETags and If-Match (M5 Step 4 §4.1, OD-3). ETags are STRONG: RFC 9110 requires strong comparison for If-Match,
 * and a weak tag never matches, so version tags are "<id>:<row_version>" and record tags "sha256:<hex>".
 */

/** Versioned rows (and a DesignVersion, whose whole draft shares its row_version). */
export function versionEtag(id: string, rowVersion: number): string {
  if (!Number.isInteger(rowVersion) || rowVersion < 1) throw new Error("row_version must be a positive integer");
  return `"${id.toLowerCase()}:${String(rowVersion)}"`;
}

/**
 * Mutable non-versioned rows use a hash of an explicit, ordered allow-list of columns: adding a column never
 * silently changes existing ETags, and nothing depends on the order of keys in a pg row or JS object.
 */
export const CANONICAL_COLUMNS = {
  client: ["id", "org_id", "client_code", "name", "contact", "ops_client_ref", "ops_lead_ref", "created_at"],
  client_contact: ["id", "org_id", "client_id", "email", "display_name", "user_id", "status", "invited_by", "invited_at"],
  project: ["id", "org_id", "client_id", "project_code", "name", "site_address", "status", "currency", "unit_system", "ops_project_ref", "created_at"],
  project_member: ["org_id", "project_id", "user_id", "role", "client_contact_id", "granted_by", "granted_at"],
  org_membership: ["org_id", "user_id", "role", "status", "granted_by", "granted_at"],
  design: ["id", "org_id", "project_id", "room_id", "name", "status", "created_at"],
  room: ["id", "org_id", "project_id", "name", "room_type", "created_at"],
} as const;
export type CanonicalTable = keyof typeof CANONICAL_COLUMNS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Normalize one column value: uuids lowercase, timestamps UTC with microseconds, integers as strings. */
export function canonicalValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) throw new Error("timestamps must be read as text (the API pool never parses them into Date)");
  if (typeof v === "string") {
    if (UUID.test(v)) return v.toLowerCase();
    const m = PG_TIMESTAMP.exec(v);
    if (m !== null) {
      const [, date, time, frac, zone] = m;
      if (zone !== "Z" && zone !== "+00" && zone !== "+00:00" && zone !== "+0000") throw new Error("timestamps must be read in UTC");
      return `${date ?? ""}T${time ?? ""}.${(frac ?? "").padEnd(6, "0")}Z`;
    }
    return v;
  }
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return v;
}

export function canonicalRecord(table: CanonicalTable, row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const r = row as Readonly<Record<string, unknown>>;
  for (const c of CANONICAL_COLUMNS[table]) {
    if (!(c in r)) throw new Error(`canonical ${table} row is missing column ${c}`);
    out[c] = canonicalValue(r[c]);
  }
  return out;
}

export function recordEtag(table: CanonicalTable, row: object): string {
  return `"${contentHash(canonicalRecord(table, row))}"`;
}

/** Parse If-Match: "*" or a list of strong entity tags. Weak tags are ignored (they never match strongly). */
export function parseIfMatch(header: string | undefined): "*" | string[] | null {
  if (header === undefined || header.trim() === "") return null;
  if (header.trim() === "*") return "*";
  return (header.match(/(W\/)?"[^"]*"/g) ?? []).filter((t) => !t.startsWith("W/"));
}

export type LifecycleState = "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED" | "SUPERSEDED";

/**
 * Preconditions for a write to an existing resource, in this order:
 *  1. lifecycle — LOCKED / non-DRAFT content never changes, whatever the ETag (RECORD_LOCKED / RECORD_NOT_EDITABLE);
 *  2. If-Match present (428 PRECONDITION_REQUIRED);
 *  3. If-Match matches the current ETag (412 STALE_VERSION, with the current ETag).
 */
export function assertWritable(input: { readonly ifMatch: string | undefined; readonly currentEtag: string; readonly lifecycle?: LifecycleState }): void {
  if (input.lifecycle === "LOCKED") throw new ApiProblem("RECORD_LOCKED", undefined, { context: { status: input.lifecycle } });
  if (input.lifecycle !== undefined && input.lifecycle !== "DRAFT") throw new ApiProblem("RECORD_NOT_EDITABLE", undefined, { context: { status: input.lifecycle } });
  const tags = parseIfMatch(input.ifMatch);
  if (tags === null) throw new ApiProblem("PRECONDITION_REQUIRED", "If-Match is required for this write");
  if (tags !== "*" && !tags.includes(input.currentEtag)) {
    throw new ApiProblem("STALE_VERSION", undefined, { context: { currentEtag: input.currentEtag }, headers: { etag: input.currentEtag } });
  }
}
