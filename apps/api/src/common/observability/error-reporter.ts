/**
 * Error tracking (OD-M6-6). The API reports server errors (5xx) to an ErrorReporter. Without SENTRY_DSN the reporter is
 * a no-op, so development and tests load nothing and send nothing. What is reported is deliberately minimal: the error,
 * the request id, method, route template, status and problem code — never headers, bodies, query strings, tokens or
 * user data (see ./scrub.ts, applied again inside the Sentry adapter before anything leaves the process).
 */
export interface ErrorReport {
  readonly error: unknown;
  readonly requestId: string;
  readonly method: string;
  /** The route template (e.g. `/api/v1/projects/:projectId`), never the concrete URL. */
  readonly route: string;
  readonly status: number;
  readonly code: string;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  capture(report: ErrorReport): void;
  flush(timeoutMs: number): Promise<boolean>;
}

export const NOOP_ERROR_REPORTER: ErrorReporter = {
  enabled: false,
  capture: () => undefined,
  flush: () => Promise.resolve(true),
};
