# apps/api — Lintel Design OS API

NestJS 12 + Fastify 5 under `/api/v1`. It is the **only** application boundary to the `design_os` database.
The frontend never connects to PostgreSQL. Design: `docs/architecture/M5-STEP4-API-PLAN.md`.

```text
Browser / client portal / apps → /api/v1 → controllers → application services → persistence / engines / storage → PostgreSQL / file storage
```

## Layout

| Path | Contents |
|---|---|
| `src/app.ts`, `src/main.ts` | Application factory (global prefix, request ids, logging with redaction, CORS) and entrypoint |
| `src/config.ts` | Environment → `ApiConfig` (validated with Zod) |
| `src/common/auth` | JWT verification, X-Org → verified membership → org context, fail-closed access guard, route declarations, the 46-action vocabulary |
| `src/common/db` | Pool (NOINHERIT login role → `SET LOCAL ROLE design_os_api`), transactions, unit of work with in-transaction re-verification |
| `src/common/errors` | RFC 9457 problems, problem codes, database-error translation by SQLSTATE (never by message) |
| `src/common/http` | Standard Schema validation pipe, shared schemas, ETags / If-Match, cursor pagination, idempotent response helper |
| `src/common/idempotency` | Idempotency-Key handling over `design_os.claim_idempotency()` / `complete_idempotency()` |
| `src/infrastructure/persistence` | Repositories: SQL only |
| `src/modules/*` | Feature modules: `health`, `me` (foundation); `clients`, `projects`, `rooms`, `designs`, `design-versions` (core design domain, M5 Step 5 — see `docs/architecture/M5-STEP5-CORE-DESIGN-API.md`). Output modules come later |
| `src/modules/design-versions/engine.ts` | Rebuilds the engine inputs from the exact pinned rows (via `@lintel/persistence`) and runs `@lintel/design-engine` for validation |

Boundaries are enforced by ESLint. Controllers never import repositories, the database, engines, persistence or
storage. Repositories never import engines or `@lintel/persistence`. `pg` is used only in `common/db`,
`infrastructure` and tests. Engines never import NestJS.

## Configuration

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Login role that is a NOINHERIT member of `design_os_api` (never the owner, never `service_role`) |
| `AUTH_ISSUER`, `AUTH_AUDIENCE` | Expected token issuer / audience (`authenticated`) |
| `AUTH_JWKS_URL` **or** `AUTH_JWT_SECRET` | Supabase Auth verification key (asymmetric JWKS or the HS256 shared secret) |
| `CURSOR_SECRET` | HMAC key for pagination cursors (≥ 32 characters) |
| `BUILD_REVISION` | Immutable build identity (Git commit SHA / build revision), recorded with every validation run and part of the engine fingerprint. Falls back to `GITHUB_SHA`, then the Git checkout; the API refuses to start without one |
| `API_PORT`, `DB_POOL_MAX`, `CORS_ORIGINS`, `API_LOG` | Optional |

No hosted Supabase configuration exists yet. The API runs against local / CI PostgreSQL 17 until the Mumbai gate (M5 §13).

## Tests

- **Unit** (`pnpm test`): `test/unit` — translator, ETags, cursors, request hashing, JWT, and HTTP behaviour with no database.
- **Against PostgreSQL 17** (`pnpm test:db`): `test/db` — auth and org context, database/RLS context propagation, error mapping and registry parity, ETags, idempotency, pagination.
  - The foundation tests use test-only probe routes (`test/support/probe.module.ts`) that are never part of the application.
  - The core design domain tests (`projects`, `rooms-designs`, `design-versions`) drive the real endpoints end to end.
