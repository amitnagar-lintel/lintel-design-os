/**
 * Error tracking (M6 CP3, OD-M6-6): the scrubber, and the real Sentry SDK with an in-memory transport (nothing leaves
 * the process). Events carry environment, release and the minimal tags — never request, user, tokens or secrets.
 */
import { describe, expect, it } from "vitest";
import { NOOP_ERROR_REPORTER } from "../../src/common/observability/error-reporter.js";
import { scrubEvent, scrubText } from "../../src/common/observability/scrub.js";
import type { SentryTransport } from "../../src/infrastructure/observability/sentry.js";
import { createSentryReporter } from "../../src/infrastructure/observability/sentry.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("scrubbing", () => {
  it("redacts credentials, tokens, keys, connection strings and personal data from text", () => {
    const s = scrubText(`Bearer ${JWT} ${JWT} sb_secret_abc123 sb_publishable_xyz postgresql://postgres:hunter2@db.x.supabase.co:5432/postgres password=hunter2 token: abc asha@lintel.example +91 98765 43210`);
    for (const leak of ["hunter2", JWT, "sb_secret_abc123", "sb_publishable_xyz", "asha@lintel.example", "98765", "token: abc"]) expect(s).not.toContain(leak);
    expect(s).toContain("postgresql://[redacted]@db.x.supabase.co");
  });

  it("drops request, user, breadcrumbs, extra, server name, unknown contexts and tags, and stack-frame variables", () => {
    const e = scrubEvent({
      message: "failed for asha@lintel.example", request: { headers: { authorization: `Bearer ${JWT}` } }, user: { id: "u", email: "a@b.c" }, breadcrumbs: [{}], extra: { body: {} },
      server_name: "host-1", contexts: { runtime: { name: "node" }, response: { status_code: 500 } }, tags: { requestId: "r1", token: "abc" },
      exception: { values: [{ value: `Bearer ${JWT}`, stacktrace: { frames: [{ vars: { password: "x" } }] } }] },
    });
    expect(e).toEqual({
      message: "failed for [redacted-email]", contexts: { runtime: { name: "node" } }, tags: { requestId: "r1" },
      exception: { values: [{ value: "Bearer [redacted]", stacktrace: { frames: [{}] } }] },
    });
  });
});

describe("Sentry adapter", () => {
  it("is not loaded without SENTRY_DSN (the no-op reporter)", async () => {
    expect(NOOP_ERROR_REPORTER.enabled).toBe(false);
    NOOP_ERROR_REPORTER.capture({ error: new Error("x"), requestId: "r", method: "GET", route: "/", status: 500, code: "INTERNAL" });
    expect(await NOOP_ERROR_REPORTER.flush(10)).toBe(true);
  });

  it("sends a scrubbed error event with environment, release and the minimal tags only", async () => {
    const sent: unknown[] = [];
    const transport: SentryTransport = () => ({
      send: (envelope) => { sent.push(envelope); return Promise.resolve({}); },
      flush: () => Promise.resolve(true),
    });
    const reporter = await createSentryReporter({ dsn: "https://publickey@o0.ingest.sentry.io/0", environment: "staging", release: "abc1234" }, transport);
    expect(reporter.enabled).toBe(true);
    reporter.capture({
      error: new Error(`db failed for asha@lintel.example with Bearer ${JWT} at postgres://u:hunter2@h/db`),
      requestId: "3f9a8e1c-0000-4000-8000-000000000001", method: "POST", route: "/api/v1/projects/:projectId", status: 500, code: "INTERNAL",
    });
    expect(await reporter.flush(2000)).toBe(true);
    expect(sent).toHaveLength(1);
    const text = JSON.stringify(sent[0]);
    for (const leak of ["asha@lintel.example", JWT, "hunter2"]) expect(text).not.toContain(leak);
    const items = (sent[0] as [unknown, [[{ type: string }, Record<string, unknown>]]])[1];
    const event = items.find(([h]) => h.type === "event")![1];
    expect(event).toMatchObject({ environment: "staging", release: "abc1234", tags: { requestId: "3f9a8e1c-0000-4000-8000-000000000001", route: "/api/v1/projects/:projectId", method: "POST", status: "500", code: "INTERNAL" } });
    expect(event.request).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
  });
});
