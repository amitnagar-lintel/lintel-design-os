# M5 Step 4: API Foundation (architecture plan)

Status: **APPROVED with decisions OD-1 to OD-6 and the tenant-context correction (§2.1).** This revision records those decisions and the final implementation sequence (§13). It is still a plan: no API code, no migrations and no hosted Supabase work are part of this document.

Inputs:

- `M5-TECHNICAL-DESIGN.md`: §7 tenancy, §8 API structure, §9 authorization, §12 storage, §13 gate.
- Migrations 0001–0011, merged in PR #6. The database contract below is the one those migrations enforce.

Where this plan needs something the schema does not yet provide, §12 records the approved decision and §13 the migration that delivers it. Migrations 0001–0011 are never edited; every change is a new forward migration with a tested rollback.

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
    http/idempotency.ts                 Idempotency-Key handling inside the unit of work (§4.3)
    http/pagination.ts                  keyset cursor encode/decode (§4.5)
    auth/jwt.guard.ts                   verifies the Supabase JWT → Principal { userId }
    auth/org-context.ts                 membership verification → authorized org context (§2.1)
    auth/request-context.ts             per-request context: principal, org, identity kind, role, permissions, requestId
    auth/permission.guard.ts            @RequiresAction('design_version.author') metadata → 403 before any domain query
    db/unit-of-work.ts                  one transaction per request; sets claims, request id and reason (§2.2)
    db/pg-error.translator.ts           SQLSTATE (+ constraint name for built-in errors) → problem code (§5.3); never message text
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

### 2.1 Establishing identity and the authorized org context

**The authenticated identity is the authority. `X-Org` is only a selector, never proof of access.** The API never sets an org context it has not first verified against the identity's ACTIVE memberships.

```text
1. Authenticate        JwtGuard: Authorization: Bearer <Supabase access token>
                       verify signature (JWKS or HS256 secret), iss, aud = "authenticated", exp → userId = sub
                       failure → 401 AUTH_REQUIRED (no database access at all)
2. Verify membership   inside the request transaction, claims = {"sub": userId} only (no org yet):
                       SELECT * FROM design_os.current_memberships()     -- 0013, SECURITY DEFINER, own rows only
                       → ACTIVE memberships of this identity (org_id, role, identity_kind), ACTIVE user only
3. Select org          X-Org present   → it must be one of those org ids
                       X-Org absent    → allowed only when exactly one membership exists
                       no membership / X-Org not a membership → 403 ORG_ACCESS_DENIED
                       several memberships and no X-Org        → 400 ORG_SELECTION_REQUIRED
                       The response is identical whether or not the org or any resource exists.
4. Establish context   claims = {"sub": userId, "org_id": <verified org>} (set_config, transaction-local)
                       SELECT design_os.current_org_id() must equal the verified org (defence in depth;
                       a mismatch — e.g. membership revoked mid-request — is 403 ORG_ACCESS_DENIED)
                       load identity_kind, role and permissions for that org into the request context
5. Authorize           PermissionGuard: route action ∈ context.permissions, else 403 PERMISSION_DENIED.
                       Runs BEFORE any domain query (steps 2–4 read only the caller's own membership).
6. Scope               service: can_access_project(project_id) → otherwise 404 NOT_FOUND
                       (other tenants' and unassigned projects are indistinguishable from missing ones)
7. State               service: lifecycle state, LOCKED, D8, If-Match, pins (§4, §8)
8. Execute             repositories / SECURITY DEFINER functions under the verified org context
9. RLS                 re-checks org, permission and project scope on every statement (final boundary)
```

- `current_memberships()` is the one new helper this step needs, because `org_membership` RLS reads only the current org's rows, so the API cannot list an identity's memberships without first choosing an org. It returns only the caller's own ACTIVE memberships. It is delivered by migration 0013 (§13) and is tested against another user's memberships, suspended memberships and suspended users.
- **The client never supplies an org, role, permission or user id in the body.** Any such field is rejected by the Zod schema (`.strict()`).
- **Identity kind is fixed per route family.**
  - `/api/v1/portal/**` accepts only `identity_kind = CLIENT`.
  - Every other route requires `INTERNAL`.
  - A mismatch returns 403 `IDENTITY_KIND_MISMATCH`. This matches D10: a CLIENT holds only the CLIENT role, enforced by the `guard_membership_identity` trigger.
- **No cross-request caching of memberships or permissions.** Revoking a membership, client contact or project member takes effect on the next request (D10).
- **Client first sign-in** uses the invitation model in §2.4 (OD-5, designed now, implemented with the client portal).

### 2.2 The request transaction (unit of work)

Every request, including reads, runs in exactly one transaction on a pooled connection (compatible with the Supavisor transaction pooler):

```sql
BEGIN;  -- READ COMMITTED; snapshot/generation endpoints use REPEATABLE READ (§6)
SET LOCAL ROLE design_os_api;                                   -- RLS-subject role; never the owner
SELECT set_config('request.jwt.claims', '{"sub":…}', true);      -- step 2: identity only
SELECT * FROM design_os.current_memberships();                  -- steps 2–3: verify membership
SELECT set_config('request.jwt.claims', '{"sub":…,"org_id":…}', true);  -- step 4: verified org only
SELECT set_config('design_os.request_id', $requestId, true);    -- audit_log.request_id
SELECT set_config('design_os.reason', $reason, true);           -- only when the request carries a reason
... idempotency claim (§4.3), guards, repositories, SECURITY DEFINER calls ...
COMMIT;  -- or ROLLBACK on any error; the idempotency record commits or rolls back with the effect
```

