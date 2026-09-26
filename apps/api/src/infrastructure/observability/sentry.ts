/**
 * The Sentry adapter (OD-M6-6), loaded only when SENTRY_DSN is configured. Error events only: no tracing, no
 * breadcrumbs, no default integrations (nothing instruments requests, the console or the database), no PII.
 * Every event passes through scrubEvent before it is sent.
 */
import type { NodeOptions } from "@sentry/node";
import type { ErrorReport, ErrorReporter } from "../../common/observability/error-reporter.js";
import { scrubEvent } from "../../common/observability/scrub.js";

export interface SentryConfig {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string;
}

/** Tests only: a Sentry transport factory (so nothing leaves the process). */
export type SentryTransport = NonNullable<NodeOptions["transport"]>;

export async function createSentryReporter(config: SentryConfig, transport?: SentryTransport): Promise<ErrorReporter> {
  const Sentry = await import("@sentry/node");
  const client = Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // Collect nothing about users, requests, databases or stack-frame variables (Sentry v11 data-collection controls).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false, queues: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false } },
    defaultIntegrations: false,
    integrations: [],
    tracesSampleRate: 0,
    enableOpenTelemetrySetup: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
    ...(transport === undefined ? {} : { transport }),
  });
  return {
    enabled: true,
    capture(r: ErrorReport): void {
      Sentry.captureException(r.error, { tags: { requestId: r.requestId, route: r.route, method: r.method, status: String(r.status), code: r.code } });
    },
    flush: async (timeoutMs) => (client === undefined ? true : await client.flush(timeoutMs)),
  };
}
