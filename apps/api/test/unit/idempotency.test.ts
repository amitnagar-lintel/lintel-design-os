/** Idempotency request binding (OD-2): the request hash is deterministic and covers every request component. */
import { describe, expect, it } from "vitest";
import type { ApiProblem } from "../../src/common/errors/api-problem.js";
import type { CanonicalRequest } from "../../src/common/idempotency/idempotency.service.js";
import { requestHash, requireIdempotencyKey } from "../../src/common/idempotency/idempotency.service.js";

const BASE: CanonicalRequest = {
  method: "POST",
  operation: "POST /api/v1/design-versions/:id/transitions",
  userId: "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40",
  orgId: "0c7f3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  params: { id: "11111111-1111-4111-8111-111111111111" },
  query: { dryRun: "false" },
  body: { action: "SUBMIT", reason: "ready", meta: { a: 1, b: [1, 2] } },
};

describe("request hash", () => {
  it("is deterministic and independent of key order", () => {
    const reordered: CanonicalRequest = { ...BASE, body: { meta: { b: [1, 2], a: 1 }, reason: "ready", action: "SUBMIT" }, userId: BASE.userId.toUpperCase(), method: "post" };
    expect(requestHash(reordered)).toBe(requestHash(BASE));
    expect(requestHash(BASE)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it.each([
    ["method", { method: "PUT" }],
    ["operation", { operation: "POST /api/v1/design-versions/:id/validation-runs" }],
    ["user", { userId: "22222222-2222-4222-8222-222222222222" }],
    ["organization", { orgId: "33333333-3333-4333-8333-333333333333" }],
    ["path params", { params: { id: "44444444-4444-4444-8444-444444444444" } }],
    ["query", { query: { dryRun: "true" } }],
    ["body", { body: { action: "SUBMIT", reason: "ready!", meta: { a: 1, b: [1, 2] } } }],
    ["array order in the body", { body: { action: "SUBMIT", reason: "ready", meta: { a: 1, b: [2, 1] } } }],
  ])("changes with the %s", (_, change) => {
    expect(requestHash({ ...BASE, ...change })).not.toBe(requestHash(BASE));
  });
});

describe("Idempotency-Key header", () => {
  const code = (h: string | string[] | undefined) => {
    try {
      requireIdempotencyKey(h);
      return "ok";
    } catch (e) {
      return (e as ApiProblem).code;
    }
  };
  it("is required (428), 16–128 visible ASCII (400)", () => {
    expect(code(undefined)).toBe("PRECONDITION_REQUIRED");
    expect(code("short")).toBe("VALIDATION_FAILED");
    expect(code("has spaces in the key!!")).toBe("VALIDATION_FAILED");
    expect(code(["a".repeat(20), "b".repeat(20)])).toBe("VALIDATION_FAILED");
    expect(code("x".repeat(129))).toBe("VALIDATION_FAILED");
    expect(code("5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40")).toBe("ok");
  });
});
