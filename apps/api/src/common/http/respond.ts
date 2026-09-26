import type { FastifyReply } from "fastify";
import type { StoredResponse } from "../idempotency/idempotency.service.js";
import { send } from "./request.js";

/** Apply a stored/replayed result's status and headers to the reply; the controller returns the body. */
export function respond(reply: FastifyReply, result: { readonly response: StoredResponse; readonly replayed: boolean }): unknown {
  return send(reply, result.response, result.replayed);
}
