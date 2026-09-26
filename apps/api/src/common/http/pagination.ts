import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiProblem } from "../errors/api-problem.js";
import { canonicalValue } from "./etag.js";

/**
 * Keyset pagination (OD-6). Every collection has one deterministic, unique order: (sort key, id). A cursor is
 * base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)); it is bound to the collection, its sort and the
 * organization it was issued for, so it cannot be forged, replayed on another collection or used in another org.
 * A cursor grants nothing: every page is still filtered by RLS under the current org context.
 */
export interface SortSpec {
  /** Column of the sort key (trusted, from code — never from a request). */
  readonly column: string;
  readonly type: "timestamptz" | "bigint" | "text";
  readonly direction: "ASC" | "DESC";
}

export const SORTS = {
  newestFirst: { column: "created_at", type: "timestamptz", direction: "DESC" },
  versionNumberDesc: { column: "version_number", type: "bigint", direction: "DESC" },
  revisionNumberDesc: { column: "revision_number", type: "bigint", direction: "DESC" },
  objectCodeAsc: { column: "object_code", type: "text", direction: "ASC" },
  codeAsc: { column: "code", type: "text", direction: "ASC" },
  positionAsc: { column: "position", type: "bigint", direction: "ASC" },
  sequenceDesc: { column: "seq", type: "bigint", direction: "DESC" },
} as const satisfies Record<string, SortSpec>;

export interface CursorPosition {
  /** The sort key of the last row, as text (timestamps normalized UTC with microseconds). */
  readonly key: string;
  readonly id: string;
}
interface CursorPayload extends CursorPosition {
  readonly v: 2;
  readonly c: string;
  readonly o: string;
  readonly s: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const INTEGER = /^-?\d{1,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sortId = (s: SortSpec) => `${s.column}:${s.direction}`;

function normalizeKey(sort: SortSpec, key: unknown): string {
  return sort.type === "timestamptz" ? String(canonicalValue(key)) : String(key);
}

function validKey(sort: SortSpec, key: string): boolean {
  if (sort.type === "timestamptz") return TIMESTAMP.test(key);
  if (sort.type === "bigint") return INTEGER.test(key);
  return key.length <= 256;
}

export class CursorCodec {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("cursor secret must be at least 32 characters");
  }
  private mac(payload: string): Buffer {
    return createHmac("sha256", this.secret).update(payload).digest();
  }
  encode(collection: string, orgId: string, sort: SortSpec, position: { readonly key: unknown; readonly id: string }): string {
    const payload: CursorPayload = { v: 2, c: collection, o: orgId, s: sortId(sort), key: normalizeKey(sort, position.key), id: position.id.toLowerCase() };
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(this.mac(body))}`;
  }
  decode(token: string, collection: string, orgId: string, sort: SortSpec): CursorPosition {
    const invalid = () => new ApiProblem("INVALID_CURSOR");
    const [body, sig, extra] = token.split(".");
    if (body === undefined || sig === undefined || extra !== undefined || body === "" || sig === "") throw invalid();
    const expected = this.mac(body);
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
    let p: unknown;
    try {
      p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      throw invalid();
    }
    const c = p as Partial<CursorPayload> | null;
    if (c === null || typeof c !== "object" || c.v !== 2 || c.c !== collection || c.o !== orgId || c.s !== sortId(sort)
        || typeof c.key !== "string" || !validKey(sort, c.key) || typeof c.id !== "string" || !UUID.test(c.id)) throw invalid();
    return { key: c.key, id: c.id };
  }
}

/**
 * SQL for one keyset page. Append `where` to the WHERE clause, then `orderLimit`; bind `[key, id]` at `firstParam`
 * (only when there is a cursor) and `limit + 1` after them. Text keys compare in code-point order (COLLATE "C"), so
 * the order never depends on the database collation.
 */
export function keysetClause(sort: SortSpec, firstParam: number, hasCursor: boolean, alias = ""): { where: string; orderLimit: string } {
  const col = `${alias === "" ? "" : `${alias}.`}${sort.column}`;
  const id = `${alias === "" ? "" : `${alias}.`}id`;
  const key = sort.type === "text" ? `${col} COLLATE "C"` : col;
  const param = (n: number) => `$${String(n)}`;
  const cast = sort.type === "text" ? `${param(firstParam)}::text COLLATE "C"` : `${param(firstParam)}::${sort.type}`;
  const op = sort.direction === "DESC" ? "<" : ">";
  return {
    where: hasCursor ? `(${key}, ${id}) ${op} (${cast}, ${param(firstParam + 1)}::uuid)` : "true",
    orderLimit: `ORDER BY ${key} ${sort.direction}, ${id} ${sort.direction} LIMIT ${param(hasCursor ? firstParam + 2 : firstParam)}`,
  };
}

/** Turn `limit + 1` fetched rows into a page and the next cursor. */
export function toPage<R, T>(rows: readonly R[], limit: number, next: (last: R) => string, map: (r: R) => T): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(map), nextCursor: rows.length > limit && last !== undefined ? next(last) : null };
}
