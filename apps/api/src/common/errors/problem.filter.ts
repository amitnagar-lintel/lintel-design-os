import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProblemBody } from "./api-problem.js";
import { ApiProblem } from "./api-problem.js";
import type { ProblemCode } from "./problem-codes.js";
import { PROBLEM_CODES, problemType } from "./problem-codes.js";
import { isDatabaseError, translateDatabaseError } from "./database-error.translator.js";

/** HTTP-level failures raised by the framework itself (unknown route, body parsing, size limits). */
function fromStatus(status: number): ProblemCode {
  switch (status) {
    case 400: return "VALIDATION_FAILED";
    case 401: return "AUTH_REQUIRED";
    case 403: return "PERMISSION_DENIED";
    case 404: return "NOT_FOUND";
    case 405: return "METHOD_NOT_ALLOWED";
    case 413: return "PAYLOAD_TOO_LARGE";
    case 415: return "UNSUPPORTED_MEDIA_TYPE";
    default: return "INTERNAL";
  }
}

export function toProblem(e: unknown): ApiProblem {
  if (e instanceof ApiProblem) return e;
  if (isDatabaseError(e)) return translateDatabaseError(e);
  if (e instanceof HttpException) return new ApiProblem(fromStatus(e.getStatus()));
  if (e instanceof Error && "statusCode" in e && typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) return new ApiProblem(fromStatus(e.statusCode));
  return new ApiProblem("INTERNAL");
}

/**
 * Every error leaves the API as RFC 9457 application/problem+json. Expected problems carry only their own safe
 * fields; database and unexpected errors are logged in full server-side (under the request id) and never leaked.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = toProblem(exception);
    if (problem.status >= 500 || !(exception instanceof ApiProblem)) {
      req.log.error({ err: exception, requestId: req.id, code: problem.code }, "request failed");
    }
    const body: ProblemBody = {
      type: problemType(problem.code),
      title: PROBLEM_CODES[problem.code].title,
      status: problem.status,
      ...(problem.detail === undefined ? {} : { detail: problem.detail }),
      instance: req.url.split("?")[0] ?? req.url,
      code: problem.code,
      requestId: req.id,
      ...(problem.options.errors === undefined ? {} : { errors: problem.options.errors }),
      ...(problem.options.context === undefined ? {} : { context: problem.options.context }),
    };
    for (const [k, v] of Object.entries(problem.options.headers ?? {})) void reply.header(k, v);
    if (problem.code === "AUTH_REQUIRED") void reply.header("www-authenticate", 'Bearer realm="lintel-design-os"');
    void reply.status(problem.status).header("content-type", "application/problem+json; charset=utf-8").send(body);
  }
}
