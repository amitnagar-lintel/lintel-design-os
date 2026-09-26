/** Authentication: Supabase-style access tokens are verified strictly; every failure is the same 401. */
import { generateKeyPair, SignJWT } from "jose";
import type { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { JwtVerifier } from "../../src/common/auth/jwt.js";
import type { ApiConfig } from "../../src/config.js";
import type { ApiProblem } from "../../src/common/errors/api-problem.js";

const ISSUER = "https://auth.test.local/auth/v1";
const SUB = "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40";
let keys: { privateKey: webcrypto.CryptoKey; publicKey: webcrypto.CryptoKey };
let other: { privateKey: webcrypto.CryptoKey };
let verifier: JwtVerifier;

function config(key: ApiConfig["auth"]["key"]): ApiConfig {
  return { databaseUrl: "postgresql://unused", dbPoolMax: 1, port: 0, auth: { issuer: ISSUER, audience: "authenticated", key }, cursorSecret: "x".repeat(32), corsOrigins: [], logger: false, buildRevision: "0000000", files: { provider: "memory", signingSecret: "test-file-url-secret-0123456789abcdef", publicBaseUrl: "http://api.test.local" } };
}

async function token(claims: Record<string, unknown> = {}, opts: { key?: webcrypto.CryptoKey | Uint8Array; alg?: string; exp?: string | number; iss?: string; aud?: string } = {}): Promise<string> {
  return new SignJWT({ role: "authenticated", email: "user@example.test", email_verified: true, ...claims })
    .setProtectedHeader({ alg: opts.alg ?? "ES256" })
    .setSubject(typeof claims.sub === "string" ? claims.sub : SUB)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? keys.privateKey);
}

async function reject(header: string | undefined, v = verifier): Promise<string> {
  try {
    await v.verify(header);
    return "accepted";
  } catch (e) {
    return (e as ApiProblem).code;
  }
}

beforeAll(async () => {
  keys = await generateKeyPair("ES256");
  other = await generateKeyPair("ES256");
  verifier = new JwtVerifier(config({ kind: "key", key: keys.publicKey }));
});

describe("access tokens", () => {
  it("a valid token yields the principal", async () => {
    expect(await verifier.verify(`Bearer ${await token()}`)).toEqual({ userId: SUB, email: "user@example.test", emailVerified: true });
  });
  it("missing / malformed Authorization headers are 401", async () => {
    expect(await reject(undefined)).toBe("AUTH_REQUIRED");
    expect(await reject("Basic abc")).toBe("AUTH_REQUIRED");
    expect(await reject("Bearer")).toBe("AUTH_REQUIRED");
    expect(await reject(`bearer ${await token()}`)).toBe("AUTH_REQUIRED");
  });
  it("wrong signature, issuer, audience or an expired token are 401", async () => {
    expect(await reject(`Bearer ${await token({}, { key: other.privateKey })}`)).toBe("AUTH_REQUIRED");
    expect(await reject(`Bearer ${await token({}, { iss: "https://evil.example" })}`)).toBe("AUTH_REQUIRED");
    expect(await reject(`Bearer ${await token({}, { aud: "service_role" })}`)).toBe("AUTH_REQUIRED");
    expect(await reject(`Bearer ${await token({}, { exp: Math.floor(Date.now() / 1000) - 60 })}`)).toBe("AUTH_REQUIRED");
  });
  it("anon / service-role tokens and non-UUID subjects are 401", async () => {
    expect(await reject(`Bearer ${await token({ role: "service_role" })}`)).toBe("AUTH_REQUIRED");
    expect(await reject(`Bearer ${await token({ role: "anon" })}`)).toBe("AUTH_REQUIRED");
    expect(await reject(`Bearer ${await token({ sub: "admin" })}`)).toBe("AUTH_REQUIRED");
  });
  it("unsigned (alg none) and HS256 tokens are refused by an asymmetric verifier", async () => {
    const [h, p] = (await token()).split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p ?? ""}.`;
    expect(await reject(`Bearer ${none}`)).toBe("AUTH_REQUIRED");
    expect(h).toBeDefined();
    const secret = new TextEncoder().encode("s".repeat(40));
    expect(await reject(`Bearer ${await token({}, { key: secret, alg: "HS256" })}`)).toBe("AUTH_REQUIRED");
  });
  it("HS256 (Supabase shared secret) mode verifies HS256 only", async () => {
    const secret = new TextEncoder().encode("s".repeat(40));
    const hs = new JwtVerifier(config({ kind: "secret", secret }));
    expect((await hs.verify(`Bearer ${await token({}, { key: secret, alg: "HS256" })}`)).userId).toBe(SUB);
    expect(await reject(`Bearer ${await token()}`, hs)).toBe("AUTH_REQUIRED");
  });
});
