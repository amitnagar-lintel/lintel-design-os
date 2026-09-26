import type { ProblemCode } from "./problem-codes.js";
import { PROBLEM_CODES } from "./problem-codes.js";

export interface FieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** An expected, client-facing failure. Everything in it is safe to return; anything else becomes INTERNAL. */
export class ApiProblem extends Error {
  readonly status: number;
  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly options: { readonly context?: Readonly<Record<string, unknown>>; readonly errors?: readonly FieldError[]; readonly headers?: Readonly<Record<string, string>> } = {},
  ) {
    super(detail ?? PROBLEM_CODES[code].title);
    this.name = "ApiProblem";
    this.status = PROBLEM_CODES[code].status;
  }
}

/** The RFC 9457 body (application/problem+json). */
export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance: string;
  readonly code: ProblemCode;
  readonly requestId: string;
  readonly errors?: readonly FieldError[];
  readonly context?: Readonly<Record<string, unknown>>;
}
