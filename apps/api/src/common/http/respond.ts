import type { FastifyReply } from "fastify";
import type { StoredResponse } from "../idempotency/idempotency.service.js";

/** Apply a stored/replayed result's status and headers to the reply; the controller returns the body. */
export function respond(reply: FastifyReply, result: { readonly response: StoredResponse; readonly replayed: boolean }): unknown {
  void reply.status(result.response.status);
  if (result.response.headers?.etag !== undefined) void reply.header("etag", result.response.headers.etag);
  if (result.response.headers?.location !== undefined) void reply.header("location", result.response.headers.location);
  if (result.replayed) void reply.header("idempotent-replayed", "true");
  return result.response.body;
}
