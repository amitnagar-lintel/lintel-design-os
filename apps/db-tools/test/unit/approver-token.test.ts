/** The approver's authenticated identity (M6 G2 hardening): verified exactly like the API verifies access tokens. */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidTokenError, verifierFromEnv } from "../../src/intake/approver-token.js";
import { RefusedError } from "../../src/target.js";
import { TEST_AUTH_ENV, testToken } from "../support/tokens.js";

describe("approver access token", () => {
  it("refuses to verify anything without the Supabase Auth settings", () => {
    expect(() => verifierFromEnv({})).toThrow(RefusedError);
    expect(() => verifierFromEnv({ AUTH_ISSUER: TEST_AUTH_ENV.AUTH_ISSUER })).toThrow(/exactly one of AUTH_JWKS_URL/);
    expect(() => verifierFromEnv({ ...TEST_AUTH_ENV, AUTH_JWKS_URL: "https://x.example/jwks" })).toThrow(/exactly one of/);
    expect(() => verifierFromEnv({ ...TEST_AUTH_ENV, AUTH_JWT_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("returns the token's own user id; anything forged, expired, foreign or not `authenticated` is refused", async () => {
    const verify = verifierFromEnv(TEST_AUTH_ENV);
    const id = randomUUID();
    expect(await verify(await testToken(id.toUpperCase()))).toEqual({ userId: id });
    for (const bad of [
      await testToken(id, { secret: "another-secret-0123456789abcdefghijkl" }),
      await testToken(id, { expiresIn: "-1m" }),
      await testToken(id, { issuer: "https://elsewhere.example/auth/v1" }),
      await testToken(id, { role: "service_role" }),
      await testToken(id, { role: "anon" }),
      await testToken("not-a-uuid"),
      "not a token",
      "",
    ]) await expect(verify(bad)).rejects.toThrow(InvalidTokenError);
  });
});
