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
import { API_CONFIG, PG_POOL } from "./tokens.js";

/** Cross-cutting API foundation: config, database, auth, errors, concurrency, idempotency and pagination. */
@Global()
@Module({})
export class CommonModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: CommonModule,
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: PG_POOL, useFactory: () => createPool(config.databaseUrl, config.dbPoolMax) },
        { provide: CursorCodec, useFactory: () => new CursorCodec(config.cursorSecret) },
        PoolLifecycle,
        Reflector,
        Database,
        UnitOfWork,
        JwtVerifier,
        OrgContextResolver,
        IdempotencyService,
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
      exports: [API_CONFIG, PG_POOL, CursorCodec, Database, UnitOfWork, OrgContextResolver, IdempotencyService],
    };
  }
}
