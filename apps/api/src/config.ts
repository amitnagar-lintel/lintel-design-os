import type { webcrypto } from "node:crypto";
import { z } from "zod";

/** How access tokens are verified (Supabase Auth issues them; the API only verifies). */
export type JwtKeySource =
  | { readonly kind: "jwks"; readonly url: URL }
  | { readonly kind: "secret"; readonly secret: Uint8Array }
  | { readonly kind: "key"; readonly key: webcrypto.CryptoKey };

export interface ApiConfig {
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly port: number;
  readonly auth: { readonly issuer: string; readonly audience: string; readonly key: JwtKeySource };
  /** HMAC key for pagination cursors (never shared with clients). */
  readonly cursorSecret: string;
  readonly corsOrigins: readonly string[];
  readonly logger: boolean;
}

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AUTH_ISSUER: z.string().min(1),
  AUTH_AUDIENCE: z.string().min(1).default("authenticated"),
  AUTH_JWKS_URL: z.url().optional(),
  AUTH_JWT_SECRET: z.string().min(32).optional(),
  CURSOR_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default(""),
  API_LOG: z.enum(["true", "false"]).default("true"),
});

/** Read and validate the environment. Exactly one of AUTH_JWKS_URL / AUTH_JWT_SECRET must be set. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const e = Env.parse(env);
  if ((e.AUTH_JWKS_URL === undefined) === (e.AUTH_JWT_SECRET === undefined)) throw new Error("set exactly one of AUTH_JWKS_URL or AUTH_JWT_SECRET");
  const key: JwtKeySource = e.AUTH_JWKS_URL !== undefined
    ? { kind: "jwks", url: new URL(e.AUTH_JWKS_URL) }
    : { kind: "secret", secret: new TextEncoder().encode(e.AUTH_JWT_SECRET ?? "") };
  return {
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    port: e.API_PORT,
    auth: { issuer: e.AUTH_ISSUER, audience: e.AUTH_AUDIENCE, key },
    cursorSecret: e.CURSOR_SECRET,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter((s) => s !== ""),
    logger: e.API_LOG === "true",
  };
}
