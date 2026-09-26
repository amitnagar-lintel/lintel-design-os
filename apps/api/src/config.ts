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
   * Immutable identity of the running build (Git commit SHA / build revision). It is part of the engine
   * fingerprint and is recorded with every validation run, so a result names the exact code that produced it.
   */
  readonly buildRevision: string;
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
    buildRevision: resolveBuildRevision(env, git),
  };
}
