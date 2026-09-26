import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiProblem } from "../errors/api-problem.js";
import { canonicalValue } from "./etag.js";

/**
 * Keyset pagination (OD-6). Order: created_at DESC, id DESC (unique, deterministic). A cursor is
 * base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)); it is bound to the collection and the
 * organization it was issued for, so it cannot be forged, replayed on another collection or used in another org.
 * A cursor grants nothing: every page is still filtered by RLS under the current org context.
 */
export interface CursorPosition {
  /** created_at exactly as PostgreSQL returned it (normalized UTC, microseconds). */
  readonly createdAt: string;
  readonly id: string;
}
interface CursorPayload extends CursorPosition {
  readonly v: 1;
  readonly c: string;
  readonly o: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class CursorCodec {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("cursor secret must be at least 32 characters");
  }
  private mac(payload: string): Buffer {
    return createHmac("sha256", this.secret).update(payload).digest();
  }
  encode(collection: string, orgId: string, position: CursorPosition): string {
    const payload: CursorPayload = { v: 1, c: collection, o: orgId, createdAt: String(canonicalValue(position.createdAt)), id: position.id.toLowerCase() };
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(this.mac(body))}`;
  }
  decode(token: string, collection: string, orgId: string): CursorPosition {
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
    if (c === null || typeof c !== "object" || c.v !== 1 || c.c !== collection || c.o !== orgId
        || typeof c.createdAt !== "string" || !TIMESTAMP.test(c.createdAt) || typeof c.id !== "string" || !UUID.test(c.id)) throw invalid();
    return { createdAt: c.createdAt, id: c.id };
  }
}

/** SQL for one keyset page: append to a WHERE clause and bind `[...params, createdAt, id, limit + 1]`. */
export function keysetClause(firstParam: number, hasCursor: boolean): { where: string; orderLimit: string } {
  return {
    where: hasCursor ? `(created_at, id) < ($${String(firstParam)}::timestamptz, $${String(firstParam + 1)}::uuid)` : "true",
    orderLimit: `ORDER BY created_at DESC, id DESC LIMIT $${String(hasCursor ? firstParam + 2 : firstParam)}`,
  };
}

/** Turn `limit + 1` fetched rows into a page and the next cursor. */
export function toPage<R extends { readonly created_at: string; readonly id: string }, T>(
  rows: readonly R[], limit: number, next: (last: R) => string, map: (r: R) => T,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(map), nextCursor: rows.length > limit && last !== undefined ? next(last) : null };
}
