import type { FastifyReply, FastifyRequest } from "fastify";
import type { StoredResponse } from "../idempotency/idempotency.service.js";
import { requireIdempotencyKey } from "../idempotency/idempotency.service.js";

/** What an idempotent operation is bound to, taken from the HTTP request (the service adds user and org). */
export interface IdempotentRequest {
  readonly key: string;
  readonly method: string;
  readonly operation: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
}

export function idempotentRequest(req: FastifyRequest): IdempotentRequest {
  return {
    key: requireIdempotencyKey(req.headers["idempotency-key"]),
    method: req.method,
    operation: `${req.method} ${req.routeOptions.url ?? ""}`,
    params: (req.params ?? {}) as Readonly<Record<string, string>>,
    query: (req.query ?? {}) as Readonly<Record<string, unknown>>,
  };
}

/** Send an application-service result: status, ETag / Location headers, body. */
export function send(reply: FastifyReply, result: StoredResponse, replayed = false): unknown {
  void reply.status(result.status);
  if (result.headers?.etag !== undefined) void reply.header("etag", result.headers.etag);
  if (result.headers?.location !== undefined) void reply.header("location", result.headers.location);
  if (replayed) void reply.header("idempotent-replayed", "true");
  return result.body;
}

export function ifMatch(req: FastifyRequest): string | undefined {
  const h = req.headers["if-match"];
  return Array.isArray(h) ? h.join(", ") : h;
}
