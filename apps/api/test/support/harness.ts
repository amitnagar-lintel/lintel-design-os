/**
 * API-against-PostgreSQL harness (LOCAL / CI PostgreSQL 17). The API runs exactly as in production — its own pool,
 * logged in as a NOINHERIT member of design_os_api — against the committed "race" database (a migrated copy dropped
 * at the end of the suite). Test data is seeded there with the admin connection and the tests/db world builders.
 */
import { randomUUID } from "node:crypto";
import type { webcrypto } from "node:crypto";
import type { DynamicModule, Type } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { inject } from "vitest";
import { createApp } from "../../src/app.js";
import type { ApiConfig } from "../../src/config.js";
import { resolveBuildRevision } from "../../src/config.js";
import type {} from "../../../../tests/db/support/global-setup.js";
import type { Tx } from "../../../../tests/db/support/db.js";
import type { World } from "../../../../tests/db/support/world.js";
import { createWorld } from "../../../../tests/db/support/world.js";

export const ISSUER = "https://auth.test.local/auth/v1";
/** The build identity the test API runs as, resolved exactly as in production (BUILD_REVISION / GITHUB_SHA / Git checkout). */
export const TEST_BUILD = resolveBuildRevision(process.env);
let keys: Promise<{ privateKey: webcrypto.CryptoKey; publicKey: webcrypto.CryptoKey }> | undefined;
const keyPair = () => (keys ??= generateKeyPair("ES256"));

export async function token(userId: string, claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign((await keyPair()).privateKey);
}

export interface Api {
  readonly app: NestFastifyApplication;
  request(opts: InjectOptions & { readonly as?: string; readonly org?: string }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/** `buildRevision` / `engineManifestPath` simulate another deployment (build B, or a build-time manifest of other engine code). */
export async function startApi(modules: readonly (Type | DynamicModule)[] = [], opts: { readonly poolMax?: number; readonly buildRevision?: string; readonly engineManifestPath?: string } = {}): Promise<Api> {
  const config: ApiConfig = {
    databaseUrl: inject("apiDbUrl"),
    dbPoolMax: opts.poolMax ?? 6,
    port: 0,
    auth: { issuer: ISSUER, audience: "authenticated", key: { kind: "key", key: (await keyPair()).publicKey } },
    cursorSecret: "test-cursor-secret-0123456789abcdef",
    corsOrigins: [],
    // API_TEST_LOG=1 shows the server-side log (full errors) while debugging a failing test.
    logger: process.env.API_TEST_LOG === "1",
    buildRevision: opts.buildRevision ?? TEST_BUILD,
    files: { provider: "memory", signingSecret: "test-file-url-secret-0123456789abcdef", publicBaseUrl: "http://api.test.local" },
    ...(opts.engineManifestPath === undefined ? {} : { engineManifestPath: opts.engineManifestPath }),
  };
  const app = await createApp(config, modules);
  const fastify = app.getHttpAdapter().getInstance();
  return {
    app,
    async request({ as, org, headers, ...rest }) {
      const h: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
      if (as !== undefined) h.authorization = `Bearer ${await token(as)}`;
      if (org !== undefined) h["x-org"] = org;
      return fastify.inject({ ...rest, headers: h });
    },
    close: () => app.close(),
  };
}

/** Admin connection to the committed race database, for seeding and inspecting. */
export async function admin(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: inject("raceDbUrl") });
  await c.connect();
  return c;
}

/** A committed organization with one member per role (tests/db world builder). */
export async function world(): Promise<World> {
  const c = await admin();
  try {
    await c.query("BEGIN");
    const w = await createWorld(c as unknown as Tx, `API_${randomUUID().slice(0, 8)}`);
    await c.query("COMMIT");
    return w;
  } finally {
    await c.end();
  }
}

export async function sql<R extends pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<R[]> {
  const c = await admin();
  try {
    return (await c.query<R>(text, params as unknown[])).rows;
  } finally {
    await c.end();
  }
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly instance: string;
  readonly code: string;
  readonly requestId: string;
  readonly detail?: string;
  readonly errors?: readonly { path: string }[];
  readonly context?: Record<string, unknown>;
}
