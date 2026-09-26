/** Test-only Supabase-style access tokens (HS256 with a test secret), verified by the intake's verifierFromEnv. */
import { SignJWT } from "jose";

export const TEST_AUTH_ENV = {
  AUTH_ISSUER: "https://auth.intake-test.local/auth/v1",
  AUTH_AUDIENCE: "authenticated",
  AUTH_JWT_SECRET: "intake-test-jwt-secret-0123456789abcdef",
} as const;

export function testToken(userId: string, o: { readonly role?: string; readonly issuer?: string; readonly expiresIn?: string; readonly secret?: string } = {}): Promise<string> {
  return new SignJWT({ role: o.role ?? "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(o.issuer ?? TEST_AUTH_ENV.AUTH_ISSUER)
    .setAudience(TEST_AUTH_ENV.AUTH_AUDIENCE)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
    .setExpirationTime(o.expiresIn ?? "5m")
    .sign(new TextEncoder().encode(o.secret ?? TEST_AUTH_ENV.AUTH_JWT_SECRET));
}
