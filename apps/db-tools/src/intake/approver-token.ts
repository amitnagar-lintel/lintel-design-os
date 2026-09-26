/**
 * The authenticated identity of a production approver (M6 G2 hardening). An APPROVE never trusts an email named by
 * the operator: the approver presents their own Supabase Auth access token, verified exactly as the API verifies it
 * (same settings: AUTH_ISSUER, AUTH_AUDIENCE and one of AUTH_JWKS_URL / AUTH_JWT_SECRET; signature, issuer,
 * audience, expiry, `role = authenticated`, a UUID `sub`). The approval then runs as that `sub`.
 */
import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { RefusedError } from "../target.js";

export interface AuthenticatedUser {
  readonly userId: string;
}

/** Verifies an access token and returns the authenticated user, or throws. */
export type TokenVerifier = (token: string) => Promise<AuthenticatedUser>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_\-.]+$/;

export class InvalidTokenError extends Error {
  constructor() {
    super("the approver access token is not a valid Supabase Auth access token for this project");
    this.name = "InvalidTokenError";
  }
}

/** The verifier configured by the same environment variables as the API. Refuses when they are not set. */
export function verifierFromEnv(env: NodeJS.ProcessEnv): TokenVerifier {
  const issuer = env.AUTH_ISSUER;
  const audience = env.AUTH_AUDIENCE ?? "authenticated";
  const jwks = env.AUTH_JWKS_URL;
  const secret = env.AUTH_JWT_SECRET;
  if (issuer === undefined || issuer === "" || (jwks === undefined) === (secret === undefined)) {
    throw new RefusedError("GUARD", "approval needs the Supabase Auth verification settings: AUTH_ISSUER and exactly one of AUTH_JWKS_URL / AUTH_JWT_SECRET");
  }
  if (secret !== undefined && secret.length < 32) throw new RefusedError("GUARD", "AUTH_JWT_SECRET must be at least 32 characters");
  const key: JWTVerifyGetKey | Uint8Array = jwks !== undefined ? createRemoteJWKSet(new URL(jwks)) : new TextEncoder().encode(secret);
  const algorithms = jwks !== undefined ? ["ES256", "RS256", "EdDSA"] : ["HS256"];
  return async (token) => {
    if (!TOKEN.test(token)) throw new InvalidTokenError();
    try {
      const options = { issuer, audience, algorithms, requiredClaims: ["sub", "exp"] };
      const { payload } = typeof key === "function" ? await jwtVerify(token, key, options) : await jwtVerify(token, key, options);
      if (typeof payload.sub !== "string" || !UUID.test(payload.sub) || payload.role !== "authenticated") throw new Error("claims");
      return { userId: payload.sub.toLowerCase() };
    } catch {
      throw new InvalidTokenError();
    }
  };
}
