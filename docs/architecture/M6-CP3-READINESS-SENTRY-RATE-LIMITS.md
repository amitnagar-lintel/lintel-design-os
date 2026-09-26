# M6 checkpoint 3 — readiness and audit read (G7), Sentry, rate limiting

Status: implemented for review (gate M6-3). The plan is `M6-V1-GO-LIVE-READINESS-PLAN.md` §6 and §9.1.

**Not in this checkpoint:**
- G3, G5;
- UI;
- hosted Supabase;
- production data import;
- client portal;
- manufacturing.

## 1. G7 — readiness and audit read

**Migration `0020_readiness_audit`** contains grants and two SQL wrappers only:
- The API role may **read** the migration ledger.
- `design_os.audit_chain_status()` runs the existing hash-chain verification, for the caller's own organization, with `audit.read`.
- `design_os.reference_approval_problems(type, id)` returns the existing approval preconditions of a reference version of the caller's organization, with `reference.read`. Readiness therefore reports exactly what the database would refuse, with no second rule set.

| Route | Access | Purpose |
|---|---|---|
| `GET /api/v1/ready` | public (IP rate limit only) | Load balancer / deploy gate. `200 {status: ready}` or `503 {status: not_ready}` with `pass` / `fail` for `database` (a round trip as `design_os_api`), `migrations` (ledger == the build's migrations exactly) and `engineManifest`. No versions, no details, no secrets |
| `GET /api/v1/readiness` | `audit.read` (+ `reference.read`), internal | The organization's gate report (below) |
| `GET /api/v1/audit?table=&rowId=&actorUserId=&from=&to=&limit=&cursor=` | `audit.read` | The organization's audit trail, newest first, keyset pages. RLS limits it to the caller's organization |
| `GET /api/v1/audit/verify` | `audit.read` | `{ ok, checked, firstBadId }` for the organization's hash chain |

**The `/readiness` report:**
- **`status`** is `READY` when no BLOCKING check fails. Otherwise it is `NOT_READY`.
- **`build`** gives the revision and the engine fingerprints.
- **`summary`** gives the number of blocking failures, warnings and checks.
- **`checks`** are sorted by id and carry no timestamps, so the report is deterministic.
- **Each check** is `{ id, level: BLOCKING | WARNING | INFO, status: PASS | FAIL | SKIPPED, message, details }`.

| Check | Level | Fails when |
|---|---|---|
| `database.migrations` | BLOCKING | The ledger is not exactly the build's migrations: pending, drift (checksum, name, unknown, out-of-order) or unreadable |
| `audit.chain` | BLOCKING | The organization's hash chain does not verify |
| `data.<type>.approved` | BLOCKING | No APPROVED / LOCKED version exists |
| `data.<type>.dependencies` | BLOCKING | A usable (latest APPROVED / LOCKED) version no longer meets the database's approval preconditions (e.g. a dependency was superseded). `SKIPPED` without a usable version |
| `data.<type>.pending` | WARNING | A newer version is IN_REVIEW (outputs still use the current usable version) |
| `build.engine_manifest` | INFO | The engine manifest is missing |

**Required types (the pilot data prerequisite, plan §4.3):**
- ConstructionStandard, PlanningStandard, EdgeBandStandard;
- Material / Finish / Hardware / Product catalogs;
- the Hettich dataset;
- PricingStandard and QuotationPolicy.

Catalog items are covered through their catalogs' dependency checks. Appliances and the ManufacturingStandard are not required for V1.

**Deployment automation:**
- **Staging / production deploys** gate on `GET /ready` (200). The migration runner's `status --check` gates before the deploy.
- **The pilot data gate (M6-10)** is `GET /readiness` → `status: READY`, run by an ADMIN / DESIGN_HEAD / FINANCE token.

## 2. Sentry (OD-M6-6)

**What is captured:**
- Server errors only: every problem with status ≥ 500.
- Each report carries the tags `requestId`, `route` (the template, never the URL), `method`, `status` and `code`, plus `environment` and `release`.
- Client errors (4xx) are never sent.

**What is never sent.** The adapter uses Sentry's v11 data-collection controls: no user info, cookies, headers, bodies, query strings, database query data or stack-frame variables, and no default integrations, tracing or breadcrumbs. On top of that, `scrubEvent` does two things before anything leaves the process:
- it drops request, user, breadcrumbs, extra, server name, unknown contexts and tags;
- it redacts bearer tokens, JWTs, Supabase keys, credentials in connection strings, `password=` / `token=` style pairs, emails and phone numbers from every message.

**Lightweight in development and tests.** Without `SENTRY_DSN` a no-op reporter is used, and `@sentry/node` is not even loaded (dynamic import).

**Environment:**

| Variable | Required | Meaning |
|---|---|---|
| `SENTRY_DSN` | per environment (staging, production); absent locally | The Sentry project DSN (a separate project per environment) |
| `SENTRY_ENVIRONMENT` | with `SENTRY_DSN` | e.g. `staging`, `production` |
| `SENTRY_RELEASE` | no | Defaults to `BUILD_REVISION` |

Pending reports are flushed on shutdown (2 s).

## 3. Rate limiting

The limiter uses in-process fixed windows. V1 runs one API instance (OD-M6-1); with more instances each enforces its own share, and a shared store is a later change. It has two layers:

| Layer | Key | Applies to | Default (`RATE_LIMIT_*`) |
|---|---|---|---|
| Per client IP | client address (`TRUST_PROXY_HOPS` proxies trusted) | every request, before routing and authentication: public routes, failed sign-ins, token probing | `RATE_LIMIT_IP_MAX` = 600 |
| `sensitive` | class + organization + verified user | onboarding (`/me/invitations`, accept), invitations, role grants / revokes, lifecycle transitions, quotation / drawing issue | `RATE_LIMIT_SENSITIVE_MAX` = 20 |
| `write` | class + organization + verified user | every other non-GET route | `RATE_LIMIT_WRITE_MAX` = 120 |
| `read` | class + organization + verified user | every other GET route | `RATE_LIMIT_READ_MAX` = 600 |

- **Window:** `RATE_LIMIT_WINDOW_SECONDS` (60). `RATE_LIMIT_ENABLED=false` switches it off; the test harness does so unless a test sets limits.
- **Defaults are starting points, not production assumptions.** Staging and production set every `RATE_LIMIT_*` explicitly in the host's environment. `TRUST_PROXY_HOPS` must equal the number of proxies in front of the API (0 locally), or the IP layer would limit the proxy.
- **When a limit is exceeded** the response is `429` `application/problem+json` with `code: RATE_LIMITED`, plus `Retry-After`, `RateLimit-Limit` and `RateLimit-Remaining: 0`.

## 4. Tests

| Test | What it covers |
|---|---|
| Unit | The limiter's windows and keys; config parsing of every `RATE_LIMIT_*` / `SENTRY_*` / `TRUST_PROXY_HOPS`; the scrubber; the real Sentry SDK with an in-memory transport (environment, release, tags, and nothing sensitive in the envelope) |
| API / DB, readiness | `/ready` 200, and 503 on ledger drift. `/readiness` for an organization without data (every required set BLOCKING), with approved data (READY), and with a newer version in review (WARNING only, still READY). Deterministic output, permissions, tenant safety, no secrets, no write routes |
| API / DB, audit | Pages and filters, organization-bound cursors, other organizations' entries unreachable, chain verification |
| API / DB, error reporting | A 500 is reported with the route template and code; 404 and 403 are not |
| API / DB, rate limits | Read, write and sensitive limits (including a first-sign-in route with no organization); counters per user, organization and class; the per-IP layer on public and unauthenticated requests; the 429 problem and `Retry-After` |
| Migrations | 0020 up / down / up and the schema snapshot |

## 5. Remaining risks

- **Rate limits are per instance and in memory.** A restart resets them, and horizontal scaling divides them. Acceptable for the single-instance V1; revisit with the hosted deployment (M6-8).
- **`/ready` checks the ledger against the build's migration files**, so the deploy image must include `database/migrations`. It does, because it is built from the repository.
- **The Sentry transport and region** are verified only on staging (M6-8), after hosted access is approved.
