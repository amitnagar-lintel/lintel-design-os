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
| `src/modules/*` | Feature modules: `health`, `me` (foundation); `clients`, `projects`, `rooms`, `designs`, `design-versions` (core design domain, M5 Step 5 — see `docs/architecture/M5-STEP5-CORE-DESIGN-API.md`); `outputs` (M5 Step 7 — see `docs/architecture/M5-STEP6-OUTPUT-PLAN.md`) |
| `src/modules/outputs` | Output generation from one `OutputExecutionContext` per request (`output-context.ts`, `output-generation.ts`): BOM, BOQ, Pricing, Quotation and drawing snapshots by exact natural identity; runtime payload schemas (`payloads.ts`); staleness; drawing files, signed URLs (`files.service.ts`) and the outputs graph |
| `src/modules/outputs/engines/*.ts` | Engine entry modules (`validation`, `bom`, `boq`, `pricing`, `quotation`, `drawing`): the only place that wires stored rows to engine calls. Each static import graph is that engine's fingerprint closure |
| `src/infrastructure/storage` | Output file storage (`FILE_STORAGE`: memory or local filesystem; HMAC-signed short-lived URLs) |
| `src/openapi` | OpenAPI 3.1 generator: routes + `@ApiDoc` responses + the routes' request Zod schemas → `openapi/openapi.json` (`pnpm api:openapi`; drift-checked in CI) |
| `src/infrastructure/engines/` | Engine manifest (OD-S6-9): per-engine semantic version, dependency-closure fingerprint and closure; computed from the working tree in development / tests, loaded from `ENGINE_MANIFEST_PATH` in production (`pnpm engines:manifest`) |

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
| `FILE_STORAGE` | Output file storage provider: `memory` (development / tests) or `local` (filesystem at `FILE_STORAGE_ROOT`). No hosted bucket yet |
| `FILE_URL_SECRET`, `FILE_URL_BASE` | HMAC key (≥ 32 characters) for short-lived signed file URLs, and the API's public origin that serves them (`/api/v1/file-content/…`) |
| `ENGINE_MANIFEST_PATH` | Build-time engine manifest (`pnpm engines:manifest <path>`); verified at startup. Without it the manifest is computed from the working tree (development / tests) |
| `BUILD_REVISION` | Immutable build identity (Git commit SHA / build revision), recorded with every validation run and snapshot beside the engine fingerprint (not an input of it, OD-S6-9). Falls back to `GITHUB_SHA`, then the Git checkout; the API refuses to start without one |
| `API_PORT`, `DB_POOL_MAX`, `CORS_ORIGINS`, `API_LOG` | Optional |

No hosted Supabase configuration exists yet. The API runs against local / CI PostgreSQL 17 until the Mumbai gate (M5 §13).

## Tests

- **Unit** (`pnpm test`): `test/unit` — translator, ETags, cursors, request hashing, JWT, HTTP behaviour, engine fingerprints, stored-payload schemas and the OpenAPI document (drift, completeness) with no database.
- **Against PostgreSQL 17** (`pnpm test:db`): `test/db` — auth and org context, database/RLS context propagation, error mapping and registry parity, ETags, idempotency, pagination.
  - The foundation tests use test-only probe routes (`test/support/probe.module.ts`) that are never part of the application.
  - The core design domain tests (`projects`, `rooms-designs`, `design-versions`) drive the real endpoints end to end.
  - The output tests (`outputs`, `output-staleness`, `drawings`) drive generation, reuse, staleness, drawings, files, signed URLs and the outputs graph end to end.
