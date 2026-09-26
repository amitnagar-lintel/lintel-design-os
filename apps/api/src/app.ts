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
import { MeModule } from "./modules/me/me.module.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({ controllers: [HealthController] })
class HealthModule {}

/** The foundation's feature modules. Business modules (rooms, designs, outputs, …) are added in later steps. */
export const FEATURE_MODULES: readonly Type[] = [HealthModule, MeModule];

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