- `request.jwt.claims` is the only way RLS learns who is acting. It is built from the verified JWT and the **membership-verified** org, never from the raw header or the request body.
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

### 2.4 Client invitation model (OD-5: designed now, implemented with the client portal)

The client portal is **not switched on in Step 4**. No invitation table, function or endpoint is built until the portal step, and gate item 8 still applies. The design is fixed now so the portal step does not reopen it.

| Requirement | Design |
|---|---|
| One-time token | 32 bytes from a CSPRNG, base64url-encoded. It is delivered only inside the invitation link sent to the contact's email |
| Store only a hash | `client_invitation.token_hash = sha256(token)`. SHA-256 is sufficient because the token is 256-bit random, not a password. The raw token is never stored, logged, audited or returned by any API |
| Short expiry | `expires_at = created_at + 24 h` (configurable, capped at 72 h). A re-invite revokes the previous open invitation and issues a new one |
| Binding | the row binds `org_id`, `client_id`, `client_contact_id` (status INVITED, no `user_id` yet), `project_id`, the invited email and `created_by`, the staff member holding `client.write` and `project_members.assign` (composite tenant FKs). Nothing grants access before consumption: `project_member.user_id` is NOT NULL, so no project membership can exist until the client identity exists |
| Atomic consumption | a SECURITY DEFINER `consume_client_invitation(p_token_hash)` runs one `UPDATE … SET consumed_at = now(), consumed_by = current_user_id() WHERE token_hash = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING …`. In the same transaction it checks that the verified JWT email equals the invited email and the identity is CLIENT. It then links `client_contact.user_id`, sets the contact ACTIVE, creates the CLIENT `org_membership` and inserts the bound `project_member`, with `granted_by` set to the inviting staff member. The existing identity and project-member triggers still run. Any failure rolls back the whole consumption |
| Replay / expiry | a consumed, revoked, expired or unknown token all return the same `410 INVITATION_INVALID`, so the response is not an oracle for which case applied. Consumption is rate-limited per IP and per identity |
| No raw tokens in logs | the token travels in the request body (`POST /portal/invitations/accept { token }`), never in a URL the API logs. The Fastify logger redacts `token`, `authorization` and cookie fields. Audit rows contain `token_hash` only |
| Supabase Auth | sign-up stays disabled on the client route. How the auth user is provisioned for the first OTP sign-in (pre-created at invite through the server-side Admin API, or created on acceptance) is decided at the portal step against the hosted configuration (gate item 8) |

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

### 4.1 ETag / If-Match (OD-3)

| Resource class | ETag value | Source |
|---|---|---|
| Version rows (all 21 registry subjects incl. `design_version`) | `W/"<id>:<row_version>"` | `row_version` is bumped by `guard_version_row` on every UPDATE, including lifecycle changes and, for design versions, `input_revision` bumps caused by object/override edits |
| **DesignVersion and its children** (objects, overrides, pins) | the **design version** ETag | Any child change bumps the parent's `input_revision` and therefore its `row_version`. This whole-draft token stays the only concurrency authority for a design version. Child rows have no ETag of their own |
| Mutable non-versioned rows: `client`, `client_contact`, `project`, `project_member`, `org_membership`, `design` | `"sha256:<hex>"` over the record's **canonical representation** | see below |
| Insert-only rows (snapshots, room revisions, runs, issues, files, audit) | strong `"<content_hash>"` | never change, so no If-Match needed |

**Canonical representation for hash-based ETags (V1):**

- A per-table, explicit, ordered **allow-list of mutable columns** plus `id` and `org_id`. It never includes `SELECT *`, so adding a column never silently changes existing ETags.
- Values are normalised before hashing:
  - timestamps → UTC RFC 3339 with microseconds;
  - uuids → lowercase;
  - `bigint`/`numeric` → decimal strings;
  - `NULL` → JSON `null`;
  - text is not trimmed.
- It is serialised with `stableStringify` from `@lintel/types` (lexicographically sorted keys, no whitespace) and hashed with `contentHash` from `@lintel/persistence`. Key order in the JavaScript object or the `pg` row is therefore irrelevant.
- Golden tests pin the canonical string and hash for one fixed row per table, so any change to the representation is visible in review.

**Rules:**

- **Every write to an existing mutable resource requires `If-Match`.**
  - A missing header returns 428 `PRECONDITION_REQUIRED`.
  - A mismatch returns **412 `STALE_VERSION`**. The problem body includes the current ETag.
- **The read-then-write gap is closed in the database.**
  - Version rows: `UPDATE … WHERE id = $1 AND row_version = $2`; zero rows updated → 412.
  - Hash-ETag rows: `SELECT … FOR UPDATE`, recompute the canonical hash, compare, then update in the same transaction.
- **LOCKED (and any non-DRAFT) records reject mutation regardless of ETag.** The service checks lifecycle state **before** comparing the ETag, so a correct ETag on a LOCKED record still returns 409 `RECORD_LOCKED`, and a non-DRAFT one returns 409 `RECORD_NOT_EDITABLE`. The database triggers raise the same codes (§5.3) even if the service check were bypassed.
- Creates return `201` with `Location` and `ETag`.

### 4.2 Content hashes

- `content_hash` on versions is recomputed by the service through `@lintel/persistence` (`contentHash` / mappers) on every DRAFT content write and stored with the same statement.
- The database stores it; `transition(APPROVE)` requires `expectedContentHash` to equal it. The approver must send the hash of **what they reviewed**; a stale review → 409 `CONTENT_HASH_MISMATCH`.
- For design versions, `input_hash` is recomputed with `designInputHash` after every object/override/pin change in the same transaction. The database independently bumps `input_revision`, so a run for an out-of-date hash or revision is never accepted (`validation-run.test.ts`).

