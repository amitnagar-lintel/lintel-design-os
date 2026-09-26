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
import { HealthController } from "./modules/health/health.controller.js";
import { ClientsModule } from "./modules/clients/clients.module.js";
import { DesignVersionsModule } from "./modules/design-versions/design-versions.module.js";
import { DesignsModule } from "./modules/designs/designs.module.js";
import { MeModule } from "./modules/me/me.module.js";
import { OrganizationModule } from "./modules/organization/organization.module.js";
import { OutputsModule } from "./modules/outputs/outputs.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { RoomsModule } from "./modules/rooms/rooms.module.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({ controllers: [HealthController] })
class HealthModule {}

/** Feature modules: the foundation, the core design domain (M5 Step 5), then outputs (M5 Step 7). */
export const FEATURE_MODULES: readonly Type[] = [HealthModule, MeModule, OrganizationModule, ClientsModule, ProjectsModule, RoomsModule, DesignsModule, DesignVersionsModule, OutputsModule];

/** Build the API: NestJS + Fastify, every route under /api/v1, RFC 9457 errors, fail-closed access guard. */
export async function createApp(config: ApiConfig, extraModules: readonly (Type | DynamicModule)[] = []): Promise<NestFastifyApplication> {
  @Module({ imports: [CommonModule.forRoot(config), ...FEATURE_MODULES, ...extraModules] })
  class AppModule {}

  const adapter = new FastifyAdapter({
    bodyLimit: 1024 * 1024,
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
  fastify.addHook("onSend", async (req, reply) => {
    void reply.header("x-request-id", req.id);
    if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "no-store");
  });
  await app.init();
  await fastify.ready();
  return app;
}
