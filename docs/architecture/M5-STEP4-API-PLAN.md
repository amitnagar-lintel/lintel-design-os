# M5 Step 4: API Foundation (architecture plan, for review)

Status: **REVIEW ONLY.** No API code, no migrations and no hosted Supabase work are part of this document.

Inputs:

- `M5-TECHNICAL-DESIGN.md`: §7 tenancy, §8 API structure, §9 authorization, §12 storage, §13 gate.
- Migrations 0001–0011, merged in PR #6. The database contract below is the one those migrations enforce.

Where this plan needs something the schema does not yet provide, it says so and lists it as an open decision in §12. It does not change the schema.

---

## 1. API architecture

### 1.1 Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 11 with `@nestjs/platform-fastify` (`FastifyAdapter`) |
| Validation | Zod 4 schemas, consumed through the Standard Schema interface (`~standard.validate`) by a single `StandardSchemaPipe`. Controllers never validate by hand |
| DB driver | `pg` (node-postgres) Pool. `design_os_api` is NOLOGIN (0001): the pool logs in as a deployment login role whose only privilege is membership in `design_os_api`, and every transaction starts with `SET LOCAL ROLE design_os_api`. No ORM, no Supabase JS client for data, no PostgREST |
| Auth tokens | `jose` (JWKS / HS256 verification of Supabase Auth JWTs). Tests use a local key pair |
| Base path | `/api/v1` (global prefix). Breaking changes go to `/api/v2`, never into v1 |
| Content types | `application/json` in, `application/json` out; errors are `application/problem+json`; file bytes use `multipart/form-data` upload only on the file endpoint |
| OpenAPI | Generated from the Zod schemas (`zod` → JSON Schema) and served at `/api/v1/openapi.json`, which is internal-only |

### 1.2 Layout (`apps/api`)

```text
apps/api/src/
  main.ts                               NestFactory.create(AppModule, new FastifyAdapter()); prefix /api/v1
  app.module.ts
  common/
    http/standard-schema.pipe.ts        Zod via Standard Schema → 400 problem on failure
    http/problem.filter.ts              every error → RFC 9457 problem+json (§5)
    http/etag.ts                        ETag / If-Match helpers (§4)
    http/idempotency.interceptor.ts     Idempotency-Key handling (§4)
    auth/jwt.guard.ts                   verifies the Supabase JWT → Principal { userId }
    auth/request-context.ts             per-request context: principal, org, identity kind, role, permissions, requestId
    auth/permission.guard.ts            @RequiresAction('design_version.author') metadata → 403 before any domain query
    db/unit-of-work.ts                  one transaction per request; sets claims, request id and reason (§2.2)
    db/pg-error.translator.ts           SQLSTATE and database message → problem code (§5.3)
  modules/<module>/
    <module>.controller.ts              HTTP only: route, pipes, guards, call the service, map to the response DTO
    <module>.schemas.ts                 Zod request/response schemas (from @lintel/types shapes)
    <module>.service.ts                 application service: scope and state checks, orchestration, engine calls
  infrastructure/
    persistence/<module>.repository.ts  parameterised SQL only; returns rows; no rules, no calculations
    storage/supabase.storage.ts         SupabaseStorageProvider (not wired until the §13 gate)
    storage/s3.storage.ts               S3StorageProvider (not wired until the gate)
    storage/provider.factory.ts         memory | local | supabase | s3 from config; V1 local and CI use memory/local
    engines/engine-fingerprint.ts       engine_version + engine_hash for validation runs and snapshots
```

### 1.3 Dependency boundaries

```text
controller ──► service ──► engines (@lintel/*-engine, pure)
                  │  └──► @lintel/persistence (pure mappers, hashing, provenance builders)
                  ├──► infrastructure/persistence (repositories, pg) ──► design_os_api ──► RLS
                  └──► infrastructure/storage ──► @lintel/storage FileStorageProvider
```

| Rule | Enforcement |
|---|---|
| Engines import no `@nestjs/*`, `pg`, `@supabase/*`, AWS SDK, `@lintel/persistence` or `@lintel/storage` | Existing ESLint `no-restricted-imports`, extended with `@nestjs/*` and `@aws-sdk/*` |
| Controllers import no repositories, `pg`, storage providers or engines | New ESLint override on `apps/api/src/modules/**/*.controller.ts` |
| Repositories import no engines and no `@lintel/persistence` hashing; they only run SQL | ESLint override on `infrastructure/persistence/**` |
| `pg` is imported only in `apps/api/src/infrastructure/**`, `apps/api/src/common/db/**` and `tests/db/**` | Existing global `pg` restriction with narrow allow-lists |
| **No business calculation in a controller or repository.** Content hashes, input hashes, provenance and all engine outputs are computed by `@lintel/persistence` or the engines, called from services | Code review; unit tests assert that services call the builders |
| **The frontend never reaches the database.** `design_os` is not in PostgREST's exposed schemas and nothing is granted to `anon`, `authenticated` or `service_role` (migration 0011). Web, admin and client-portal apps talk only to `/api/v1` | Already enforced by the database; a test asserts no grants exist to those roles |

---

## 2. Authentication and authorization

### 2.1 Establishing identity per request