### 4.3 Idempotency (OD-2)

**Table `design_os.idempotency_record`** (migration 0013):

| Column | Type / rule |
|---|---|
| `id` | uuid PK |
| `org_id` | uuid NOT NULL, FK organization |
| `idempotency_key` | text NOT NULL, 16–128 visible ASCII characters (clients send a UUID) |
| `scope` | text NOT NULL, the operation id from a fixed allow-list, e.g. `transition`, `validation_run.record`, `snapshot.generate.bom`, `snapshot.generate.boq`, `snapshot.generate.pricing`, `snapshot.generate.quotation`, `snapshot.generate.drawing`, `snapshot.generate.manufacturing_document`, `issue.quotation`, `issue.drawing`, `file.upload`, `client_contact.invite` |
| `actor_user_id` | uuid NOT NULL, FK app_user |
| `request_hash` | text NOT NULL, `sha256:` over the canonical request: actor, method, route template, path params, canonical body (`stableStringify`), and for uploads the declared file checksum |
| `status` | text NOT NULL CHECK IN (`IN_PROGRESS`, `COMPLETED`) |
| `response_status` | smallint NULL until completed |
| `response_body` | jsonb NULL, the stored response for small responses (≤ 64 KiB; same no-TEST_FIXTURE CHECK as snapshots) |
| `resource_type`, `resource_id` | text / uuid NULL, the **durable response reference**. Used for replay when the body is not stored, e.g. a large snapshot response is re-read from the immutable snapshot |
| `created_at`, `completed_at`, `expires_at` | timestamptz; `expires_at = created_at + 24 h` |
| Uniqueness | **`UNIQUE (org_id, scope, idempotency_key)`** |
| Checks | `COMPLETED` ⇒ `response_status` set and (`response_body` or `resource_id`) present |
| Access | RLS: `org_id = current_org_id() AND actor_user_id = current_user_id()` for SELECT/INSERT/UPDATE. Column UPDATE grant only on `status`, `response_*`, `resource_*`, `completed_at`. No DELETE grant. Excluded from the audit chain via `unaudited_tables()` because the effect itself is audited |

**Behaviour.** The record is claimed in the same transaction as the effect, before the effect runs:

1. **First request executes once.** `INSERT … (status IN_PROGRESS)`, then the operation, then `UPDATE … SET status = COMPLETED, response_* …`, then COMMIT. Record and effect commit together or roll back together.
2. **Retry with the same key and identical request.** The insert conflicts on the unique key. The API reads the committed record and **replays the original response** (status, body, `ETag`, `Location`) with `Idempotent-Replayed: true`. The operation does not run again.
3. **Same key, different `request_hash`** → **`409 IDEMPOTENCY_CONFLICT`**. This includes a different actor, route or body.
4. **Concurrent duplicate.** The second insert waits on the unique index until the first transaction ends:
   - first committed → replay (rule 2);
   - first rolled back → the second executes as the first;
   - `lock_timeout` (5 s) exceeded → `409 IDEMPOTENCY_IN_PROGRESS` (retryable).

   **The operation can never execute twice.**
5. **Failures are not stored.** A 4xx/5xx rolls back the claim with the effect, so the same key may retry. This is safe because nothing executed.
6. **Expired records.** An expired record (`expires_at < now()`) is replaced atomically by the new claim. There is no sweeper, because background jobs are deferred.

**Where it is required** (missing header → 428 `PRECONDITION_REQUIRED`):

- transitions;
- validation runs;
- every output generation;
- quotation/drawing issue and manufacturing release (§8);
- file upload;
- client-contact invite.

It is optional on other creates.

**File uploads.** Storage bytes are written before the database commit, under a content-addressed key. A replay after commit returns the stored `file_object`. A retry after a rollback re-uploads identical bytes to the same key, which is a no-op.

### 4.4 LOCKED, SUPERSEDED and other non-DRAFT records

| Attempt | Response |
|---|---|
| Edit content of an IN_REVIEW / APPROVED / SUPERSEDED version | 409 `RECORD_NOT_EDITABLE`, whatever the ETag |
| Edit content of a LOCKED version, or anything a LOCKED version freezes (catalog membership, recipe, dependency content) | 409 `RECORD_LOCKED`, whatever the ETag |
| Change a design version's pins or objects after DRAFT | 409 `RECORD_NOT_EDITABLE` / `RECORD_LOCKED` |
| Delete a version, snapshot, run, issue, decision or audit row | no route exists; the database also forbids it (`RECORD_IMMUTABLE`) |
| Change a LOCKED design | create a new design version (`POST /designs/{id}/versions` with `basedOn`), which starts in DRAFT |

### 4.5 Pagination (OD-6)

- **Cursor-based only.** Primary collections never use offset pagination.
- `limit`: default 50, **maximum 200**; a larger value → 400 `VALIDATION_FAILED`.
- **Deterministic, unique order:** `ORDER BY created_at DESC, id DESC`, with keyset predicate `(created_at, id) < ($1, $2)`. Collections ordered by something else append `id` as the final tiebreaker. An index backs each ordering.
- The cursor is opaque: base64url of `{ v: 1, createdAt, id, sort }`, HMAC-signed with a server key so it cannot be forged into another ordering. Invalid, tampered or foreign cursors → 400 `INVALID_CURSOR`.
- A cursor carries no authorization. Every page is re-filtered by RLS under the current org context, so a cursor from another org or user reveals nothing.
- Response: `{ items, nextCursor | null }`. There is no total count on primary collections.

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

