/** Cursor pagination (OD-6): signed, bound to collection and org, deterministic keyset order, max 200. */
import { describe, expect, it } from "vitest";
import type { ApiProblem } from "../../src/common/errors/api-problem.js";
import { CursorCodec, keysetClause, toPage } from "../../src/common/http/pagination.js";
import { PageQuery } from "../../src/common/http/schemas.js";

const codec = new CursorCodec("test-cursor-secret-0123456789abcdef");
const ORG = "0c7f3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const POS = { createdAt: "2026-09-26 10:00:00.123456+00", id: "5B1B0E0C-8B5E-4E1F-9C1A-2B7C0D2E3F40" };

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as ApiProblem).code;
  }
}

describe("cursor format", () => {
  it("round-trips: <base64url JSON>.<base64url HMAC-SHA256>, position normalized", () => {
    const token = codec.encode("clients", ORG, POS);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const [body] = token.split(".");
    expect(JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8"))).toEqual({ v: 1, c: "clients", o: ORG, createdAt: "2026-09-26T10:00:00.123456Z", id: "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40" });
    expect(codec.decode(token, "clients", ORG)).toEqual({ createdAt: "2026-09-26T10:00:00.123456Z", id: "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40" });
  });
  it("is deterministic", () => {
    expect(codec.encode("clients", ORG, POS)).toBe(codec.encode("clients", ORG, POS));
  });
  it("tampered, truncated, foreign-key-signed, other-collection and other-org cursors are INVALID_CURSOR", () => {
    const token = codec.encode("clients", ORG, POS);
    const [body, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ v: 1, c: "clients", o: ORG, createdAt: "2030-01-01T00:00:00.000000Z", id: POS.id.toLowerCase() })).toString("base64url");
    expect(code(() => codec.decode(`${forged}.${sig}`, "clients", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => codec.decode(`${body}.${sig.slice(1)}`, "clients", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => codec.decode(body, "clients", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => codec.decode(`${token}.x`, "clients", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => codec.decode("garbage", "clients", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => new CursorCodec("another-secret-0123456789abcdef01").decode(token, "clients", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => codec.decode(token, "projects", ORG))).toBe("INVALID_CURSOR");
    expect(code(() => codec.decode(token, "clients", "11111111-1111-4111-8111-111111111111"))).toBe("INVALID_CURSOR");
  });
});

describe("keyset SQL and pages", () => {
  it("orders by (created_at, id) DESC and fetches limit + 1", () => {
    expect(keysetClause(2, false)).toEqual({ where: "true", orderLimit: "ORDER BY created_at DESC, id DESC LIMIT $2" });
    expect(keysetClause(2, true)).toEqual({ where: "(created_at, id) < ($2::timestamptz, $3::uuid)", orderLimit: "ORDER BY created_at DESC, id DESC LIMIT $4" });
  });
  it("returns a next cursor only when more rows exist", () => {
    const rows = [1, 2, 3].map((n) => ({ created_at: `2026-09-26T10:00:0${String(n)}.000000Z`, id: `00000000-0000-4000-8000-00000000000${String(n)}` }));
    expect(toPage(rows, 2, (r) => r.id, (r) => r.id)).toEqual({ items: [rows[0]?.id, rows[1]?.id], nextCursor: rows[1]?.id });
    expect(toPage(rows, 3, (r) => r.id, (r) => r.id).nextCursor).toBeNull();
  });
  it("PageQuery: default 50, 1..200, strict", () => {
    expect(PageQuery.parse({})).toEqual({ limit: 50 });
    expect(PageQuery.parse({ limit: "200" }).limit).toBe(200);
    expect(PageQuery.safeParse({ limit: "201" }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: "2.5" }).success).toBe(false);
    expect(PageQuery.safeParse({ offset: "10" }).success).toBe(false);
  });
});
