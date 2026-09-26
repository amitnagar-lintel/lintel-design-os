import { execFileSync } from "node:child_process";
import type { webcrypto } from "node:crypto";
import { ENGINE_BUILD } from "@lintel/persistence";
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
  /**
   * Immutable identity of the running build (Git commit SHA / build revision). Recorded beside the engine fingerprint
   * on every validation run and snapshot (human-readable; not an input of the fingerprint, OD-S6-9).
   */
  readonly buildRevision: string;
  /** Build-time engine manifest (`pnpm engines:manifest`). When absent the manifest is computed from the working tree. */
  readonly engineManifestPath?: string;
  /**
   * Output file storage (M5 §12): the memory or local-filesystem provider only (no hosted bucket). Signed URLs are
   * HMAC-signed, short-lived and served by GET /api/v1/file-content/…; `publicBaseUrl` is the API's public origin.
   */
  readonly files: {
    readonly provider: "memory" | "local" | "supabase";
    readonly root?: string;
    /** memory / local only: the HMAC key and public origin of the API's own signed /file-content URLs. */
    readonly signingSecret: string;
    readonly publicBaseUrl: string;
    /** supabase only (M6 G5): the project URL, the private bucket and the server-side Storage credential. */
    readonly supabase?: { readonly url: string; readonly bucket: string; readonly key: string };
  };
  /** Error tracking (OD-M6-6). Absent = no error tracking (development / tests): nothing is loaded or sent. */
  readonly sentry?: { readonly dsn: string; readonly environment: string; readonly release: string };
  /** Request rate limits (M6 CP3). Every number comes from the environment; see RATE_LIMIT_* below. */
  readonly rateLimit: RateLimitConfig;
  /** Proxy hops to trust for the client IP (X-Forwarded-For); 0 = use the socket address. */
  readonly trustProxyHops: number;
}

/** Requests per window. `ip` applies to every request before authentication; the others per user and organization. */
export interface RateLimitConfig {
  readonly enabled: boolean;
  readonly windowMs: number;
  readonly ip: number;
  readonly read: number;
  readonly write: number;
  readonly sensitive: number;
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
  BUILD_REVISION: z.string().optional(),
  GITHUB_SHA: z.string().optional(),
  ENGINE_MANIFEST_PATH: z.string().min(1).optional(),
  FILE_STORAGE: z.enum(["memory", "local", "supabase"]),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
  SUPABASE_STORAGE_KEY: z.string().min(20).optional(),
  FILE_STORAGE_ROOT: z.string().min(1).optional(),
  FILE_URL_SECRET: z.string().min(32),
  FILE_URL_BASE: z.url(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().regex(/^[a-z0-9_-]{1,64}$/).optional(),
  SENTRY_RELEASE: z.string().min(1).max(200).optional(),
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true"),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  RATE_LIMIT_IP_MAX: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_READ_MAX: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().min(1).default(20),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

/** The checked-out commit, marked `+dirty` when tracked files differ from it (local development only). */
export function gitRevision(cwd = process.cwd()): string | null {
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const head = git("rev-parse", "HEAD");
    return git("status", "--porcelain", "--untracked-files=no") === "" ? head : `${head}+dirty`;
  } catch {
    return null;
  }
}

/**
 * The build identity: BUILD_REVISION (set by the build / deployment), else GITHUB_SHA (CI), else the Git checkout.
 * There is no default: without an identity the API refuses to start rather than record untraceable engine runs.
 */
export function resolveBuildRevision(env: Readonly<Record<string, string | undefined>>, git: () => string | null = gitRevision): string {
  const revision = env.BUILD_REVISION ?? env.GITHUB_SHA ?? git();
  if (revision === null || !ENGINE_BUILD.test(revision)) {
    throw new Error("a build identity is required: set BUILD_REVISION to the commit SHA / build revision (7–128 characters of [0-9A-Za-z._+-])");
  }
  return revision;
}

/** Read and validate the environment. Exactly one of AUTH_JWKS_URL / AUTH_JWT_SECRET must be set. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>, git: () => string | null = gitRevision): ApiConfig {
  const e = Env.parse(env);
  if ((e.AUTH_JWKS_URL === undefined) === (e.AUTH_JWT_SECRET === undefined)) throw new Error("set exactly one of AUTH_JWKS_URL or AUTH_JWT_SECRET");
  if ((e.FILE_STORAGE === "local") !== (e.FILE_STORAGE_ROOT !== undefined)) throw new Error("FILE_STORAGE_ROOT is required for (and only for) FILE_STORAGE=local");
  const supabase = [e.SUPABASE_URL, e.SUPABASE_STORAGE_BUCKET, e.SUPABASE_STORAGE_KEY];
  if ((e.FILE_STORAGE === "supabase") !== supabase.every((x) => x !== undefined) || (e.FILE_STORAGE !== "supabase" && supabase.some((x) => x !== undefined))) {
    throw new Error("SUPABASE_URL, SUPABASE_STORAGE_BUCKET and SUPABASE_STORAGE_KEY are required for (and only for) FILE_STORAGE=supabase");
  }
  if (e.SENTRY_DSN !== undefined && e.SENTRY_ENVIRONMENT === undefined) throw new Error("SENTRY_ENVIRONMENT is required with SENTRY_DSN (e.g. staging, production)");
  const buildRevision = resolveBuildRevision(env, git);
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
    buildRevision,
    ...(e.ENGINE_MANIFEST_PATH === undefined ? {} : { engineManifestPath: e.ENGINE_MANIFEST_PATH }),
    files: { provider: e.FILE_STORAGE, ...(e.FILE_STORAGE_ROOT === undefined ? {} : { root: e.FILE_STORAGE_ROOT }), signingSecret: e.FILE_URL_SECRET, publicBaseUrl: e.FILE_URL_BASE.replace(/\/+$/, ""),
      ...(e.FILE_STORAGE === "supabase" ? { supabase: { url: e.SUPABASE_URL ?? "", bucket: e.SUPABASE_STORAGE_BUCKET ?? "", key: e.SUPABASE_STORAGE_KEY ?? "" } } : {}) },
    ...(e.SENTRY_DSN === undefined ? {} : { sentry: { dsn: e.SENTRY_DSN, environment: e.SENTRY_ENVIRONMENT ?? "", release: e.SENTRY_RELEASE ?? buildRevision } }),
    rateLimit: {
      enabled: e.RATE_LIMIT_ENABLED === "true", windowMs: e.RATE_LIMIT_WINDOW_SECONDS * 1000,
      ip: e.RATE_LIMIT_IP_MAX, read: e.RATE_LIMIT_READ_MAX, write: e.RATE_LIMIT_WRITE_MAX, sensitive: e.RATE_LIMIT_SENSITIVE_MAX,
    },
    trustProxyHops: e.TRUST_PROXY_HOPS,
  };
}
