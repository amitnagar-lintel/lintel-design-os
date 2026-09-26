/**
 * The API problem codes (RFC 9457 `code` extension). Clients branch on `code`, never on `title` or `detail`.
 * The database-originated codes (SQLSTATE class LD) equal design_os.error_code; a database test asserts parity.
 */
export const PROBLEM_CODES = {
  VALIDATION_FAILED: { status: 400, title: "The request is invalid" },
  INVALID_CURSOR: { status: 400, title: "The pagination cursor is invalid" },
  ORG_SELECTION_REQUIRED: { status: 400, title: "Select an organization with X-Org" },
  AUTH_REQUIRED: { status: 401, title: "Authentication is required" },
  ORG_ACCESS_DENIED: { status: 403, title: "No access to this organization" },
  IDENTITY_KIND_MISMATCH: { status: 403, title: "This route is not available to this kind of identity" },
  PERMISSION_DENIED: { status: 403, title: "Permission denied" },
  SIGNED_URL_INVALID: { status: 403, title: "The signed file URL is invalid or has expired" },
  SEPARATION_OF_DUTIES: { status: 403, title: "The submitter cannot review or approve their own submission" },
  NOT_FOUND: { status: 404, title: "Not found" },
  METHOD_NOT_ALLOWED: { status: 405, title: "Method not allowed" },
  LIFECYCLE_TRANSITION_REJECTED: { status: 409, title: "The lifecycle transition is not allowed" },
  CONTENT_HASH_MISMATCH: { status: 409, title: "The reviewed content changed" },
  DEPENDENCY_NOT_APPROVED: { status: 409, title: "A dependency is not approved" },
  APPROVAL_PRECONDITIONS_FAILED: { status: 409, title: "Approval preconditions failed" },
  VALIDATION_RUN_REQUIRED: { status: 409, title: "An engine validation run for the current inputs is required" },
  VALIDATION_BLOCKERS: { status: 409, title: "The engine validation has BLOCKERs" },
  VALIDATION_INPUT_MISMATCH: { status: 409, title: "The validation run does not match the current inputs" },
  RECORD_NOT_EDITABLE: { status: 409, title: "The record is not editable in its lifecycle state" },
  RECORD_LOCKED: { status: 409, title: "The record is locked" },
  RECORD_IMMUTABLE: { status: 409, title: "The record is immutable" },
  PROVENANCE_MISMATCH: { status: 409, title: "The output provenance does not match the design version" },
  ISSUE_PRECONDITIONS_FAILED: { status: 409, title: "Issue preconditions failed" },
  ALREADY_ISSUED: { status: 409, title: "Already issued; issues are immutable" },
  PRODUCTION_GUARD_FAILED: { status: 409, title: "Production output requires an approved or locked design version" },
  OUTPUT_PURPOSE_NOT_ALLOWED: { status: 409, title: "The output purpose is not allowed here" },
  SOURCE_SNAPSHOT_INCOMPATIBLE: { status: 409, title: "An upstream output is for other inputs or versions" },
  COMMERCIAL_VERSION_NOT_FOUND: { status: 422, title: "The chosen PricingStandard / QuotationPolicy version does not exist in this organization" },
  SOURCE_PURPOSE_INSUFFICIENT: { status: 409, title: "An upstream output has a weaker purpose" },
  MEMBERSHIP_RULE_VIOLATION: { status: 409, title: "Membership rules violated" },
  DUPLICATE_RESOURCE: { status: 409, title: "The resource already exists" },
  IDEMPOTENCY_CONFLICT: { status: 409, title: "The idempotency key was used for a different request" },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, title: "A request with this idempotency key is still in progress" },
  CONCURRENT_MODIFICATION: { status: 409, title: "A concurrent modification interfered; retry" },
  FILE_REFERENCED: { status: 409, title: "The file is referenced and cannot be deleted" },
  INVITATION_INVALID: { status: 410, title: "The invitation is not valid" },
  STALE_VERSION: { status: 412, title: "The resource changed since you read it" },
  PAYLOAD_TOO_LARGE: { status: 413, title: "The request body is too large" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: "Unsupported media type" },
  INVALID_REFERENCE: { status: 422, title: "A referenced resource does not exist" },
  DRAWING_REFUSED: { status: 422, title: "The drawing engine refused the drawing" },
  CHECKSUM_MISMATCH: { status: 422, title: "The content does not match its checksum" },
  PRECONDITION_REQUIRED: { status: 428, title: "A precondition header is required" },
  INTERNAL_DATABASE_ERROR: { status: 500, title: "Internal error" },
  INTERNAL: { status: 500, title: "Internal error" },
  STORED_OUTPUT_INVALID: { status: 500, title: "A stored output failed its schema or integrity checks" },
  DATABASE_UNAVAILABLE: { status: 503, title: "The service is temporarily unavailable" },
} as const satisfies Record<string, { readonly status: number; readonly title: string }>;

export type ProblemCode = keyof typeof PROBLEM_CODES;

/** SQLSTATE class LD → API code (mirrors design_os.error_code; LD9xx are internal guards). */
export const DATABASE_ERROR_CODES: Readonly<Record<string, ProblemCode>> = {
  LD001: "PERMISSION_DENIED",
  LD002: "ORG_ACCESS_DENIED",
  LD003: "IDENTITY_KIND_MISMATCH",
  LD004: "SEPARATION_OF_DUTIES",
  LD005: "NOT_FOUND",
  LD006: "LIFECYCLE_TRANSITION_REJECTED",
  LD007: "CONTENT_HASH_MISMATCH",
  LD008: "DEPENDENCY_NOT_APPROVED",
  LD009: "APPROVAL_PRECONDITIONS_FAILED",
  LD010: "VALIDATION_RUN_REQUIRED",
  LD011: "VALIDATION_BLOCKERS",
  LD012: "VALIDATION_INPUT_MISMATCH",
  LD013: "RECORD_NOT_EDITABLE",
  LD014: "RECORD_LOCKED",
  LD015: "RECORD_IMMUTABLE",
  LD016: "PROVENANCE_MISMATCH",
  LD017: "ISSUE_PRECONDITIONS_FAILED",
  LD018: "MEMBERSHIP_RULE_VIOLATION",
  LD019: "INVALID_REFERENCE",
  LD020: "VALIDATION_FAILED",
  LD021: "PRODUCTION_GUARD_FAILED",
  LD022: "IDEMPOTENCY_CONFLICT",
  LD023: "IDEMPOTENCY_IN_PROGRESS",
  LD024: "OUTPUT_PURPOSE_NOT_ALLOWED",
  LD025: "SOURCE_SNAPSHOT_INCOMPATIBLE",
  LD026: "SOURCE_PURPOSE_INSUFFICIENT",
  LD027: "ALREADY_ISSUED",
};

/** Internal integrity guards: never explained to API callers. */
export const INTERNAL_DATABASE_SQLSTATES: readonly string[] = ["LD901", "LD902", "LD903", "LD904", "LD905", "LD906"];

/** RFC 9457 `type`: a stable URN per code (dereferenceable documentation is not required). */
export function problemType(code: ProblemCode): string {
  return `urn:lintel-design-os:problem:${code.toLowerCase().replaceAll("_", "-")}`;
}
