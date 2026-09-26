import type { DynamicModule } from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import type { ApiConfig } from "../config.js";
import { AccessGuard } from "./auth/access.guard.js";
import { JwtVerifier } from "./auth/jwt.js";
import { OrgContextResolver } from "./auth/org-context.js";
import { Database } from "./db/database.js";
import { createPool, PoolLifecycle } from "./db/pool.js";
import { UnitOfWork } from "./db/unit-of-work.js";
import { ProblemFilter } from "./errors/problem.filter.js";
import { CursorCodec } from "./http/pagination.js";
import { IdempotencyService } from "./idempotency/idempotency.service.js";
import { loadEngineManifest } from "../infrastructure/engines/engine-manifest.js";
import { createFileStorage } from "../infrastructure/storage/file-storage.js";
import { API_CONFIG, ENGINE_MANIFEST, ERROR_REPORTER, FILE_STORAGE, PG_POOL } from "./tokens.js";
import { RateLimitGuard } from "./http/rate-limit.js";
import type { ErrorReporter } from "./observability/error-reporter.js";
import { NOOP_ERROR_REPORTER } from "./observability/error-reporter.js";
import { ReporterLifecycle } from "./observability/reporter-lifecycle.js";
import { createSentryReporter } from "../infrastructure/observability/sentry.js";

/** Cross-cutting API foundation: config, database, auth, errors, concurrency, idempotency, pagination and file storage. */
@Global()
@Module({})
export class CommonModule {
  static forRoot(config: ApiConfig, overrides: { readonly errorReporter?: ErrorReporter } = {}): DynamicModule {
    return {
      module: CommonModule,
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: ENGINE_MANIFEST, useFactory: () => loadEngineManifest(config.engineManifestPath) },
        { provide: FILE_STORAGE, useFactory: () => createFileStorage(config.files) },
        { provide: PG_POOL, useFactory: () => createPool(config.databaseUrl, config.dbPoolMax) },
        {
          provide: ERROR_REPORTER,
          useFactory: (): ErrorReporter | Promise<ErrorReporter> => overrides.errorReporter ?? (config.sentry === undefined ? NOOP_ERROR_REPORTER : createSentryReporter(config.sentry)),
        },
        ReporterLifecycle,
        { provide: CursorCodec, useFactory: () => new CursorCodec(config.cursorSecret) },
        PoolLifecycle,
        Reflector,
        Database,
        UnitOfWork,
        JwtVerifier,
        OrgContextResolver,
        IdempotencyService,
        { provide: APP_GUARD, useClass: AccessGuard },
        // After the access guard: the per-user / per-organization rate limit needs the verified identity.
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
      exports: [API_CONFIG, ERROR_REPORTER, ENGINE_MANIFEST, FILE_STORAGE, PG_POOL, CursorCodec, Database, UnitOfWork, OrgContextResolver, IdempotencyService],
    };
  }
}
