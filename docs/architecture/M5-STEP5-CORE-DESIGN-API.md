# M5 Step 5: Core Design Domain API (review checkpoint)

Status: **IMPLEMENTED, FOR REVIEW.** This step covers clients, projects, membership, rooms, survey revisions, designs, design versions, objects, relationship overrides, lifecycle transitions and validation runs.

It does not include BOM, BOQ, pricing, quotation, drawings, manufacturing, files/storage, the client portal, hosted Supabase, production data, or Redis/background jobs.

It builds on the Step 4 foundation (`M5-STEP4-API-PLAN.md`). All routes are under `/api/v1`. Every error is RFC 9457 problem+json with a stable `code`.

## 1. Endpoints

| Method | Path | Guard action | Concurrency / idempotency |
|---|---|---|---|
| POST | `/clients` | `client.write` | natural key `clientCode` (repeat → 409) |
| GET | `/clients` · `/clients/{clientId}` | `client.read` | cursor list · ETag |
| PATCH | `/clients/{clientId}` | `client.write` | If-Match (hash ETag) |
| POST | `/projects` | `project.write` | natural key `projectCode` |
| GET | `/projects` · `/projects/{projectId}` | authenticated (RLS scope) | cursor list · ETag |
| PATCH | `/projects/{projectId}` | `project.write` | If-Match |
| GET | `/projects/{projectId}/members` | authenticated (scope) | — |
| POST | `/projects/{projectId}/members` | `project_members.assign` | natural key (project, user, role) |
| POST | `/projects/{projectId}/members/revoke` | `project_members.assign` | reason (audited) |
| POST | `/projects/{projectId}/rooms` | `room.survey.write` | **Idempotency-Key** (`room.create`) |
| GET | `/projects/{projectId}/rooms` · `/rooms/{roomId}` | authenticated (scope) | cursor list · ETag |
| PATCH | `/rooms/{roomId}` | `room.survey.write` | If-Match |
| POST | `/rooms/{roomId}/revisions` | `room.survey.write` | **Idempotency-Key** (`room_revision.create`) |
| GET | `/rooms/{roomId}/revisions` · `/room-revisions/{revisionId}` | authenticated (scope) | cursor list (revision number) |
| POST | `/rooms/{roomId}/designs` | `design_version.author` | **Idempotency-Key** (`design.create`) |
| GET | `/rooms/{roomId}/designs` · `/projects/{projectId}/designs` · `/designs/{designId}` | authenticated (scope) | cursor list · ETag |
| PATCH | `/designs/{designId}` | `design_version.author` | If-Match |
| POST | `/designs/{designId}/versions` | `design_version.author` | **Idempotency-Key** (`design_version.create`) |
| GET | `/designs/{designId}/versions` · `/design-versions/{versionId}` | authenticated (scope) | cursor list (version number) · ETag |
| PATCH | `/design-versions/{versionId}` | `design_version.author` | If-Match (whole-draft ETag), DRAFT only |
| POST | `/design-versions/{versionId}/transitions` | per action (below) | **If-Match + Idempotency-Key** (`transition`) |
| GET | `/design-versions/{versionId}/objects` · `/design-objects/{objectId}` | authenticated (scope) | cursor list (object code, code-point order) |
| POST | `/design-versions/{versionId}/objects` | `design_version.author` | If-Match (version ETag); natural keys `objectCode`, lineage |
| PATCH / DELETE | `/design-objects/{objectId}` | `design_version.author` | If-Match (version ETag) |
| GET | `/design-versions/{versionId}/overrides` | authenticated (scope) | full version history |
| POST | `/design-versions/{versionId}/overrides` | `design_version.author` | **If-Match + Idempotency-Key** (`relationship_override.create`) |
| DELETE | `/design-versions/{versionId}/overrides/{overrideCode}` | `design_version.author` | If-Match |
| POST | `/design-versions/{versionId}/validation-runs` | `design_version.author` **or** `output.generate.engineering` (plus `reference.read`) | **Idempotency-Key** (`validation_run.record`); If-Match optional |
| GET | `/design-versions/{versionId}/validation-runs` · `/validation-runs/{runId}` | authenticated (scope) | cursor list (sequence) |

All these routes are internal-identity routes; CLIENT identities get `403 IDENTITY_KIND_MISMATCH`. Anything the caller cannot see under RLS (another tenant, or a project they are not assigned to without `project.read_all`) is `404 NOT_FOUND`.

