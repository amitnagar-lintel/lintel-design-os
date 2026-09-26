/**
 * The HTTP surface without a database: /api/v1 routing, RFC 9457 problems, request ids, the fail-closed access
 * guard and Standard Schema validation.
 */
import { Body, Controller, Get, Module, Post, Query } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { Public } from "../../src/common/auth/decorators.js";
import { SchemaPipe } from "../../src/common/http/schema.pipe.js";
import { PageQuery } from "../../src/common/http/schemas.js";
import type { ApiConfig } from "../../src/config.js";

const Echo = z.strictObject({ name: z.string().min(1), qty: z.number().int().positive() });

@Controller("__http")
class HttpProbe {
  @Get("undeclared")
  undeclared(): string {
    return "should never be reached";
  }
  @Post("echo")
  @Public()
  echo(@Body(new SchemaPipe(Echo, "body")) body: z.infer<typeof Echo>): unknown {
    return body;
  }
  @Get("page")
  @Public()
  page(@Query(new SchemaPipe(PageQuery, "query")) q: PageQuery): unknown {
    return q;
  }
}
@Module({ controllers: [HttpProbe] })
class HttpProbeModule {}

let app: NestFastifyApplication;
const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

beforeAll(async () => {
  const config: ApiConfig = {
    databaseUrl: "postgresql://nobody@127.0.0.1:1/none", dbPoolMax: 1, port: 0,
    auth: { issuer: "https://auth.test.local/auth/v1", audience: "authenticated", key: { kind: "secret", secret: new TextEncoder().encode("s".repeat(40)) } },
    cursorSecret: "c".repeat(32), corsOrigins: [], logger: false, buildRevision: "0000000", files: { provider: "memory", signingSecret: "test-file-url-secret-0123456789abcdef", publicBaseUrl: "http://api.test.local" },
  };
  app = await createApp(config, [HttpProbeModule]);
});
afterAll(async () => {
  await app.close();
});

describe("routing and problems", () => {
  it("serves /api/v1 only, with a request id and no-store caching", async () => {
    const r = await inject({ method: "GET", url: "/api/v1/health" });
    expect([r.statusCode, r.json()]).toEqual([200, { status: "ok" }]);
    expect(r.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await inject({ method: "GET", url: "/health" })).statusCode).toBe(404);
  });
  it("echoes a valid X-Request-Id and replaces an invalid one", async () => {
    const id = "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40";
    expect((await inject({ method: "GET", url: "/api/v1/health", headers: { "x-request-id": id } })).headers["x-request-id"]).toBe(id);
    expect((await inject({ method: "GET", url: "/api/v1/health", headers: { "x-request-id": "<script>" } })).headers["x-request-id"]).not.toBe("<script>");
  });
  it("an unknown route is an RFC 9457 NOT_FOUND problem", async () => {
    const r = await inject({ method: "GET", url: "/api/v1/nope?x=1", headers: { "x-request-id": "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f41" } });
    expect(r.statusCode).toBe(404);
    expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(r.json()).toEqual({ type: "urn:lintel-design-os:problem:not-found", title: "Not found", status: 404, instance: "/api/v1/nope", code: "NOT_FOUND", requestId: "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f41" });
  });
  it("a protected route without a token is 401 AUTH_REQUIRED with WWW-Authenticate", async () => {
    const r = await inject({ method: "GET", url: "/api/v1/me" });
    expect([r.statusCode, r.json<{ code: string }>().code]).toEqual([401, "AUTH_REQUIRED"]);
    expect(r.headers["www-authenticate"]).toContain("Bearer");
  });
  it("the access guard fails closed: a route without an access declaration is refused (and never runs)", async () => {
    const r = await inject({ method: "GET", url: "/api/v1/__http/undeclared" });
    expect([r.statusCode, r.json<{ code: string }>().code]).toEqual([500, "INTERNAL"]);
    expect(r.body).not.toContain("should never be reached");
  });
});

describe("request schemas (Standard Schema via Zod)", () => {
  it("valid bodies pass through; invalid ones are VALIDATION_FAILED with field errors", async () => {
    expect((await inject({ method: "POST", url: "/api/v1/__http/echo", payload: { name: "a", qty: 2 } })).json()).toEqual({ name: "a", qty: 2 });
    const bad = await inject({ method: "POST", url: "/api/v1/__http/echo", payload: { name: "", qty: -1, orgId: "injected" } });
    expect(bad.statusCode).toBe(400);
    const body = bad.json<{ code: string; errors: { path: string }[] }>();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors.map((e) => e.path).sort()).toEqual(["body", "body.name", "body.qty"]);
  });
  it("malformed JSON and unsupported media types are problems too", async () => {
    const r = await inject({ method: "POST", url: "/api/v1/__http/echo", headers: { "content-type": "application/json" }, payload: "{not json" });
    expect([r.statusCode, r.json<{ code: string }>().code]).toEqual([400, "VALIDATION_FAILED"]);
    const t = await inject({ method: "POST", url: "/api/v1/__http/echo", headers: { "content-type": "text/xml" }, payload: "<x/>" });
    expect([t.statusCode, t.json<{ code: string }>().code]).toEqual([415, "UNSUPPORTED_MEDIA_TYPE"]);
  });
  it("pagination query: limit ≤ 200, no offset", async () => {
    expect((await inject({ method: "GET", url: "/api/v1/__http/page" })).json()).toEqual({ limit: 50 });
    expect((await inject({ method: "GET", url: "/api/v1/__http/page?limit=201" })).statusCode).toBe(400);
    expect((await inject({ method: "GET", url: "/api/v1/__http/page?offset=10" })).statusCode).toBe(400);
  });
});