The `SQLSTATE` column lists the database code (§5.3) where the database can raise the same condition. A dash means the API alone raises it.

| Code | HTTP | SQLSTATE | Raised by |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | LD020, 23514, 23502 | Zod schema (Standard Schema pipe), `errors[]` lists fields; missing reason; unknown action/subject; CHECK / NOT NULL constraints |
| `INVALID_CURSOR` | 400 | — | malformed, tampered or foreign pagination cursor |
| `ORG_SELECTION_REQUIRED` | 400 | — | several ACTIVE memberships and no `X-Org` |
| `AUTH_REQUIRED` | 401 | — | missing/invalid/expired JWT |
| `ORG_ACCESS_DENIED` | 403 | LD002 | the identity has no ACTIVE membership in the requested org, or the membership was revoked mid-request. The same response whether or not the org exists |
| `IDENTITY_KIND_MISMATCH` | 403 | LD003 | CLIENT on an internal route or definer function; INTERNAL on a portal route |
| `PERMISSION_DENIED` | 403 | LD001, 42501 | guard (action missing), definer permission check, RLS / grant refusal |
| `SEPARATION_OF_DUTIES` | 403 | LD004 | D8: approver or reviewer is the submitter |
| `NOT_FOUND` | 404 | LD005 | missing, **or in another tenant, or outside the caller's project scope**. Tenant isolation is deliberately indistinguishable from absence; when the service can tell (definer "not found in this organization"), the log line carries `TENANT_ISOLATION` as a security event, never the response |
| `LIFECYCLE_TRANSITION_REJECTED` | 409 | LD006 | action not allowed from the current status, SUPERSEDE requested directly, newer version already effective, LOCK of a dependency in an unlockable state |
| `CONTENT_HASH_MISMATCH` | 409 | LD007 | `expectedContentHash` ≠ stored content hash on APPROVE |
| `DEPENDENCY_NOT_APPROVED` | 409 | LD008 | approval refused because a pinned / member / recipe dependency is not APPROVED or LOCKED; `context.problems[]` |
| `APPROVAL_PRECONDITIONS_FAILED` | 409 | LD009 | domain completeness (empty rule set, NULL rates, unverified Hettich data, empty manufacturing registry…); `context.problems[]` |
| `VALIDATION_RUN_REQUIRED` | 409 | LD010 | SUBMIT with no run for the current `input_hash` + `input_revision` |
| `VALIDATION_BLOCKERS` | 409 | LD011 | approval, FOR_PRODUCTION generation, issue or release with BLOCKERs > 0; `context.blockerCount` |
| `VALIDATION_INPUT_MISMATCH` | 409 | LD012 | recording a run whose `input_hash` differs from the current inputs, or a run for a version past review |
| `RECORD_NOT_EDITABLE` | 409 | LD013 | content write on an IN_REVIEW / APPROVED / SUPERSEDED version, whatever the ETag |
| `RECORD_LOCKED` | 409 | LD014 | write touching a LOCKED record or what it freezes, whatever the ETag |
| `RECORD_IMMUTABLE` | 409 | LD015 | update/delete of an insert-only record or deletion of a version |
| `PROVENANCE_MISMATCH` | 409 | LD016 | `check_snapshot_provenance` rejects the snapshot; `context.problems[]` |
| `ISSUE_PRECONDITIONS_FAILED` | 409 | LD017 | `check_issue`: design not LOCKED, BLOCKERs, snapshot not of the locked content; release guards (§8) |
| `MEMBERSHIP_RULE_VIOLATION` | 409 | LD018 | role ↔ identity-kind rules, contact ↔ CLIENT identity, project member ↔ client contact |
| `INVALID_REFERENCE` | 422 | LD019, 23503 | referenced row missing or in another org (composite tenant FK), recipe/room-revision/product-catalog membership rules, rows moved between versions |
| `DUPLICATE_RESOURCE` | 409 | 23505 | unique business key already used (e.g. entity code) |
| `STALE_VERSION` | 412 | — | If-Match mismatch / zero-row guarded update |
| `PRECONDITION_REQUIRED` | 428 | — | missing `If-Match` or `Idempotency-Key` where required |
| `IDEMPOTENCY_CONFLICT` | 409 | — | same `(org, scope, key)` with a different request hash |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | 55P03 (while claiming) | the same key is still executing past `lock_timeout`; retryable |
| `CONCURRENT_MODIFICATION` | 409 | 40001, 40P01, 55P03 | serialization failure / deadlock / lock timeout; retryable with the same Idempotency-Key |
| `CHECKSUM_MISMATCH` | 422 | — | uploaded bytes do not match the declared SHA-256 |
| `FILE_REFERENCED` | 409 | — | delete of a file referenced by a snapshot or issue |
| `INVITATION_INVALID` | 410 | (portal step) | unknown, expired, revoked or consumed invitation (§2.4); not built in Step 4 |
| `DATABASE_UNAVAILABLE` | 503 | 08xxx, 57P01–57P03 | connection loss or shutdown; retryable |
| `INTERNAL_DATABASE_ERROR` | 500 | anything else, incl. LD9xx | unexpected database error. The response has **no** SQL, message, constraint, table or SQLSTATE; the full error is logged under `requestId` |
| `INTERNAL` | 500 | — | any other unexpected error (never leaked) |

### 5.3 Database error codes (OD-1)

**Production API behaviour never depends on database message text.** Messages stay human-readable for logs and existing tests, but the translator never reads them.

**Migration 0012 (`error_codes`) delivers:**