```text
1. JwtGuard            Authorization: Bearer <Supabase access token>
                       verify signature (JWKS or HS256 secret), iss, aud = "authenticated", exp; sub = user id
                       failure → 401 AUTH_REQUIRED (no database access at all)
2. Org selection       X-Org: <uuid> header, optional when the user has exactly one ACTIVE membership
3. Context load        one read inside the request transaction, after claims are set (2.2):
                       SELECT design_os.current_org_id(), design_os.is_internal(),
                              app_user.identity_kind, org_membership.role, array_agg(role_permission.action)
                       current_org_id() returns NULL unless the membership is ACTIVE → 403 ORG_MEMBERSHIP_REQUIRED
4. PermissionGuard     route action ∈ context.permissions, else 403 PERMISSION_DENIED
                       This runs BEFORE any domain query (the context load is the only prior read)
5. Service scope check project scope via can_access_project(project_id) → otherwise 404 NOT_FOUND
                       (existence of other tenants' or unassigned projects is never revealed)
6. Service state check lifecycle state, D8, If-Match, pins (§4, §8)
7. Database            RLS re-checks org, permission and project scope on every statement (final boundary)
```

- **The client never supplies an org, role, permission or user id in the body.** Any such field is rejected by the Zod schema (`.strict()`).
- **Identity kind is fixed per route family.**
  - `/api/v1/portal/**` accepts only `identity_kind = CLIENT`.
  - Every other route requires `INTERNAL`.
  - A mismatch returns 403 `IDENTITY_KIND_MISMATCH`. This matches D10: a CLIENT holds only the CLIENT role, enforced by the `guard_membership_identity` trigger.
- **No cross-request caching of the context.** Revoking a membership, client contact or project member takes effect on the next request (D10).
- **Client first sign-in linking.** `client_contact.user_id` is set on the first successful OTP sign-in by `POST /portal/session/link`. That endpoint only links an ACTIVE, invited contact whose email equals the verified JWT email. Open decision OD-5 covers whether this needs a SECURITY DEFINER function.

### 2.2 The request transaction (unit of work)

Every request, including reads, runs in exactly one transaction on a pooled `design_os_api` connection (compatible with the Supavisor transaction pooler):

```sql
BEGIN;  -- READ COMMITTED; snapshot/generation endpoints use REPEATABLE READ (§6)
SET LOCAL ROLE design_os_api;                              -- RLS-subject role; never the owner
SELECT set_config('request.jwt.claims', $claims, true);   -- {"sub": userId, "org_id": X-Org}; transaction-local
SELECT set_config('design_os.request_id', $requestId, true);  -- audit_log.request_id
SELECT set_config('design_os.reason', $reason, true);      -- only when the request carries a reason
... context load, guards, repositories, SECURITY DEFINER calls ...
COMMIT;  -- or ROLLBACK on any error; idempotency records are written in the same transaction (§4.3)
```

- `request.jwt.claims` is the only way RLS learns who is acting. It is built from the verified JWT and the validated `X-Org`, never from the request body.
- `true` (transaction-local) guarantees that nothing leaks to the next pooled user.
- The request id comes from `X-Request-Id` when it is a valid UUID, otherwise it is generated. It is echoed in the response and in the problem body.

### 2.3 Mapping API actions to database permissions and RLS

The API uses the **same 46 action strings** seeded in 0002. There is no second permission vocabulary. The guard checks the action, the service checks scope and state, and RLS or the SECURITY DEFINER function checks all three again.

