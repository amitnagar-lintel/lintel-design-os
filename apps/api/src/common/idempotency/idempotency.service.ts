import { Injectable } from "@nestjs/common";
import type { Sha256 } from "@lintel/persistence";
import { contentHash } from "@lintel/persistence";
import type { RequestScope } from "../auth/context.js";
import type { Tx } from "../db/tx.js";
import { ApiProblem } from "../errors/api-problem.js";
import { IdempotencyKey } from "../http/schemas.js";

/** The operations that take an Idempotency-Key. Equal to the database CHECK (a database test asserts parity). */
export const IDEMPOTENCY_SCOPES = [
  "transition",
  "validation_run.record",
  "snapshot.bom.generate",
  "snapshot.boq.generate",
  "snapshot.pricing.generate",
  "snapshot.quotation.generate",
  "snapshot.drawing.generate",
  "snapshot.manufacturing_document.generate",
  "quotation.issue",
  "drawing.issue",
  "manufacturing.release",
  "file.upload",
  "client_contact.invite",
  "room.create",
  "room_revision.create",
  "design.create",
  "design_version.create",
  "relationship_override.create",
] as const;
export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[number];

/** The original result of an operation, as it is stored and replayed. */
export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: { readonly etag?: string; readonly location?: string };
  /** Durable reference used when the body is too large to store (the replay re-reads the immutable resource). */
  readonly resource?: { readonly type: string; readonly id: string };
}

/** Everything that makes two requests "the same request" (the request hash). */
export interface CanonicalRequest {
  readonly method: string;
  /** The normalized operation: route template, e.g. "POST /api/v1/design-versions/:id/transitions". */
  readonly operation: string;
  readonly userId: string;
  readonly orgId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

/** Deterministic: canonical JSON (sorted keys) → SHA-256. Key order in params, query or body never matters. */
export function requestHash(r: CanonicalRequest): Sha256 {
  return contentHash({ method: r.method.toUpperCase(), operation: r.operation, userId: r.userId.toLowerCase(), orgId: r.orgId.toLowerCase(), params: r.params, query: r.query, body: r.body ?? null });
}

/** Read the Idempotency-Key header of an operation that requires one. */
export function requireIdempotencyKey(header: string | string[] | undefined): string {
  if (header === undefined) throw new ApiProblem("PRECONDITION_REQUIRED", "Idempotency-Key is required for this operation");
  const parsed = IdempotencyKey.safeParse(header);
  if (!parsed.success) throw new ApiProblem("VALIDATION_FAILED", undefined, { errors: [{ path: "headers.idempotency-key", code: "invalid", message: "must be 16-128 visible ASCII characters" }] });
  return parsed.data;
}

const MAX_STORED_BODY = 60 * 1024;

interface ClaimRow extends Record<string, unknown> {
  outcome: "EXECUTE" | "REPLAY";
  record_id: string;
  response_status: number | null;
  response_body: { body: unknown; headers?: StoredResponse["headers"] } | null;
  resource_type: string | null;
  resource_id: string | null;
}

/**
 * Execute an operation at most once per (org, scope, key), inside the caller's unit of work (OD-2):
 *  - first request → EXECUTE: run it, store the result, commit together with its effect;
 *  - same key + same request hash → REPLAY the original result (the operation does not run);
 *  - same key + different request hash → 409 IDEMPOTENCY_CONFLICT (LD022);
 *  - duplicate while the original still runs → waits, then replays/executes, or 409 IDEMPOTENCY_IN_PROGRESS (LD023).
 * Failures are not stored (the claim rolls back with the failed effect).
 */
@Injectable()
export class IdempotencyService {
  async run(
    tx: Tx,
    claim: { readonly scope: IdempotencyScope; readonly key: string; readonly requestHash: Sha256 },
    execute: () => Promise<StoredResponse>,
    rehydrate?: (resource: { readonly type: string; readonly id: string }) => Promise<unknown>,
  ): Promise<{ readonly response: StoredResponse; readonly replayed: boolean }> {
    const c = await tx.one<ClaimRow>("SELECT * FROM design_os.claim_idempotency($1, $2, $3)", [claim.scope, claim.key, claim.requestHash]);
    if (c.outcome === "REPLAY") {
      const resource = c.resource_type !== null && c.resource_id !== null ? { type: c.resource_type, id: c.resource_id } : undefined;
      if (c.response_body !== null) {
        return { replayed: true, response: { status: c.response_status ?? 200, body: c.response_body.body, ...(c.response_body.headers === undefined ? {} : { headers: c.response_body.headers }), ...(resource === undefined ? {} : { resource }) } };
      }
      if (resource === undefined || rehydrate === undefined) throw new ApiProblem("INTERNAL", "stored idempotent result cannot be replayed");
      return { replayed: true, response: { status: c.response_status ?? 200, body: await rehydrate(resource), resource } };
    }
    const response = await execute();
    if (response.status < 200 || response.status > 299) throw new Error("only successful results are stored");
    const envelope = { body: response.body ?? null, ...(response.headers === undefined ? {} : { headers: response.headers }) };
    const serialized = JSON.stringify(envelope);
    const store = Buffer.byteLength(serialized) <= MAX_STORED_BODY ? serialized : null;
    if (store === null && response.resource === undefined) throw new Error("large results need a durable resource reference");
    await tx.query("SELECT design_os.complete_idempotency($1, $2::smallint, $3::jsonb, $4, $5)", [c.record_id, response.status, store, response.resource?.type ?? null, response.resource?.id ?? null]);
    return { replayed: false, response };
  }

  /** `run` for an HTTP request: the request hash binds method, route, user, org, path and query parameters and body. */
  forRequest(
    tx: Tx,
    scope: RequestScope,
    idempotencyScope: IdempotencyScope,
    req: { readonly key: string; readonly method: string; readonly operation: string; readonly params: Readonly<Record<string, string>>; readonly query: Readonly<Record<string, unknown>> },
    body: unknown,
    execute: () => Promise<StoredResponse>,
  ): Promise<{ readonly response: StoredResponse; readonly replayed: boolean }> {
    const hash = requestHash({ method: req.method, operation: req.operation, userId: scope.principal.userId, orgId: scope.org.orgId, params: req.params, query: req.query, body });
    return this.run(tx, { scope: idempotencyScope, key: req.key, requestHash: hash }, execute);
  }
}