## 2. Request and response schemas

Zod schemas live in each module's `*.schemas.ts`, validated through the Standard Schema interface. Every object schema is **strict**, so unknown fields are a 400. In particular, `status`, `orgId`, `createdBy`, `inputHash`, `blockerCount` and the like are never accepted.

| Module | Schemas |
|---|---|
| clients | `ClientCreate`, `ClientUpdate`, `ClientResponse` |
| projects | `ProjectCreate` (with the fixed `clientId`), `ProjectUpdate`, `ProjectResponse`, `MemberAssign` (a CLIENT needs its `clientContactId`; no other role may have one), `MemberRevoke` (reason), `MemberResponse` |
| rooms | `RoomCreate` (optional `initialSurvey`), `RoomUpdate`, `SurveyInput` (surveyed millimetres only, at most 2 decimals — derived geometry is rejected), `RoomResponse`, `RevisionResponse` |
| designs | `DesignCreate`, `DesignUpdate` (name, ACTIVE/ARCHIVED), `DesignResponse` |
| design-versions | `VersionCreate` (`basedOnVersionId?`, `roomRevisionId?`, `pins?`, `versionLabel?`, `changeReason`, `source?`), `VersionUpdate`, `PinsInput` / `Pins` (12 exact pins), `VersionResponse` (full envelope, pins, `inputHash`, `inputRevision`, `contentHash`, `rowVersion`, latest-validation summary), `VersionState`, `TransitionRequest` (APPROVE requires `expectedContentHash`) |
| objects / overrides | `ObjectInput` (objectCode, optional lineageId, BASE_CABINET, productCode + exact `productVersionId`, position, rotationY ∈ {0, 90, 180, 270}, positive dimensions, parameters), `ObjectUpdate` (code / lineage / type immutable; product code and version change together), `ObjectResponse`, `OverrideCreate` (objectIds are lineage ids), `OverrideResponse` |
| validation | `ValidationRequest` (**empty strict object**: results always come from the engine), `ValidationRunResponse` (`current` = matches the version's input hash and input revision) |

Lists return `{ items, nextCursor }`. Cursors are signed and bound to the collection, the sort and the organization. `limit` is 1–200 and there is no offset.

## 3. Authorization matrix (default role grants)

| Operation | ADMIN | DESIGNER | DESIGN_HEAD | SALES | COSTING | FINANCE | PROCUREMENT | PRODUCTION | SITE_ENGINEER |
|---|---|---|---|---|---|---|---|---|---|
| clients: read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| clients: write | ✓ | | ✓ | ✓ | | | | | |
| projects: create / update | ✓ | | ✓ | ✓ | | | | | |
| project members: assign / revoke | ✓ | | ✓ | ✓ | | | | | |
| rooms / survey revisions: write | | ✓ | ✓ | | | | | | ✓ |
| designs, versions, objects, overrides: write | | ✓ | ✓ | | | | | | |
| validation run | | ✓ | ✓ | | ✓ | | | | |
| SUBMIT | | ✓ | ✓ | | | | | | |
| REQUEST_CHANGES / APPROVE | | | ✓ | | | | | | |
| LOCK (lock, or an issue / release permission) | | | ✓ | ✓ | | | | ✓ | |

**Read scope.**
- Projects and everything below them are visible only through `can_access_project`: either `project.read_all` (ADMIN, DESIGN_HEAD, SALES) or an assignment to the project.
- Reads need no extra action.
- The API check is a fast refusal; RLS and the SECURITY DEFINER functions re-check every rule.
- D8 (approver ≠ submitter) is enforced by `transition()` and returns `SEPARATION_OF_DUTIES`.

## 4. Lifecycle behaviour

- The lifecycle is **DRAFT → IN_REVIEW → APPROVED → LOCKED**. A version becomes **SUPERSEDED** only when a successor of the same design is approved.
- **Only `POST /design-versions/{id}/transitions` changes it**, and it calls `design_os.transition('design', …)`.
  - No create or update body accepts `status`; strict schemas give a 400.
  - The API role has no UPDATE grant on any lifecycle column.
  - `guard_version_row` refuses lifecycle changes outside `transition()`.
- **Draft-only content.** Objects, overrides, pins, the room revision and draft metadata change only while the version is DRAFT.
  - An IN_REVIEW, APPROVED or SUPERSEDED version returns `409 RECORD_NOT_EDITABLE`; a LOCKED one returns `409 RECORD_LOCKED`, whatever the ETag.
  - `REQUEST_CHANGES` returns the version to DRAFT.
- **Preconditions** come from the database:
  - SUBMIT needs a validation run for the current input hash and input revision (`VALIDATION_RUN_REQUIRED`).
  - APPROVE needs the reviewed `expectedContentHash` (`CONTENT_HASH_MISMATCH`), every pin APPROVED or LOCKED (`DEPENDENCY_NOT_APPROVED`) and 0 BLOCKERs in the latest current run (`VALIDATION_BLOCKERS`).
- **Changes after review.** Every draft change recomputes the version's content hash, so an old review can never approve changed content after `REQUEST_CHANGES`.

## 5. ETag and concurrency

| Resource | ETag | Notes |
|---|---|---|
| Clients, projects, rooms, designs | `"sha256:…"` over an explicit, normalised column list | `SELECT … FOR UPDATE`, compare, update, all in one transaction |
| DesignVersion **and all its draft content** | `"<versionId>:<row_version>"` | This whole-draft token is the only authority. Every object or override write locks the version row (`FOR UPDATE`), checks lifecycle and then If-Match, writes, and recomputes the hashes. Each write returns the new version ETag (header and `designVersion` in the body) |
| Room revisions, validation runs | — | immutable |

- **Writes to existing resources:** a missing If-Match is `428`; a stale one is `412 STALE_VERSION` with the current ETag.
- **Transitions** check If-Match against the version first. After `transition()` they also require that the recorded decision's content hash equals the content hash the caller saw. That closes the window between the ETag check and the function's own row lock; otherwise the result is `412 STALE_VERSION` and the transaction rolls back.

## 6. Idempotency

| Operation | Protection |
|---|---|
| Creates with no natural key: rooms, room revisions, designs, design versions, override versions | **Idempotency-Key required** (428 when missing). Migration 0014 adds these scopes; the DB-enforced protocol is unchanged |
| Transitions and validation runs | Idempotency-Key required (scopes from 0013) |
| Creates with a natural unique key: clients (`clientCode`), projects (`projectCode`), objects (`objectCode` and lineage per version), members (project, user, role) | Idempotent by that key; a repeat is `409 DUPLICATE_RESOURCE` and never a second row |

- A retry with the same key and body replays the original status, body, `ETag` and `Location`, with `Idempotent-Replayed: true`.
- The same key with a different request is `409 IDEMPOTENCY_CONFLICT`.
- The same key while the original is still running is `409 IDEMPOTENCY_IN_PROGRESS`.

## 7. Database transaction boundaries

- **Access guard:** its own short READ ONLY transactions (Step 4).
- **Every operation:** exactly one unit-of-work transaction.
  - It runs as `design_os_api` with transaction-local claims for the verified org.
  - It re-verifies the org and, where declared, the action in-transaction.
  - The idempotency claim, the effect, the hash refresh and the stored response commit or roll back together.
- **Reads:** READ COMMITTED, READ ONLY.
- **Draft writes:** READ COMMITTED with `FOR UPDATE` on the parent version (or on the room for revision numbering, or the design for version numbering), so concurrent writes serialise.
- **Validation:** REPEATABLE READ. The inputs read, the engine result and the recorded run all come from one snapshot. `record_validation_run()` locks the version and rejects a run for inputs that are no longer current.

## 8. Validation flow

1. The guard requires `design_version.author` or `output.generate.engineering`. The unit of work (REPEATABLE READ) re-checks the same, and `reference.read` is required to read the pinned data.
2. The optional If-Match is checked against the version's current ETag.
3. The input hash is recomputed from the exact stored rows: room survey revision, objects, override history and pins, using the `@lintel/persistence` `designInputHash`. It must equal the stored `input_hash` (otherwise `VALIDATION_INPUT_MISMATCH`).
4. The exact pinned versions are loaded: construction, planning and edge band standards; material, finish, hardware and product catalog versions with their frozen member item versions and the products' recipe versions; and the Hettich dataset. They are mapped with the `@lintel/persistence` `…FromRows` mappers, and the catalog is assembled with `assembleCatalogSnapshot`.
5. `resolveRoom` from `@lintel/design-engine` runs in the application service. The engine alone decides the messages, BLOCKERs and WARNINGs.
6. `buildValidationRun` and `design_os.record_validation_run()` store the run immutably, bound to the input hash and the database input revision, with `engine_version`, `engine_build` and `engine_hash` (§9.4).
7. The response returns the run: `current` flag, counts, `canApprove`, and all engine messages. The request body must be `{}`; a client can never submit counts.

A run is `current` only while the version's input hash and input revision are unchanged. Any later edit makes it stale, and SUBMIT then needs a new run.

## 9. Architectural notes found in this step

1. **`INSERT … RETURNING` versus RLS on the same table.**
   - `RETURNING` must satisfy the SELECT policy. `project_read` calls `can_access_project(id)`, which looks the project up, and a row inserted by the same statement is not yet visible to it.
   - Projects are therefore inserted with a service-generated id and read back in a second statement.
   - Other tables' policies look up an existing parent, so they are not affected. Future tables whose read policy looks up their own row need the same pattern.
2. **Product catalog / object compatibility is enforced in the database (migration 0015).**
   - `guard_design_object_product` (0006) covers object insert and update. 0015 covers the other two sides:
     - `guard_design_version_product_catalog` (BEFORE UPDATE OF `product_catalog_version_id` on `design_version`) refuses a re-pin to a catalog version that lacks the exact `product_version` of any of the version's objects.
     - `guard_product_catalog_member_in_use` (BEFORE UPDATE OR DELETE on `product_catalog_version_product`) refuses dropping or re-pointing a DRAFT catalog member that a pinning design's objects use.
   - Both raise `LD019` with DETAIL `{"productVersionIds": [...]}` → `422 INVALID_REFERENCE` with that context. Membership is matched within the design version's own organization, and composite foreign keys make another tenant's catalog or product unreachable.
   - The API still checks first (same 422, draft unchanged); the database refuses even when the API is bypassed. DRAFT lifecycle rules are unchanged.
   - Tests: `tests/db/product-catalog-guard.test.ts` (direct DB path as owner and as the API role, compatible change, objects still valid, unrelated versions and members unaffected, cross-tenant) and the API re-pin test in `apps/api/test/db/design-versions.test.ts`.
3. **The design version content hash was undefined until now.**
   - `@lintel/persistence` `designVersionContentHash` defines it: the input hash plus the room revision, based-on version, label, reason, source and authored engine version.
   - It is recomputed with the input hash on every draft change.
4. **Engine provenance includes the build (migration 0016).**
   - The API resolves an immutable build identity at startup: `BUILD_REVISION` (set by the build / deployment), else `GITHUB_SHA` (CI), else the Git checkout (`+dirty` when tracked files differ). Without one the API refuses to start.
   - `engineIdentity(build)` keeps the semantic version (`ROOM_ENGINE_VERSION`) and fingerprints `{engine versions, build}` as `engine_hash`. A code change is visible without a manual version bump.
   - Every validation run stores `engine_version`, `engine_build`, `engine_hash` and `input_hash`, and the response returns `engineVersion`, `engineBuild`, `engineHash` and `inputHash`.
   - `record_validation_run()` now takes the build. `validation_run_engine_build_required` enforces it for every new run (`NOT VALID`: runs recorded before 0016 keep `engine_build` NULL; nothing is back-filled or invented).
   - Snapshot tables (output modules, not started) will carry the same fingerprint when they are built.
5. **The approval success path cannot be exercised over HTTP yet.**
   - With the test-only synthetic reference data, the engine reports BLOCKERs (for example `EDGE_RULES_UNDEFINED` and `MATERIAL_UNKNOWN`), so the database refuses APPROVE with `VALIDATION_BLOCKERS`.
   - The tests assert exactly that.
   - APPROVE→LOCK is covered by the database suite. A zero-blocker approval over HTTP needs real, approved production reference data, which is out of scope and never invented.
6. **Validation does not take `FOR SHARE`.**
   - Row locks on `design_version` need the UPDATE policy (authors only), which would hide the row from engineering-only callers.
   - Validation relies on REPEATABLE READ plus `record_validation_run()`'s own lock and input check. A concurrent edit makes the recording fail instead of storing a stale result.
7. **Project membership revocation** deletes the row (there is no status column). The audit chain keeps who, when and the reason.
8. **Deleting an object that an override references** is refused (`422`, with the override codes) rather than leaving an override pointing at nothing.
9. **Ordering.** Text-sorted collections (objects) use code-point order (`COLLATE "C"`), so pages are identical under any database collation.
