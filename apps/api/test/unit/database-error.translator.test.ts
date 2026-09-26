/** Database errors are mapped by SQLSTATE (and schema) only — never by message text — and never leak raw details. */
import pg from "pg";
import { describe, expect, it } from "vitest";
import { ApiProblem } from "../../src/common/errors/api-problem.js";
import type { DatabaseErrorFields } from "../../src/common/errors/database-error.translator.js";
import { isDatabaseError, translateDatabaseError } from "../../src/common/errors/database-error.translator.js";
import { DATABASE_ERROR_CODES, INTERNAL_DATABASE_SQLSTATES, PROBLEM_CODES } from "../../src/common/errors/problem-codes.js";
import { toProblem } from "../../src/common/errors/problem.filter.js";

function dbError(code: string, message: string, extra: { detail?: string; schema?: string } = {}): pg.DatabaseError & DatabaseErrorFields {
  const e = new pg.DatabaseError(message, message.length, "error");
  return Object.assign(e, { code, severity: "ERROR", ...extra });
}

describe("LD codes (design_os.error_code)", () => {
  it("every API-facing LD code maps to a registered problem code with its status", () => {
    const codes = Object.entries(DATABASE_ERROR_CODES);
    expect(codes).toHaveLength(27);
    for (const [sqlstate, code] of codes) {
      const p = translateDatabaseError(dbError(sqlstate, "anything"));
      expect([sqlstate, p.code, p.status]).toEqual([sqlstate, code, PROBLEM_CODES[code].status]);
    }
  });
  it("internal integrity guards (LD9xx) are never explained", () => {
    for (const s of INTERNAL_DATABASE_SQLSTATES) expect(translateDatabaseError(dbError(s, "design_os.audit_log: TRUNCATE is not allowed")).code).toBe("INTERNAL_DATABASE_ERROR");
  });
  it("only allow-listed DETAIL keys reach the problem context; malformed DETAIL is ignored", () => {
    const p = translateDatabaseError(dbError("LD006", "x", { detail: JSON.stringify({ status: "DRAFT", secret: "org 123 of tenant B", sql: "SELECT" }) }));
    expect(p.options.context).toEqual({ status: "DRAFT" });
    expect(translateDatabaseError(dbError("LD006", "x", { detail: "not json" })).options.context).toBeUndefined();
    // 0015: the product catalog guard names the product versions a re-pin would orphan.
    const ref = translateDatabaseError(dbError("LD019", "x", { detail: JSON.stringify({ productVersionIds: ["5d1c0b8e-0000-4000-8000-000000000001"], orgId: "tenant" }) }));
    expect([ref.code, ref.options.context]).toEqual(["INVALID_REFERENCE", { productVersionIds: ["5d1c0b8e-0000-4000-8000-000000000001"] }]);
    expect(translateDatabaseError(dbError("LD005", "x", { detail: JSON.stringify({ status: "LOCKED" }) })).options.context).toBeUndefined();
  });
});

describe("built-in SQLSTATEs", () => {
  it.each([
    ["42501", "design_os", "PERMISSION_DENIED"],
    ["23503", "design_os", "INVALID_REFERENCE"],
    ["23505", "design_os", "DUPLICATE_RESOURCE"],
    ["23514", "design_os", "VALIDATION_FAILED"],
    ["23502", "design_os", "VALIDATION_FAILED"],
    ["23505", "auth", "INTERNAL_DATABASE_ERROR"],
    ["40001", "design_os", "CONCURRENT_MODIFICATION"],
    ["40P01", "design_os", "CONCURRENT_MODIFICATION"],
    ["55P03", "design_os", "CONCURRENT_MODIFICATION"],
    ["08006", "design_os", "DATABASE_UNAVAILABLE"],
    ["57P01", "design_os", "DATABASE_UNAVAILABLE"],
    ["22012", "design_os", "INTERNAL_DATABASE_ERROR"],
    ["P0001", "design_os", "INTERNAL_DATABASE_ERROR"],
    ["XX000", "design_os", "INTERNAL_DATABASE_ERROR"],
  ])("%s (%s) → %s", (code, schema, expected) => {
    expect(translateDatabaseError(dbError(code, "irrelevant", { schema })).code).toBe(expected);
  });
  it("a message that LOOKS like a known domain error but has a generic SQLSTATE is INTERNAL (messages are never parsed)", () => {
    expect(translateDatabaseError(dbError("P0001", "transition: the submitter cannot review their own submission")).code).toBe("INTERNAL_DATABASE_ERROR");
    expect(translateDatabaseError(dbError("23514", "claim_idempotency: the idempotency key was already used", { schema: "design_os" })).code).toBe("VALIDATION_FAILED");
  });
  it("the problem never carries the database message, SQL, constraint or table", () => {
    const e = dbError("LD005", "transition: design 8f0e… not found", { detail: "{}" });
    Object.assign(e, { constraint: "design_version_pkey", table: "design_version" });
    const p = toProblem(e);
    expect(p.detail).toBeUndefined();
    expect(JSON.stringify({ code: p.code, detail: p.detail, options: p.options })).not.toMatch(/transition|design_version|8f0e/);
  });
});

describe("toProblem", () => {
  it("passes ApiProblems through, recognises database errors, and hides everything else", () => {
    const own = new ApiProblem("STALE_VERSION");
    expect(toProblem(own)).toBe(own);
    expect(isDatabaseError(dbError("LD001", "x"))).toBe(true);
    expect(isDatabaseError(new Error("x"))).toBe(false);
    expect(toProblem(new TypeError("cannot read x of undefined")).code).toBe("INTERNAL");
    expect(toProblem("thrown string").code).toBe("INTERNAL");
  });
});
