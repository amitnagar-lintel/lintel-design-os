import type { ProblemCode } from "./problem-codes.js";
import { DATABASE_ERROR_CODES } from "./problem-codes.js";
import { ApiProblem } from "./api-problem.js";

/** The structured fields of a PostgreSQL error the translator may read. The message is deliberately absent. */
export interface DatabaseErrorFields {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly schema?: string | undefined;
}

/** Context keys each code may expose from the database's JSON DETAIL (everything else is dropped). */
const DETAIL_KEYS: Partial<Readonly<Record<ProblemCode, readonly string[]>>> = {
  LIFECYCLE_TRANSITION_REJECTED: ["status", "effectiveVersion"],
  DEPENDENCY_NOT_APPROVED: ["problems", "status"],
  APPROVAL_PRECONDITIONS_FAILED: ["problems"],
  VALIDATION_RUN_REQUIRED: ["problems"],
  VALIDATION_BLOCKERS: ["problems", "blockerCount"],
  VALIDATION_INPUT_MISMATCH: ["status"],
  RECORD_NOT_EDITABLE: ["status"],
  RECORD_LOCKED: ["status"],
  RECORD_IMMUTABLE: ["status"],
  PROVENANCE_MISMATCH: ["problems", "purpose", "blockerCount"],
  ISSUE_PRECONDITIONS_FAILED: ["status", "blockerCount", "purpose"],
  PRODUCTION_GUARD_FAILED: ["problems", "purpose", "blockerCount"],
  OUTPUT_PURPOSE_NOT_ALLOWED: ["problems", "purpose", "blockerCount"],
  INVALID_REFERENCE: ["productVersionIds"],
};

export function isDatabaseError(e: unknown): e is DatabaseErrorFields {
  return e instanceof Error && "code" in e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && "severity" in e;
}

function context(code: ProblemCode, detail: string | undefined): Readonly<Record<string, unknown>> | undefined {
  const keys = DETAIL_KEYS[code];
  if (keys === undefined || detail === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in parsed) out[k] = (parsed as Record<string, unknown>)[k];
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Map a PostgreSQL error to an API problem by SQLSTATE (and schema) only — never by message text.
 * Expected domain errors carry a registered LD code; unexpected errors become INTERNAL_DATABASE_ERROR.
 */
export function translateDatabaseError(e: DatabaseErrorFields): ApiProblem {
  const ld = DATABASE_ERROR_CODES[e.code];
  if (ld !== undefined) {
    const ctx = context(ld, e.detail);
    return new ApiProblem(ld, undefined, ctx === undefined ? {} : { context: ctx });
  }
  const own = e.schema === "design_os";
  switch (e.code) {
    case "42501":
      return new ApiProblem("PERMISSION_DENIED");
    case "23503":
      return own ? new ApiProblem("INVALID_REFERENCE") : new ApiProblem("INTERNAL_DATABASE_ERROR");
    case "23505":
      return own ? new ApiProblem("DUPLICATE_RESOURCE") : new ApiProblem("INTERNAL_DATABASE_ERROR");
    case "23514":
    case "23502":
      return own ? new ApiProblem("VALIDATION_FAILED") : new ApiProblem("INTERNAL_DATABASE_ERROR");
    case "40001":
    case "40P01":
    case "55P03":
      return new ApiProblem("CONCURRENT_MODIFICATION");
    case "57P01":
    case "57P02":
    case "57P03":
      return new ApiProblem("DATABASE_UNAVAILABLE");
    default:
      return e.code.startsWith("08") ? new ApiProblem("DATABASE_UNAVAILABLE") : new ApiProblem("INTERNAL_DATABASE_ERROR");
  }
}