1. **A dedicated SQLSTATE class `LD`** ("Lintel Design"). PostgreSQL defines no `L*` class. Every `RAISE EXCEPTION` in a `design_os` function or trigger gets a specific `ERRCODE = 'LDnnn'` in place of today's generic SQLSTATEs (`check_violation`, `insufficient_privilege`, `integrity_constraint_violation`, `foreign_key_violation`, `no_data_found`, `invalid_parameter_value`).
2. **A registry table `design_os.error_code`** with columns:
   - `sqlstate` PK, CHECK `^LD[0-9]{3}$`;
   - `code` UNIQUE;
   - `http_status`;
   - `api_facing` boolean;
   - `description`.

   It is seeded with the rows in §5.2, plus `LD9xx` internal-integrity codes, which are not API-facing and map to `INTERNAL_DATABASE_ERROR`:
   - TRUNCATE refused;
   - lifecycle change outside `transition()`;
   - new version not starting as DRAFT;
   - identity_kind changed.

   The API's code, HTTP status and SQLSTATE come from this shared registry, so the TypeScript side cannot drift from it. `design_os_api` gets SELECT. The table is registry data, so it is unaudited like `permission`.
3. **Structured, safe context in `DETAIL`.** Where a code needs context, `DETAIL` carries a JSON object, for example:
   - LD008/LD009/LD016: `{"problems":[{"code":…,"message":…}]}`;
   - LD011: `{"blockerCount":…}`;
   - LD006: `{"status":…}`.

   The API copies only allow-listed keys per code into `problem.context`.
4. **Coded approval problems.** A new `design_os.approval_problem_items(subject_type, id, org) RETURNS TABLE (code text, message text)`. The existing `approval_problems()` keeps its signature as a wrapper, so existing callers and tests are unchanged. `transition(APPROVE)` raises:
   - `LD008 DEPENDENCY_NOT_APPROVED` when any item is a dependency problem;
   - otherwise `LD009 APPROVAL_PRECONDITIONS_FAILED`.
5. **Split checks where one RAISE covered two meanings:**
   - "authenticated internal member" → `LD002` (no membership) vs `LD003` (CLIENT identity);
   - content immutability → `LD013` (non-DRAFT) vs `LD014` (LOCKED), decided by the row's status;
   - `record_validation_run` "only for DRAFT or IN_REVIEW" → `LD012`.
6. **Behaviour otherwise unchanged.** The migration uses `CREATE OR REPLACE FUNCTION` with identical logic, and message texts are unchanged. The rollback restores the 0001–0011 definitions verbatim. 0001–0011 are not edited.

**Translator** (`pg-error.translator.ts`):

| Source | Mapping |
|---|---|
| `LDnnn` SQLSTATE | registry row → code/status; `api_facing = false` → `INTERNAL_DATABASE_ERROR` |
| `42501` | `PERMISSION_DENIED` |
| `23503` with `err.schema = 'design_os'` | `INVALID_REFERENCE` |
| `23505` with `err.schema = 'design_os'` | `DUPLICATE_RESOURCE`, except the idempotency unique key, which the idempotency layer consumes itself |
| `23514` / `23502` with `err.schema = 'design_os'` | `VALIDATION_FAILED` |
| `40001`, `40P01`, `55P03` | `CONCURRENT_MODIFICATION` (or `IDEMPOTENCY_IN_PROGRESS` during the claim) |
| `08xxx`, `57P01`–`57P03` | `DATABASE_UNAVAILABLE` |
| anything else | `INTERNAL_DATABASE_ERROR` |

Built-in constraint errors are classified by SQLSTATE, and by the constraint's schema and name (structured `pg` error fields) where an override is needed. They are never classified by message.

**Tests proving the mapping is complete:**

- **Database (PG17).**
  - Every function in `design_os` (`pg_proc.prosrc`) whose body contains `RAISE EXCEPTION` uses an `ERRCODE` present in `error_code`. A generic SQLSTATE fails the test.
  - One test per API-facing `LD` code triggers it through a real path and asserts `err.code`.
  - A coverage assertion fails if any API-facing registry row has no triggering test.
- **Constraint coverage.** Every `design_os` constraint in `pg_constraint` (FK, UNIQUE, CHECK, NOT NULL) resolves to an API code through the rules above or an explicit override. Every override names an existing constraint.
- **Registry parity.** The TypeScript code table equals the database `error_code` table (code, SQLSTATE, HTTP status).
- **Translator unit tests.**
  - Each rule maps as expected.
  - An unknown SQLSTATE, an `LD9xx` code, and an error whose message *looks like* a known one but has a generic SQLSTATE all become `INTERNAL_DATABASE_ERROR`.
  - The serialised problem contains no message, SQL, constraint or table name.

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

### 8.1 Manufacturing release (OD-4)

**In V1 there is no manufacturing-release record.** A design version counts as *released to manufacturing* exactly when all of the following hold:

1. the DesignVersion is **LOCKED**;
2. a **FOR_PRODUCTION** `manufacturing_document_snapshot` of that version exists whose `design_version_content_hash` and `input_hash` equal the locked version's;
3. that snapshot has **zero BLOCKERs**, and the latest validation run for the current inputs has zero BLOCKERs;
4. **all production guards are satisfied.** The provenance trigger requires a non-null manufacturing standard pin equal to the design version's pin, and approval requires every pin, including the manufacturing standard version, to be APPROVED or LOCKED.

`POST /design-versions/{id}/manufacturing-release` (`manufacturing.release`, Idempotency-Key, reason) runs in one transaction:

