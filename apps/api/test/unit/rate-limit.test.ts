/** The fixed-window limiter (M6 CP3): allowed up to the limit, then refused until the window ends. */
import { describe, expect, it } from "vitest";
import { FixedWindowLimiter, rateLimited } from "../../src/common/http/rate-limit.js";
import { loadConfig } from "../../src/config.js";

describe("fixed-window limiter", () => {
  it("allows `max` hits per window and key, then refuses with the seconds until the window ends", () => {
    let t = 1_000_000;
    const l = new FixedWindowLimiter(() => t);
    expect([1, 2, 3].map(() => l.hit("a", 3, 60_000).allowed)).toEqual([true, true, true]);
    const refused = l.hit("a", 3, 60_000);
    expect(refused).toEqual({ allowed: false, limit: 3, remaining: 0, retryAfterSeconds: 60 });
    expect(l.hit("b", 3, 60_000).allowed).toBe(true); // keys are independent
    t += 45_500;
    expect(l.hit("a", 3, 60_000).retryAfterSeconds).toBe(15);
    t += 14_500;
    expect(l.hit("a", 3, 60_000)).toMatchObject({ allowed: true, remaining: 2 }); // a new window
    const p = rateLimited(refused);
    expect([p.code, p.status, p.options.headers]).toEqual(["RATE_LIMITED", 429, { "retry-after": "60", "ratelimit-limit": "3", "ratelimit-remaining": "0" }]);
  });

  it("takes every limit from the environment", () => {
    const base = {
      DATABASE_URL: "postgresql://x@h/db", AUTH_ISSUER: "https://a/auth/v1", AUTH_JWT_SECRET: "s".repeat(40), CURSOR_SECRET: "c".repeat(32),
      FILE_STORAGE: "memory", FILE_URL_SECRET: "f".repeat(32), FILE_URL_BASE: "https://api.example", BUILD_REVISION: "abc1234",
    };
    expect(loadConfig(base).rateLimit).toEqual({ enabled: true, windowMs: 60_000, ip: 600, read: 600, write: 120, sensitive: 20 });
    expect(loadConfig({ ...base, RATE_LIMIT_ENABLED: "false", RATE_LIMIT_WINDOW_SECONDS: "10", RATE_LIMIT_IP_MAX: "5", RATE_LIMIT_READ_MAX: "4", RATE_LIMIT_WRITE_MAX: "3", RATE_LIMIT_SENSITIVE_MAX: "2", TRUST_PROXY_HOPS: "1" }))
      .toMatchObject({ rateLimit: { enabled: false, windowMs: 10_000, ip: 5, read: 4, write: 3, sensitive: 2 }, trustProxyHops: 1 });
    expect(() => loadConfig({ ...base, SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" })).toThrow(/SENTRY_ENVIRONMENT/);
    expect(loadConfig({ ...base, SENTRY_DSN: "https://k@o0.ingest.sentry.io/1", SENTRY_ENVIRONMENT: "staging" }).sentry).toEqual({ dsn: "https://k@o0.ingest.sentry.io/1", environment: "staging", release: "abc1234" });
    expect(loadConfig(base).sentry).toBeUndefined();
  });
});
