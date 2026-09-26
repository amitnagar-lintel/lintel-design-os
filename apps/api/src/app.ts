import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { DynamicModule, Type } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { IncomingMessage } from "node:http";
import { CommonModule } from "./common/common.module.js";
import type { ApiConfig } from "./config.js";
import { FixedWindowLimiter, rateLimited } from "./common/http/rate-limit.js";
import type { ErrorReporter } from "./common/observability/error-reporter.js";
import { sendProblem } from "./common/errors/problem.filter.js";
import { HealthController } from "./modules/health/health.controller.js";
import { ClientsModule } from "./modules/clients/clients.module.js";
import { DesignVersionsModule } from "./modules/design-versions/design-versions.module.js";
import { DesignsModule } from "./modules/designs/designs.module.js";
import { MeModule } from "./modules/me/me.module.js";
import { ModelPreviewModule } from "./modules/model-preview/model-preview.module.js";
import { OrganizationModule } from "./modules/organization/organization.module.js";
import { OutputsModule } from "./modules/outputs/outputs.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { ReadinessModule } from "./modules/readiness/readiness.module.js";
import { ReferenceDataModule } from "./modules/reference-data/reference-data.module.js";
import { RoomsModule } from "./modules/rooms/rooms.module.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({ controllers: [HealthController] })
class HealthModule {}

/** Feature modules: the foundation, the core design domain (M5 Step 5), then outputs (M5 Step 7). */
export const FEATURE_MODULES: readonly Type[] = [HealthModule, ReadinessModule, MeModule, OrganizationModule, ReferenceDataModule, ClientsModule, ProjectsModule, RoomsModule, DesignsModule, DesignVersionsModule, ModelPreviewModule, OutputsModule];

/** Build the API: NestJS + Fastify, every route under /api/v1, RFC 9457 errors, fail-closed access guard. */
export async function createApp(config: ApiConfig, extraModules: readonly (Type | DynamicModule)[] = [], overrides: { readonly errorReporter?: ErrorReporter } = {}): Promise<NestFastifyApplication> {
  @Module({ imports: [CommonModule.forRoot(config, overrides), ...FEATURE_MODULES, ...extraModules] })
  class AppModule {}

  const adapter = new FastifyAdapter({
    bodyLimit: 1024 * 1024,
    // Trust exactly TRUST_PROXY_HOPS proxies in front of the API for the client IP (0: the socket address).
    trustProxy: config.trustProxyHops > 0 ? (_address: string, hop: number) => hop < config.trustProxyHops : false,
    requestIdHeader: false,
    genReqId: (req: IncomingMessage) => {
      const h = req.headers["x-request-id"];
      return typeof h === "string" && UUID.test(h) ? h.toLowerCase() : randomUUID();
    },
    logger: config.logger
      ? { level: "info", redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"idempotency-key\"]", "req.body.token"], censor: "[redacted]" } }
      : false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: config.logger ? ["error", "warn"] : false });
  app.setGlobalPrefix("api/v1");
  if (config.corsOrigins.length > 0) app.enableCors({ origin: [...config.corsOrigins], exposedHeaders: ["etag", "location", "x-request-id", "idempotent-replayed"] });
  const fastify = app.getHttpAdapter().getInstance();
  // Per-client-IP limit on every request, before routing and authentication (M6 CP3; RATE_LIMIT_IP_MAX).
  if (config.rateLimit.enabled) {
    const ipLimiter = new FixedWindowLimiter();
    fastify.addHook("onRequest", async (req, reply) => {
      const d = ipLimiter.hit(`ip:${req.ip}`, config.rateLimit.ip, config.rateLimit.windowMs);
      if (!d.allowed) return sendProblem(reply, req, rateLimited(d));
      return undefined;
    });
  }
  fastify.addHook("onSend", async (req, reply) => {
    void reply.header("x-request-id", req.id);
    if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "no-store");
  });
  await app.init();
  await fastify.ready();
  return app;
}