| API operation | Guard action (API) | Database enforcement (final) |
|---|---|---|
| Read reference data | `reference.read` | `ref_read` RLS policy (internal + `reference.read`) |
| Author a standard/catalog/Hettich version or content | `<subject>.author` (from the `versioned_table` registry) | version/content INSERT/UPDATE policies + `guard_version_row` (DRAFT only) + column grants |
| Submit | registry `author_action` | `transition()` checks `has_permission(author_action)` |
| Approve / request changes | registry `approve_action` (FINANCE-only for pricing, quotation policy, commercial config) | `transition()` + `finance_approval_actions()` CHECK on `role_permission` + D8 |
| Lock a design version | any of `design_version.lock`, `quotation.issue`, `drawing.issue`, `manufacturing.release` | `transition()` LOCK branch |
| Clients / contacts | `client.read`, `client.write` | `client_read/insert/update` policies |
| Projects | `project.write`; reads need scope | `project_read` uses `can_access_project(id)` |
| Project members | `project_members.assign` | policy + `guard_project_member` (CLIENT contact must belong to the project's client) |
| Rooms and room revisions | `room.survey.write` | room/room_revision policies with `room_project` |
| Designs, versions, objects, overrides, pins | `design_version.author` | `design_insert/update`, `dv_*` policies + `guard_draft_content` |
| Record a validation run | `output.generate.engineering` | `record_validation_run()` (SECURITY DEFINER; no INSERT grant on the table) |
| BOM / BOQ / drawing / manufacturing-document snapshots | `output.generate.engineering` | snapshot INSERT policy + `check_snapshot_provenance` |
| Pricing / quotation snapshots | `output.generate.commercial` | same |
| Issue quotation / drawing | `quotation.issue` / `drawing.issue` | issue INSERT policy + `check_issue` (LOCKED, 0 BLOCKERs, locked content) |
| Read cost (pricing snapshots) | `output.read.cost` | `snapshot_read` policy |
| Read BOM/BOQ/drawings/manufacturing | `output.read.production` | `snapshot_read` policy |
| Client portal reads | `output.read.issued` | `snapshot_read_issued`, `issue_read`, `client_can_read_file` |
| Audit | `audit.read` | `audit_log` read policy |
| Members / role grants | `org.members.manage`, `org.role_permissions.manage` | policies + the FINANCE/CLIENT CHECKs on `role_permission` |

**The API check is necessary but never sufficient.** A test in §10.3 disables the API guard in a test harness and shows that RLS alone still refuses the same operations.

---

## 3. Modules (Design OS V1 only)

| Module | Owns |
|---|---|
| `me` | current principal, memberships, permissions for UI capability flags |
| `organizations` | read own organization; **no create route** (platform administration only) |
| `memberships` | users/memberships, role grants (`role_permission`) |
| `clients` | clients, client contacts (invite/revoke) |
| `projects` | projects, project members |
| `rooms` | rooms, room revisions (survey; insert-only) |
| `designs` | designs, design versions, pins, design objects, relationship overrides |
| `reference` | standards (six domains), catalog items (material, edge band, finish, hardware item, hardware rule set, appliance, recipe, product), catalog versions, Hettich datasets |
| `approvals` | the single transition endpoint, approval requests/decisions (read) |
| `validation` | validation runs (engine execute + `record_validation_run`) |
| `outputs` | BOM, BOQ, pricing, quotation, drawing and manufacturing-document snapshots; issues |
| `files` | file upload/metadata/signed URL; orphan deletion |
| `audit` | read-only audit, chain verification for admins |
| `portal` | CLIENT-only read surface (issued quotations and drawings of the client's projects) |

---

## 4. Versioning and concurrency

### 4.1 ETag / If-Match

| Resource class | ETag value | Source |
|---|---|---|
| Version rows (all 21 registry subjects incl. `design_version`) | `W/"<id>:<row_version>"` | `row_version` is bumped by `guard_version_row` on every UPDATE, including lifecycle changes and, for design versions, `input_revision` bumps caused by object/override edits |
| Children of a design version (objects, overrides) | the **parent design version** ETag | any child change bumps the parent's `input_revision` → `row_version`. One token guards the whole draft |
| Mutable non-versioned rows (`client`, `client_contact`, `project`, `project_member`, `org_membership`, `design`) | `W/"<sha256 of the canonical row>"` | computed by `@lintel/persistence` hashing on read; compared under `SELECT … FOR UPDATE` before the update. No schema change needed (OD-3 offers a `row_version` column instead) |
| Insert-only rows (snapshots, room revisions, runs, issues, files, audit) | strong `"<content_hash>"` | never change, so no If-Match needed |

- **Every write to an existing mutable resource requires `If-Match`.**
  - A missing header returns 428 `PRECONDITION_REQUIRED`.
  - A mismatch returns 412 `STALE_VERSION`. The problem body includes the current ETag and `row_version`, so a client can re-read and retry deliberately.
- **The service does not trust the read-then-write gap.** The update statement itself carries the guard: `UPDATE … WHERE id = $1 AND row_version = $2`. Zero rows updated → 412.
- Creates return `201` with `Location` and `ETag`.

### 4.2 Content hashes

- `content_hash` on versions is recomputed by the service through `@lintel/persistence` (`contentHash` / mappers) on every DRAFT content write and stored with the same statement.
- The database stores it; `transition(APPROVE)` requires `expectedContentHash` to equal it. The approver must send the hash of **what they reviewed**; a stale review → 409 `CONTENT_HASH_MISMATCH`.
- For design versions, `input_hash` is recomputed with `designInputHash` after every object/override/pin change in the same transaction. The database independently bumps `input_revision`, so a run for an out-of-date hash or revision is never accepted (`validation-run.test.ts`).

### 4.3 Idempotency keys

- **Required:** `Idempotency-Key` (UUID) on:
  - `POST …/transitions`;
  - `POST …/validation-runs`;
  - every snapshot generation;
  - issues;
  - file upload;
  - client-contact invite.
- **Optional** on other creates. Missing where required → 428.
- **Record key.** The key is scoped per `(org_id, actor, key)`. The stored record holds the request fingerprint (method + route template + SHA-256 of the canonical body) and the response (status + body + resource id).
- **Behaviour:**

  | Situation | Response |
  |---|---|
  | Same key, same fingerprint, completed | Replays the stored response with `Idempotent-Replayed: true` |
  | Same key, different fingerprint | 422 `IDEMPOTENCY_KEY_REUSED` |
  | Same key still in flight | 409 `IDEMPOTENCY_IN_PROGRESS`; the unique insert blocks, and the loser gets this response |

- **The record is written in the same transaction as the effect**, so a rollback never leaves a "done" key without its effect.
- **This needs a table** (`design_os.idempotency_record`). That is a migration, which is **not** created here; see OD-2.
- **Natural idempotency still applies** even without the table:
  - `transition` fails on a repeated action (the state has moved on);
  - `check_issue` plus the `snapshot_id` primary key on the issue tables prevent double issues.

  The table makes retries return the original success instead of a confusing 409.

### 4.4 LOCKED, SUPERSEDED and other non-DRAFT records

| Attempt | Response |
|---|---|
| Edit content of an IN_REVIEW / APPROVED / LOCKED / SUPERSEDED version | 409 `RECORD_NOT_EDITABLE` (the service checks first; `guard_version_row` / `guard_draft_content` raise the same class in the database) |
| Edit anything that a LOCKED version pins (catalog membership, recipe, dependency content) | 409 `RECORD_LOCKED` |
| Change a design version's pins or objects after DRAFT | 409 `RECORD_NOT_EDITABLE` |
| Delete a version, snapshot, run, issue, decision or audit row | no route exists; the database also forbids it |
| Change a LOCKED design | create a new design version (`POST /designs/{id}/versions` with `basedOn`), which starts in DRAFT |

---

## 5. Error contract (RFC 9457)

### 5.1 Shape

```json
{
  "type": "https://lintel.design/problems/stale-version",
  "title": "The resource changed since you read it",
  "status": 412,
  "detail": "design_version 7f… is at row_version 5; If-Match named 4",
  "instance": "/api/v1/design-versions/7f…",
  "code": "STALE_VERSION",
  "requestId": "3c…",
  "errors": [],
  "context": { "currentEtag": "W/\"7f…:5\"" }
}
```

- `code` is the stable, machine-readable key. Clients branch on `code`, never on `title` or `detail`.
- `errors[]` holds field-level items `{ path, code, message }`, used by validation failures.
- `context` carries only data the caller is allowed to see. No SQL, stack traces, constraint names or other tenants' ids are ever returned. Internal detail goes to logs under the same `requestId`.

### 5.2 Codes

| Code | HTTP | Raised by |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod schema (Standard Schema pipe); `errors[]` lists fields |
| `AUTH_REQUIRED` | 401 | missing/invalid/expired JWT |
| `ORG_MEMBERSHIP_REQUIRED` | 403 | `current_org_id()` NULL (no ACTIVE membership in `X-Org`) |
| `IDENTITY_KIND_MISMATCH` | 403 | CLIENT on an internal route or INTERNAL on a portal route |
| `PERMISSION_DENIED` | 403 | guard (action missing) or database `insufficient_privilege` / RLS WITH CHECK failure |
| `SEPARATION_OF_DUTIES` | 403 | D8: approver or reviewer is the submitter |
| `NOT_FOUND` | 404 | missing, **or in another tenant, or outside the caller's project scope** (tenant isolation is deliberately indistinguishable from absence) |
| `TENANT_ISOLATION` | 404 on the wire, logged as a security event | a body references an id belonging to another org (composite-FK violation or definer "not found in this organization"). The client sees `NOT_FOUND`; the log line carries `TENANT_ISOLATION` |
| `LIFECYCLE_TRANSITION_REJECTED` | 409 | action not allowed from the current status (e.g. APPROVE from DRAFT), unknown action, missing reason, SUPERSEDE requested directly, newer version already effective |
| `STALE_VERSION` | 412 | If-Match mismatch / zero-row guarded update |
| `PRECONDITION_REQUIRED` | 428 | missing `If-Match` or `Idempotency-Key` where required |
| `CONTENT_HASH_MISMATCH` | 409 | `expectedContentHash` ≠ stored content hash on APPROVE |
| `RECORD_NOT_EDITABLE` | 409 | content write on a non-DRAFT version |
| `RECORD_LOCKED` | 409 | write touching a LOCKED record or its frozen dependencies; issue flows on non-LOCKED designs |
| `DEPENDENCY_NOT_APPROVED` | 409 | `approval_problems` reports an unapproved/unlocked pinned or member dependency; `lock_cascade` cannot lock a dependency |
| `APPROVAL_PRECONDITIONS_FAILED` | 409 | other `approval_problems` items (domain completeness: empty rule set, NULL rates, unverified Hettich data…); `context.problems[]` lists them |
| `VALIDATION_RUN_REQUIRED` | 409 | SUBMIT with no run for the current `input_hash` + `input_revision` |
| `VALIDATION_BLOCKERS` | 409 | approval or FOR_PRODUCTION generation with BLOCKERs > 0; `context.blockerCount` and the run id |
| `VALIDATION_INPUT_MISMATCH` | 409 | recording a run whose `input_hash` differs from the design version's current inputs |
| `PROVENANCE_MISMATCH` | 409 | `check_snapshot_provenance` rejects the snapshot (pins ≠ design version pins, status or content hash differ, TEST_FIXTURE present) |
| `ISSUE_PRECONDITIONS_FAILED` | 409 | `check_issue`: design not LOCKED, BLOCKERs, snapshot not of locked content |
| `CHECKSUM_MISMATCH` | 422 | uploaded bytes do not match the declared SHA-256 |
| `FILE_REFERENCED` | 409 | delete of a file referenced by a snapshot or issue |
| `IDEMPOTENCY_KEY_REUSED` | 422 | same key, different request fingerprint |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | same key still executing |
| `INTERNAL` | 500 | anything unmapped (logged with full detail; never leaked) |

### 5.3 Mapping database errors

The API pre-checks most conditions so it can emit precise codes, but concurrent requests mean the database may still be the one that refuses. The database raises generic SQLSTATEs with message text (`check_violation`, `insufficient_privilege`, `no_data_found`, `integrity_constraint_violation`, `foreign_key_violation`, `42501` for RLS).

**Two options:**

- **A (no schema change).** `pg-error.translator.ts` maps each (SQLSTATE, message prefix) pair to a code. A test scans every `RAISE EXCEPTION` in `database/migrations/*.up.sql` and fails if one has no mapping, so a new database error cannot silently become `INTERNAL`.
- **B (recommended; needs a migration, OD-1).** A forward migration replaces the functions so that every `RAISE` also carries `HINT = 'DOS:<CODE>'`. The translator then reads the hint first and falls back to A. Messages and behaviour stay unchanged; only a hint is added.

Either way, an unmapped database error is `500 INTERNAL`, never a guess.

---

## 6. API ↔ engine boundary

The API **orchestrates**; engines **calculate**. The API never re-implements a rule, dimension, quantity, price or validation.

| Endpoint | Load (repositories + `@lintel/persistence` mappers) | Engine call | Persist |
|---|---|---|---|
| `POST /design-versions/{id}/validation-runs` | design version + 12 pinned versions → `Versioned<T>` → engine inputs | `design-engine` validate (it calls rules, geometry, catalog and hettich engines internally) | `buildValidationRun` → `recordValidationRunArgs` → `SELECT design_os.record_validation_run(…)` |
| `POST /design-versions/{id}/bom` | same inputs | `design-engine` → `bom-engine` | `buildSnapshotRecord('BOM', …)` → INSERT `bom_snapshot` |
| `POST /design-versions/{id}/boq` | same | `bom-engine` → `boq-engine` (BOQ stays separate from BOM) | `boq_snapshot` |
| `POST /design-versions/{id}/pricing` | + pricing standard version | `boq-engine` → `pricing-engine` | `pricing_snapshot` |
| `POST /design-versions/{id}/quotations` | + quotation policy version | `pricing-engine` quotation build | `quotation_snapshot` (+ `revision_number`) |
| `POST /design-versions/{id}/drawings` | same | `drawing-engine` → SVG/PDF bytes | upload via FileService → `file_object` → `drawing_snapshot` + `drawing_snapshot_file` |
| `POST /design-versions/{id}/manufacturing-documents` | + manufacturing standard version (if pinned) | `manufacturing-engine` | `manufacturing_document_snapshot` (+ files) |

Rules:

1. **Load, compute and persist in one REPEATABLE READ transaction.** Before writing, the design version row is locked `FOR SHARE`. The engines are synchronous and in-process, and V1 has no background jobs. The snapshot therefore records exactly the inputs that were read, and a concurrent edit either waits or fails with `STALE_VERSION`.
2. **Engine results pass through unchanged.** Engine BLOCKERs and WARNINGs are returned as **data** (`200` / `201` with `messages[]`), not as errors. The only exception: `purpose = FOR_PRODUCTION` with BLOCKERs is refused before persisting, with `VALIDATION_BLOCKERS`, and the database refuses it again.
3. **`purpose` comes from the request** (`PRELIMINARY` default, or `FOR_PRODUCTION`). The provenance trigger decides whether it is allowed. The API never upgrades a purpose.
4. **Fingerprints.** `engine_version` and `engine_hash` come from `infrastructure/engines/engine-fingerprint.ts`: the package versions plus a hash of the engine build. Every run and snapshot stores them.
5. **The engine status view is one-way.** Engines see only `EngineCalculationStatus`, derived from `RecordLifecycleStatus` by the persistence mappers. The API returns the exact `RecordLifecycleStatus` to clients.
6. **No `TEST_FIXTURE` data is accepted.** Request schemas reject it. The database CHECKs reject it again.

---

## 7. API ↔ storage boundary

| Step | Behaviour |
|---|---|
| Upload (`POST /files`, multipart) | Request carries `sha256` + `contentType`. The service streams to memory (size cap per content type), recomputes SHA-256 via `@lintel/storage` `sha256Of`; mismatch → 422 `CHECKSUM_MISMATCH` before any provider call |
| Key | `buildStorageKey(org, kind, sha256)`: content-addressed, org-prefixed, validated by `assertValidStorageKey`. Clients never choose keys |
| Store | `provider.upload({ key, bytes, contentType, checksum })`; the provider verifies the checksum again. Re-uploading identical bytes is a no-op on the same key |
| Record | INSERT `file_object` (insert-only: provider id, key, content type, size, checksum, created_by) in the request transaction |
| Snapshot references | snapshots link to `file_object.id` through `*_snapshot_file`; the reference and the file are immutable, so a snapshot's files cannot change underneath it |
| Download / signed URL | `GET /files/{id}/url` → RLS decides visibility (`file_read` / `client_can_read_file`). The service returns `provider.signedUrl(key, { expiresInSeconds: 300, disposition })`. **The URL is never persisted**; only the key is |
| Verify | `download` re-verifies the checksum; a mismatch is logged as an integrity incident and returned as 500 `INTERNAL` |
| Delete | `DELETE /files/{id}` only for orphans: `FileService` refuses when any snapshot/issue link exists → 409 `FILE_REFERENCED`. Audited with a reason. There is no bulk delete and no sweeper (background jobs deferred) |
| Orphans | If the DB transaction rolls back after upload, the content-addressed object remains as an orphan. It is harmless, is reused on retry (same key), and can be deleted later |
| Providers | `MemoryStorageProvider` (unit/integration tests), `LocalFsStorageProvider` (local dev). `SupabaseStorageProvider` and `S3StorageProvider` are implemented behind the interface with contract tests against the memory provider's behaviour. They are **not configured for any hosted bucket** until the §13 gate |

---

## 8. Approval flow

`DRAFT → IN_REVIEW → APPROVED → LOCKED`, with `→ SUPERSEDED` happening automatically when a successor is approved.

**Exactly one endpoint changes lifecycle status:**

```http
POST /api/v1/{collection}/{versionId}/transitions
Idempotency-Key: <uuid>
If-Match: W/"<versionId>:<row_version>"
{ "action": "SUBMIT" | "REQUEST_CHANGES" | "APPROVE" | "LOCK",
  "reason": "…",                        // required, non-blank
  "expectedContentHash": "sha256:…" }   // required for APPROVE
```

- **What the service does:**
  1. Maps `{collection}` to the registry `subject_type` (21 subjects: 6 standards, 8 catalog items, 5 catalog versions, Hettich, design; see §11.1).
  2. Pre-checks the action and state for a precise error code.
  3. Checks If-Match against `row_version`.
  4. Calls `SELECT design_os.transition($subject, $id, $action, $reason, $expectedHash)`.
  5. Re-reads the version and returns `200` with the new status, the new ETag and the decision id.
- **Nothing else updates a lifecycle column.** Status, submitted/approved/superseded columns and `row_version` are excluded from the API role's column-level UPDATE grants (0011), and `guard_version_row` refuses lifecycle changes unless running as `design_os_owner` inside `transition()`. No DTO contains a writable `status`; Zod schemas for version PATCH bodies are `.strict()` and omit it.
- **`CHANGES_REQUIRED` is not a status (D2).** It is the `REQUEST_CHANGES` action; the version returns to DRAFT and the decision is recorded.
- **LOCK of a design version** cascades through `lock_cascade` to every pinned version, catalog member and recipe. Issue endpoints (`POST /quotation-snapshots/{id}/issue`, `POST /drawing-snapshots/{id}/issue`) run in one transaction:
  1. `transition('design', dv, 'LOCK', reason)` if the version is APPROVED (skipped if already LOCKED);
  2. INSERT `quotation_issue` / `drawing_issue`; `check_issue` verifies LOCKED, 0 BLOCKERs and a snapshot of the locked content.
- **Read-only approval views:** `GET /approval-requests?status=OPEN` and `GET /{collection}/{id}/decisions`.

---

## 9. Security

| Topic | Plan |
|---|---|
| RLS is final | Every statement runs as `design_os_api` under RLS with default deny. The API never connects as `design_os_owner`, `postgres` or `service_role` |
| API first | Guard (action) → service (scope, state, D8, If-Match) → only then domain SQL. The single earlier read is the context load of §2.1 |
| SECURITY DEFINER | Only the existing functions: `transition`, `record_validation_run`, integrity/audit triggers and RLS helpers, all with fixed `search_path` and their own membership/permission checks. The API adds none. Any new definer function (OD-5) needs review and a test that it re-checks `current_org_id()` and `has_permission()` |
| Roles | `design_os_owner` owns objects (migrations only). `design_os_api` (NOLOGIN) is assumed by the API's login role via `SET LOCAL ROLE`; local/CI tests create that login role in the harness, and on hosted Supabase it is part of gate item 9. Credentials come from environment configuration, never from the repository |
| Audit | Every audited table writes the hash-chained `audit_log` with actor, `request_id` and `reason`. The API guarantees `design_os.request_id` on every write and `design_os.reason` for transitions, revocations, role-grant changes and deletes. `GET /audit/verify` (ADMIN, `audit.read`) runs `verify_audit_chain(org)` |
| Client isolation | CLIENT identities see only `/portal/**`: issued quotations and drawings of projects where they are an ACTIVE `project_member` whose contact belongs to the project's client. Draft, cost, BOM, production drawings, approvals and audit are never reachable; RLS enforces the same. Unknown or foreign project ids → 404 |
| Internal vs client | Separate route families, `identity_kind` check, CLIENT role limited to `output.read.issued` by the database CHECK |
| Input safety | Zod `.strict()` everywhere; UUID/enum/size limits; parameterised SQL only; request body size limits in Fastify; no user-controlled SQL identifiers (the `{collection}` → subject map is a fixed allow-list) |
| Transport and headers | HTTPS only in deployment; CORS allow-list of the web, admin and portal origins; `Cache-Control: no-store` on authenticated responses; no tokens in query strings |
| Rate limits | `@fastify/rate-limit` per user for auth-sensitive portal routes (OTP linking) |
| Secrets | Supabase JWT secret/JWKS URL, DB URL and storage keys are all read from the environment; none is exposed in `/openapi.json` or errors |

---

## 10. Test strategy

All database-backed tests run against **local/CI PostgreSQL 17** (the existing `db` CI job), with migrations applied up/down/up. Each test runs inside a transaction that is rolled back; the teardown row check stays.

| Layer | What | How |
|---|---|---|
| Unit | services with fake repositories/engines, ETag helpers, idempotency fingerprinting, problem mapping, translator | Vitest, no DB |
| Schema validation | every request schema: valid samples pass; unknown keys, `status` writes, org/user ids in bodies, TEST_FIXTURE and bad UUIDs fail | Vitest table tests |
| Error contract | a static test: every code in §5.2 is producible and every `RAISE EXCEPTION` in the migrations is mapped (§5.3) | Vitest + file scan |
| Authorization | per route, every role: allowed vs 403, derived from the seeded `default_role_permission` so the matrix and tests cannot drift | Fastify `inject` + PG17 |
| RLS without API | the same forbidden operations with the API guard bypassed still fail at the database | direct `design_os_api` connection |
| Tenant isolation | two orgs; every id-taking route with the other org's id → 404 `NOT_FOUND`; the log carries `TENANT_ISOLATION` | inject + PG17 |
| Client isolation | CLIENT: only issued outputs of assigned projects; revoked contact/member → next request 403/404; no internal route reachable | inject + PG17 |
| Lifecycle | every allowed and forbidden transition through the endpoint; D8; FINANCE-only approvals; COSTING cannot approve; LOCK cascade visible; SUPERSEDE only via APPROVE | inject + PG17 |
| Concurrency | two writers with the same If-Match → one 200, one 412; generation racing an edit → consistent snapshot or 412 | parallel connections |
| Idempotency | replay returns the identical response; fingerprint change → 422; in-flight → 409; rollback leaves no key | inject + PG17 (after OD-2) |
| Provenance | generated snapshots carry exact pins; tampered pins → `PROVENANCE_MISMATCH`; FOR_PRODUCTION on DRAFT → refused; issue before LOCK → refused | inject + PG17 |
| Validation runs | stale input hash/revision → 409; newer blocked run overrides; runs only via the endpoint | inject + PG17 |
| Storage | checksum mismatch, referenced-file delete refusal, signed URL expiry, adapter contract suite | memory/local providers |
| Integration (vertical slice) | synthetic test-only world: project → room → design → run → submit → approve → BOM/BOQ/pricing/quotation/drawing → lock → issue → client reads issued quotation | inject + PG17 |

Synthetic values stay in the existing marked test-only support module under `tests/db`, are rolled back, and remain covered by `synthetic-data-isolation.test.ts` (API integration tests that need them live under `tests/db` too).

---

## 11. Proposed endpoints and schemas (`/api/v1`)

### 11.1 Endpoints

**Identity and organization**

| Method & path | Action | Notes |
|---|---|---|
| `GET /me` | (authenticated) | principal, memberships, effective permissions |
| `GET /organization` | (member) | current org |
| `GET /memberships` · `POST /memberships` · `PATCH /memberships/{id}` | `org.members.manage` | invite internal user, change role, suspend; If-Match |
| `GET /role-permissions` · `PUT /role-permissions/{role}` | `org.role_permissions.manage` | reason required; FINANCE/CLIENT CHECKs apply |

**Clients and projects**

| Method & path | Action |
|---|---|
| `GET /clients` · `POST /clients` · `GET/PATCH /clients/{id}` | `client.read` / `client.write` |
| `GET /clients/{id}/contacts` · `POST /clients/{id}/contacts` (invite, Idempotency-Key) · `POST /client-contacts/{id}/revoke` (reason) | `client.read` / `client.write` |
| `GET /projects` · `POST /projects` · `GET/PATCH /projects/{id}` | scope / `project.write` |
| `GET /projects/{id}/members` · `POST /projects/{id}/members` · `POST /project-members/{id}/revoke` | `project_members.assign` |

**Rooms and designs**

| Method & path | Action |
|---|---|
| `GET /projects/{id}/rooms` · `POST /projects/{id}/rooms` · `GET /rooms/{id}` | scope / `room.survey.write` |
| `GET /rooms/{id}/revisions` · `POST /rooms/{id}/revisions` (insert-only) | scope / `room.survey.write` |
| `GET /rooms/{id}/designs` · `POST /rooms/{id}/designs` · `GET/PATCH /designs/{id}` | scope / `design_version.author` |
| `GET /designs/{id}/versions` · `POST /designs/{id}/versions` `{ basedOn? , pins }` | `design_version.author` |
| `GET /design-versions/{id}` · `PATCH /design-versions/{id}` (pins; DRAFT; If-Match) | scope / `design_version.author` |
| `GET/POST /design-versions/{id}/objects` · `PATCH/DELETE /design-objects/{id}` (DRAFT; parent If-Match) | `design_version.author` |
| `GET/POST /design-versions/{id}/overrides` · `DELETE /relationship-overrides/{id}` (DRAFT; parent If-Match) | `design_version.author` |

**Validation and outputs**

| Method & path | Action |
|---|---|
| `POST /design-versions/{id}/validation-runs` (Idempotency-Key) · `GET /design-versions/{id}/validation-runs` | `output.generate.engineering` / scope |
| `POST /design-versions/{id}/bom` · `/boq` · `/drawings` · `/manufacturing-documents` `{ purpose }` | `output.generate.engineering` |
| `POST /design-versions/{id}/pricing` · `/quotations` `{ purpose }` | `output.generate.commercial` |
| `GET /design-versions/{id}/snapshots?kind=` · `GET /snapshots/{kind}/{id}` | `output.read.production` / `output.read.cost` |
| `POST /quotation-snapshots/{id}/issue` · `POST /drawing-snapshots/{id}/issue` | `quotation.issue` / `drawing.issue` |

**Reference data** (one generic controller per family, driven by the fixed subject allow-list)

| Method & path | Action |
|---|---|
| `GET /{collection}` · `POST /{collection}` (entity) · `GET /{collection}/{entityId}` | `reference.read` / `<subject>.author` |
| `GET /{collection}/{entityId}/versions` · `POST /{collection}/{entityId}/versions` `{ basedOn? }` | `reference.read` / `<subject>.author` |
| `GET/PATCH /{collection}/{entityId}/versions/{versionId}` (DRAFT; If-Match) | `reference.read` / `<subject>.author` |
| content sub-resources: `…/values`, `…/rules` (edge band, hardware), `…/rate-lines`, `…/tax-rates`, `…/tax-mappings`, `…/members` (catalog versions), `…/articles`, `…/calculation-rules` (Hettich) | same |

Collections:

- **Standards:** `construction-standards`, `planning-standards`, `edge-band-standards`, `manufacturing-standards`, `pricing-standards`, `quotation-policies`.
- **Catalog items:** `materials`, `edge-bands`, `finishes`, `hardware-items`, `hardware-rule-sets`, `appliances`, `recipes`, `products`.
- **Catalog versions:** `material-catalogs`, `finish-catalogs`, `hardware-catalogs`, `appliance-catalogs`, `product-catalogs`.
- **Hettich:** `hettich-datasets`.

Mapping: each maps 1:1 to a registry `subject_type`; `design-versions` maps to `design`.

**Approvals, files, audit, portal**

| Method & path | Action |
|---|---|
| `POST /{collection}/{versionId}/transitions` (incl. `design-versions`) | registry author/approve action; LOCK per §8 |
| `GET /approval-requests` · `GET /{collection}/{versionId}/decisions` | `reference.read` or scope |
| `POST /files` · `GET /files/{id}` · `GET /files/{id}/url` · `DELETE /files/{id}` (orphans; reason) | generating action / RLS visibility |
| `GET /audit?table=&rowId=` · `GET /audit/verify` | `audit.read` |
| `POST /portal/session/link` · `GET /portal/projects` · `GET /portal/projects/{id}/quotations` · `GET /portal/projects/{id}/drawings` · `GET /portal/files/{id}/url` | CLIENT; `output.read.issued` |

### 11.2 Schemas (Zod, `apps/api/src/modules/*/…schemas.ts`)

| Group | Schemas |
|---|---|
| Common | `Uuid`, `Sha256Hash` (`sha256:` + 64 hex), `LifecycleStatus` (5 values, response only), `TransitionAction`, `Reason` (trimmed, 1–2000), `Purpose`, `Pagination` (`limit` ≤ 200, opaque `cursor`), `Problem`, `ETag` |
| Envelope | `VersionEnvelope` response: `entityId`, `versionId`, `versionNumber`, `status`, `source`, `createdBy`, `createdAt`, `submittedBy`, `approvedBy`, `approvedAt`, `effectiveFrom`, `supersededBy`, `contentHash`, `rowVersion` |
| Tenancy | `MeResponse`, `MembershipCreate/Update/Response`, `RolePermissionsPut` (`actions[]`, `reason`) |
| Clients/projects | `ClientCreate/Update/Response` (with `opsClientRef` text only), `ContactInvite/Response`, `ProjectCreate/Update/Response` (`opsProjectRef`, `opsLeadRef` text only), `ProjectMemberAssign/Response` |
| Rooms/designs | `RoomCreate/Response`, `RoomRevisionCreate/Response`, `DesignCreate/Response`, `DesignVersionCreate` (`basedOn?`, `pins`), `DesignVersionPins` (the 12 pins; nullable ones optional), `DesignVersionResponse` (+ `inputHash`, `inputRevision`), `DesignObjectCreate/Update/Response`, `RelationshipOverrideCreate/Response` |
| Reference data | per domain `…VersionContentUpdate` and `…Response` generated from the `@lintel/persistence` mapper types (no duplicate domain model), `CatalogVersionMembers`, `HettichArticle`, `HettichCalculationRule` (source URL must pass the official-URL rule) |
| Validation/outputs | `ValidationRunResponse` (counts, messages, engine fingerprint), `GenerateSnapshotRequest` (`purpose`), `SnapshotResponse` (kind, provenance: 12 pins + design version status and content hash, engine fingerprint, payload, files), `IssueRequest` (`reason`), `IssueResponse` |
| Approvals | `TransitionRequest` (`action`, `reason`, `expectedContentHash?`, required for APPROVE via refinement), `TransitionResponse`, `ApprovalRequestResponse`, `DecisionResponse` |
| Files | `FileUploadFields` (`sha256`, `contentType` allow-list, `kind`), `FileResponse`, `SignedUrlResponse` (`url`, `expiresAt`) |
| Audit | `AuditEntryResponse`, `AuditVerifyResponse` |

Monetary values are integer paise, matching the schema, and are serialised as strings when they exceed 2^53. Dimensions are integer millimetres. Neither is ever computed in the API.

---

## 12. Open decisions for review

| # | Decision | Recommendation |
|---|---|---|
| OD-1 | Machine-readable database error codes | **B:** a forward migration adding `HINT = 'DOS:<CODE>'` to every `RAISE`, with no behaviour change, plus translator fallback A |
| OD-2 | Idempotency storage | A forward migration adding `design_os.idempotency_record` (org, actor, key, fingerprint, status, response, created_at, expires_at). RLS: own actor within the org. It is excluded from the audit chain, like other operational tables, via `unaudited_tables()` |
| OD-3 | ETag for non-versioned mutable tables | Row-hash ETags now (no migration). Alternatively, add a `row_version` column in the OD-1/OD-2 migration |
| OD-4 | Manufacturing release | The database has `manufacturing.release` (it can LOCK) but no `manufacturing_release` record. Proposal: in V1, release = LOCK + FOR_PRODUCTION `manufacturing_document_snapshot`, and a dedicated release/issue table is deferred together with manufacturing production standards |
| OD-5 | Client first sign-in linking | A SECURITY DEFINER `link_client_contact()` that matches the verified JWT email to an ACTIVE invited contact, versus pre-creating the auth user at invite time. This is needed before the portal is enabled (gate item 8) |
| OD-6 | Pagination | Keyset cursors over `(created_at, id)`, `limit` ≤ 200 |

Explicitly **deferred**:

- UI (web, admin, portal, mobile);
- hosted Supabase (any project, bucket, migration or JWT configuration);
- the production Hettich import;
- production pricing and rates;
- manufacturing production standards (the registry stays empty);
- Redis and BullMQ;
- background jobs (including the orphan sweeper and the scheduled audit verifier);
- ops database synchronisation (ops references stay text only, D7).

## 13. Proposed Step 4 commit sequence (after approval)

1. `feat(api): skeleton`. NestJS + FastifyAdapter, `/api/v1`, Standard Schema pipe, problem filter, request id, unit of work, JWT guard with a test issuer, `GET /me`, ESLint boundaries.
2. `feat(db): error hints + idempotency_record` (only if OD-1 and OD-2 are approved). A forward migration with rollback, drift snapshot and database tests.
3. `feat(api): tenancy, clients, projects, rooms`. Includes authorization, tenant and client-isolation suites.
4. `feat(api): reference data + transitions`. Includes lifecycle, D8, FINANCE and LOCK suites.
5. `feat(api): designs, validation runs, snapshots, issues, files`. Includes provenance, concurrency, idempotency and storage suites, plus the vertical-slice integration test.
6. `docs: ADR-0009 persistence, approval and storage`.

Each commit is local/CI only (PG17 + memory/local storage) and stops for review per the milestone rules.