- `transition('design', id, 'LOCK', reason)` if the version is APPROVED; the existing `manufacturing.release` permission is one of the LOCK permissions;
- then it verifies conditions 2–4;
- it writes nothing except the LOCK decision and the audit entries.

`GET /design-versions/{id}/manufacturing-release` returns the derived status and the qualifying snapshot id. Failures return `ISSUE_PRECONDITIONS_FAILED` or `VALIDATION_BLOCKERS`.

**Consequence in V1:** the manufacturing variable registry is empty, so no ManufacturingStandard version can be approved (`completeness.test.ts`). No design version can therefore pin an approved manufacturing standard, and **no manufacturing release is possible until ManufacturingStandard is production-ready.** This is intended. A test asserts the release endpoint refuses, and a formal release entity arrives with the production workflow.

---

## 9. Security

| Topic | Plan |
|---|---|
| RLS is final | Every statement runs as `design_os_api` under RLS with default deny. The API never connects as `design_os_owner`, `postgres` or `service_role` |
| Tenant context | Identity → verified ACTIVE membership → authorized org context (§2.1). `X-Org` is a selector only; a non-member gets `ORG_ACCESS_DENIED` with no hint about whether the org or any resource exists |
| API first | Guard (action) → service (scope, state, LOCKED, D8, If-Match) → only then domain SQL. The only earlier reads are the caller's own memberships and permissions (§2.1) |
| SECURITY DEFINER | The existing functions (`transition`, `record_validation_run`, integrity/audit triggers, RLS helpers), plus `current_memberships()` (0013, returns only the caller's own rows) and, at the portal step, `consume_client_invitation()` (§2.4). All have a fixed `search_path` and their own identity/membership/permission checks, and each new one gets a test proving it cannot read or act outside the caller's identity and org |
| Roles | `design_os_owner` owns objects (migrations only). `design_os_api` (NOLOGIN) is assumed by the API's login role via `SET LOCAL ROLE`; local/CI tests create that login role in the harness, and on hosted Supabase it is part of gate item 9. Credentials come from environment configuration, never from the repository |
| Audit | Every audited table writes the hash-chained `audit_log` with actor, `request_id` and `reason`. The API guarantees `design_os.request_id` on every write and `design_os.reason` for transitions, revocations, role-grant changes and deletes. `GET /audit/verify` (ADMIN, `audit.read`) runs `verify_audit_chain(org)` |
| Client isolation | CLIENT identities see only `/portal/**`: issued quotations and drawings of projects where they are an ACTIVE `project_member` whose contact belongs to the project's client. Draft, cost, BOM, production drawings, approvals and audit are never reachable; RLS enforces the same. Unknown or foreign project ids → 404 |
| Internal vs client | Separate route families, `identity_kind` check, CLIENT role limited to `output.read.issued` by the database CHECK |
| Input safety | Zod `.strict()` everywhere; UUID/enum/size limits; parameterised SQL only; request body size limits in Fastify; no user-controlled SQL identifiers (the `{collection}` → subject map is a fixed allow-list) |
| Transport and headers | HTTPS only in deployment; CORS allow-list of the web, admin and portal origins; `Cache-Control: no-store` on authenticated responses; no tokens in query strings |
| Rate limits | `@fastify/rate-limit` per user and IP on auth-sensitive routes (invitation acceptance, at the portal step) |
| Logging | Structured logs with `requestId`; redaction of `authorization`, cookies, `token`, invitation tokens and signed URLs; database errors logged in full server-side only |
| Secrets | Supabase JWT secret/JWKS URL, DB URL and storage keys are all read from the environment; none is exposed in `/openapi.json` or errors |

---

## 10. Test strategy

All database-backed tests run against **local/CI PostgreSQL 17** (the existing `db` CI job), with migrations applied up/down/up. Each test runs inside a transaction that is rolled back; the teardown row check stays.

| Layer | What | How |
|---|---|---|
| Unit | services with fake repositories/engines, ETag helpers, idempotency fingerprinting, problem mapping, translator | Vitest, no DB |
| Schema validation | every request schema: valid samples pass; unknown keys, `status` writes, org/user ids in bodies, TEST_FIXTURE and bad UUIDs fail | Vitest table tests |
| Error contract (OD-1) | every `RAISE EXCEPTION` in live `design_os` functions uses a registered `LD` SQLSTATE; one test per API-facing LD code; constraint coverage; TS ↔ DB registry parity; translator never reads messages and hides raw details (§5.3) | PG17 + Vitest |
| Tenant context | no membership / suspended membership / suspended user / foreign `X-Org` → `ORG_ACCESS_DENIED` with an identical body for existing and non-existing orgs; several orgs without `X-Org` → `ORG_SELECTION_REQUIRED`; membership revoked between requests → denied on the next request; `current_memberships()` never returns another user's rows | inject + PG17 |
| Authorization | per route, every role: allowed vs 403, derived from the seeded `default_role_permission` so the matrix and tests cannot drift | Fastify `inject` + PG17 |
| RLS without API | the same forbidden operations with the API guard bypassed still fail at the database | direct `design_os_api` connection |
| Tenant isolation | two orgs; every id-taking route with the other org's id → 404 `NOT_FOUND`; the log carries `TENANT_ISOLATION` | inject + PG17 |
| Client isolation | CLIENT: only issued outputs of assigned projects; revoked contact/member → next request 403/404; no internal route reachable | inject + PG17 |
| Lifecycle | every allowed and forbidden transition through the endpoint; D8; FINANCE-only approvals; COSTING cannot approve; LOCK cascade visible; SUPERSEDE only via APPROVE | inject + PG17 |
| Concurrency (OD-3) | two writers with the same If-Match → one 200, one 412 `STALE_VERSION`; hash ETags identical across key orderings and pinned by golden tests; a LOCKED / non-DRAFT record refuses mutation even with a correct ETag; a design-object write with a stale design-version ETag → 412; generation racing an edit → a consistent snapshot or 412 | parallel connections |
| Idempotency (OD-2) | first request executes once; replay returns the identical status/body/ETag with `Idempotent-Replayed`; different request hash → 409 `IDEMPOTENCY_CONFLICT`; concurrent duplicates → the effect row count stays 1; a rolled-back failure leaves no record; expired record is replaced; RLS hides other actors' records | inject + PG17 |
| Pagination (OD-6) | stable order across pages with equal `created_at`; limit > 200 rejected; tampered/foreign cursor → `INVALID_CURSOR`; cursor from another org yields nothing | inject + PG17 |
| Manufacturing release (OD-4) | refused in V1 because no ManufacturingStandard can be approved; guard order verified with a DB-level provenance test | inject + PG17 |
| Provenance | generated snapshots carry exact pins; tampered pins → `PROVENANCE_MISMATCH`; FOR_PRODUCTION on DRAFT → refused; issue before LOCK → refused | inject + PG17 |
| Validation runs | stale input hash/revision → 409; newer blocked run overrides; runs only via the endpoint | inject + PG17 |
| Storage | checksum mismatch, referenced-file delete refusal, signed URL expiry, adapter contract suite | memory/local providers |
| Integration (vertical slice) | synthetic test-only world: project → room → design → run → submit → approve → BOM/BOQ/pricing/quotation/drawing → lock → issue → client reads issued quotation | inject + PG17 |

**Transaction isolation for API tests.**

- **Most suites** run each request through a test-only connection provider. It wraps the unit of work in a SAVEPOINT inside one outer transaction per test, which is rolled back.
- **Suites that need real commits** (concurrency, idempotency races, pooled-claim leakage) run in a throw-away database per file that is dropped afterwards. The shared test database's no-rows teardown check therefore still holds.

Synthetic values stay in the existing marked test-only support module under `tests/db`, are rolled back, and remain covered by `synthetic-data-isolation.test.ts` (API integration tests that need them live under `tests/db` too).

---

## 11. Proposed endpoints and schemas (`/api/v1`)

### 11.1 Endpoints

Every collection `GET` is cursor-paginated (§4.5). Every route resolves the org through §2.1. Writes to existing mutable resources need `If-Match` (§4.1).

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
| `POST /quotation-snapshots/{id}/issue` · `POST /drawing-snapshots/{id}/issue` (Idempotency-Key, reason) | `quotation.issue` / `drawing.issue` |
| `POST /design-versions/{id}/manufacturing-release` (Idempotency-Key, reason) · `GET /design-versions/{id}/manufacturing-release` | `manufacturing.release` / `output.read.production` (§8.1) |

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
| `POST /portal/invitations/accept` · `GET /portal/projects` · `GET /portal/projects/{id}/quotations` · `GET /portal/projects/{id}/drawings` · `GET /portal/files/{id}/url` | CLIENT; `output.read.issued`. **Deferred to the client-portal step; not built in Step 4** |

### 11.2 Schemas (Zod, `apps/api/src/modules/*/…schemas.ts`)

| Group | Schemas |
|---|---|
| Common | `Uuid`, `Sha256Hash` (`sha256:` + 64 hex), `LifecycleStatus` (5 values, response only), `TransitionAction`, `Reason` (trimmed, 1–2000), `Purpose`, `PageQuery` (`limit` 1–200, default 50; opaque signed `cursor`), `Page<T>` (`items`, `nextCursor`), `Problem`, `ETag` |
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

## 12. Decisions (approved)

| # | Decision | Where |
|---|---|---|
| OD-1 | **Approved.** Stable machine-readable database error codes: SQLSTATE class `LD`, a registry table, coded approval problems and safe structured `DETAIL`. The API never depends on message text. Expected errors map to stable codes; unexpected ones map to `INTERNAL_DATABASE_ERROR` with no raw details. Tests prove every API-facing database error is mapped | §5.2, §5.3; migration 0012 |
| OD-2 | **Approved.** `design_os.idempotency_record` with `UNIQUE (org_id, scope, idempotency_key)`. Execute-once / replay / `409 IDEMPOTENCY_CONFLICT`, and the operation never executes twice. Used for transitions, validation runs, output generation, issue/release and file upload | §4.3; migration 0013 |
| OD-3 | **Approved.** Hash-based ETags over a deterministic canonical representation (explicit column allow-list, normalised values, `stableStringify`) for clients, contacts, projects, project members, memberships and designs. The DesignVersion whole-draft token stays the authority. `412 STALE_VERSION`. LOCKED records refuse mutation regardless of ETag | §4.1, §4.4 |
| OD-4 | **Approved.** Manufacturing release = LOCKED DesignVersion + FOR_PRODUCTION manufacturing document + zero BLOCKERs + all production guards. No release record yet; the `manufacturing.release` permission is kept | §8.1 |
| OD-5 | **Approved, deferred.** Invitation model designed (one-time 256-bit token, hash only, short expiry, bound to client/contact/project, atomic consumption, replay/expiry rejection, no raw tokens in logs). Implemented with the client portal; the portal stays off | §2.4 |
| OD-6 | **Approved.** Cursor pagination, max 200, stable unique order `(created_at, id)`, no offset pagination on primary collections | §4.5 |
| Tenant context | **Correction applied.** The authenticated identity is the authority; `X-Org` only selects among verified ACTIVE memberships; non-members get `ORG_ACCESS_DENIED` without revealing existence; RLS remains final | §2.1, §2.2 |

**One addition needed by the correction:** `design_os.current_memberships()`, a SECURITY DEFINER function returning only the caller's own ACTIVE memberships. Without it the API cannot verify membership before choosing an org, because `org_membership` RLS is scoped to the current org. It ships in migration 0013 next to the idempotency table.

**Explicitly deferred:**

- UI (web, admin, portal, mobile), and client-portal enablement (including the invitation implementation);
- hosted Supabase (any project, bucket, migration or JWT configuration);
- the production Hettich import;
- production pricing and rates;
- manufacturing production standards and values (the registry stays empty);
- Redis and BullMQ;
- background jobs (including an orphan-file sweeper, expired-idempotency cleanup and a scheduled audit verifier);
- ops database synchronisation (ops references stay text only, D7).

## 13. Final Step 4 implementation sequence

Each item is one reviewable commit or a small group of them. Everything is local/CI only (PostgreSQL 17 + memory/local storage), and work stops for review at the points marked **⏸**. Every step runs typecheck, lint, unit tests and database tests.

| # | Scope | Contents | Tests |
|---|---|---|---|
| 1 | **OD-1: database error-code migration** `0012_error_codes` (+ down) | SQLSTATE class `LD`; `design_os.error_code` registry (seeded, SELECT for `design_os_api`, unaudited); `CREATE OR REPLACE` of every raising function/trigger with `LDnnn` codes and JSON `DETAIL`, logic and messages unchanged; `approval_problem_items()` + wrapper; split codes (LD002/LD003, LD013/LD014); schema snapshot updated | all existing DB tests still pass unchanged; new `error-codes.test.ts`: every RAISE registered, one trigger per API-facing code, coverage assertion, up/down/up |
| 2 | **OD-2: idempotency migration** `0013_idempotency_context` (+ down) | `design_os.idempotency_record` (columns, checks, `UNIQUE (org_id, scope, idempotency_key)`, RLS own-actor, column grants, no DELETE, no-TEST_FIXTURE CHECK); `unaudited_tables()` extended; `current_memberships()` SECURITY DEFINER | uniqueness, RLS isolation between actors/orgs, grants, completed-row CHECK, `current_memberships()` isolation, up/down/up, drift. **⏸ review migrations 0012–0013** |
| 3 | **API authentication / context layer** | `apps/api` skeleton (NestJS + FastifyAdapter, `/api/v1`, config, request id, logger with redaction); `pg` pool + unit of work (`SET LOCAL ROLE`, claims, request id, reason); JWT guard (`jose`, local test issuer); org-context resolution through `current_memberships()` (§2.1); `GET /me`; ESLint boundary rules for `apps/api` | JWT failures, tenant-context matrix, claims never leak across pooled transactions |
| 4 | **Authorization / permission layer** | `@RequiresAction` + permission guard, identity-kind route families, service scope helpers (`can_access_project`), subject allow-list derived from `versioned_table` | per-role matrix generated from `default_role_permission`; RLS-without-API suite |
| 5 | **Error / problem-details layer** | RFC 9457 filter, the §5.2 code table, TS registry with parity against `design_os.error_code`, `pg-error.translator.ts`, Standard Schema pipe → `VALIDATION_FAILED` | translator rules, no-leak assertions, message-lookalike → `INTERNAL_DATABASE_ERROR` |
| 6 | **Concurrency / ETag layer** | version ETags, canonical hash ETags (column allow-lists, normalisation, goldens), If-Match enforcement with guarded updates, lifecycle-before-ETag rule; idempotency service (claim / complete / replay / conflict, `lock_timeout`); cursor pagination | OD-2, OD-3 and OD-6 suites. **⏸ review the API foundation (3–6)** |
| 7 | **Initial API modules** | organizations/me, memberships + role grants, clients + contacts (invite stores contact only; no portal), projects + members, rooms + revisions, designs + versions + pins + objects + overrides (input hash via `designInputHash`), reference-data read/author for standards, catalogs, catalog versions and Hettich (authoring of structure only; no production values are added) | authorization, tenant isolation, schema validation, DRAFT-only edits |
| 8 | **Transition endpoint** | `POST /{collection}/{id}/transitions` → `design_os.transition()` only; approval views; If-Match + Idempotency-Key | full lifecycle, D8, FINANCE-only, COSTING cannot approve, LOCK cascade, SUPERSEDE only via APPROVE, no status write anywhere. **⏸ review modules + transitions** |
| 9 | **Validation / output orchestration** | engine fingerprint; validation runs → `record_validation_run()`; BOM, BOQ, pricing, quotation, drawing and manufacturing-document generation (one REPEATABLE READ transaction, provenance via `@lintel/persistence`); issues; manufacturing release (§8.1) | provenance, FOR_PRODUCTION guards, validation-run trust boundary, issue before LOCK refused, release refused in V1 |
| 10 | **Storage / file endpoints** | FileService wiring, upload with checksum verification, content-addressed keys, `file_object`, snapshot file links, signed URLs, orphan-only delete; `SupabaseStorageProvider` / `S3StorageProvider` implemented and contract-tested but **not configured** | checksum mismatch, referenced-file delete refusal, RLS file visibility, adapter contract suite |
| 11 | **Integration / security tests** | vertical slice (project → room → design → run → submit → approve → outputs → lock → issue); client-isolation checks at the database/API level with the portal still off; concurrency and idempotency races in throw-away databases; audit chain verified after the slice; `docs: ADR-0009 persistence, approval and storage` | full suite green in CI. **⏸ final Step 4 review** |
