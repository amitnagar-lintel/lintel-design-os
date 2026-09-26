# M6 checkpoint 2 — reference-data read API (G1) and reviewed intake (G2)

Status: implemented for review (gate M6-2). The plan is `M6-V1-GO-LIVE-READINESS-PLAN.md` §2 and §9.1.

**No migration is added.** Both parts use the existing schema, row-level security, grants and `design_os.transition()`.

**Not in this checkpoint:**
- G3, G5, G7;
- UI;
- hosted Supabase;
- client portal;
- manufacturing and CNC;
- production pricing or Hettich values.

## 1. G1 — reference-data read API (`/api/v1/reference-data`)

**Scope:** 19 types, i.e. every versioned reference type in `design_os.versioned_table` except design versions (their own API) and the ManufacturingStandard (Phase 2):

| Group | Types |
|---|---|
| Standards | `construction_standard`, `planning_standard`, `edge_band_standard` |
| Catalog items | `material`, `edge_band`, `finish`, `hardware_item`, `hardware_rule_set`, `appliance`, `construction_recipe`, `product` |
| Catalogs | `material_catalog`, `finish_catalog`, `hardware_catalog`, `appliance_catalog`, `product_catalog` |
| Hettich | `hettich_dataset` |
| Commercial | `pricing_standard`, `quotation_policy` |

A database test asserts that this list and its author / approve actions match the registry.

| Method & path | Result |
|---|---|
| `GET /reference-data` | The types, with their author / approve actions and any extra content action |
| `GET /reference-data/{type}/entities?code=&limit=&cursor=` | Entities in code order. Each has its version summaries (newest first) and `usableVersions`, the APPROVED / LOCKED candidates for an exact pin |
| `GET /reference-data/{type}/versions?entityCode=&entityId=&status=APPROVED,LOCKED&limit=&cursor=` | Version envelopes. For one entity, newest version number first; otherwise newest first |
| `GET /reference-data/{type}/versions/{versionId}` | One exact version: envelope, the type's own columns (`content`), every child collection (`children`) and a strong ETag `"<id>:<row_version>"` |
| `GET /reference-data/hettich_dataset/versions/{versionId}/articles?category=&limit=&cursor=` | Hettich articles by position (paged) |
| `GET /reference-data/hettich_dataset/versions/{versionId}/calculation-rules?limit=&cursor=` | Hettich calculation rules by position (paged) |

**The envelope** carries identity, lifecycle, effective metadata and provenance:
- entity id and code;
- version number and label;
- the **exact** status;
- `dataClassification`;
- `source`, `sourceRef` and `changeReason`;
- `contentHash` and `rowVersion`;
- created / submitted / approved / effective / locked / superseded (by and at).

**Rules:**
- **Read-only.**
  - Only `GET` routes exist; there is no write route for reference data.
  - Every statement runs in a `READ ONLY` transaction.
- **Tenant-safe and permissioned by the existing RLS.** Access requires an internal identity, `reference.read` and the caller's own organization. Another organization's version is `404`.
- **Cursors are bound** to their collection, sort, filter and organization (HMAC). A cursor from another collection or organization is refused.
- **Lifecycle is never collapsed.**
  - DRAFT, IN_REVIEW, APPROVED, LOCKED and SUPERSEDED are returned exactly.
  - No "latest" is chosen on the caller's behalf: `usableVersions` only lists the candidates.
- **NULL stays NULL / UNVERIFIED:** content is returned exactly as stored.
- **PRODUCTION only.**
  - Every query also filters `data_classification = 'PRODUCTION'`.
  - The database CHECK `…_production_only` makes TEST_FIXTURE rows impossible, and a test proves it.
- **Cost data needs a second permission.** The PricingStandard content (rates and rules) needs `output.read.cost` on top of `reference.read`. Its metadata stays readable with `reference.read`.
- **Pagination:**
  - keyset pages everywhere lists can grow (entities, versions, Hettich articles and rules);
  - Hettich child collections are counted in the detail and read only through their paged routes.

## 2. G2 — reviewed reference-data intake CLI (`pnpm -s db:intake`)

### 2.1 Intake file (`lintel.reference-intake/v1`)

One file is one new version of one entity:

```json
{
  "format": "lintel.reference-intake/v1",
  "type": "construction_standard",
  "classification": "PRODUCTION",
  "intent": "WORKING_DRAFT | PRODUCTION_CANDIDATE",
  "entityCode": "LINTEL_CONSTRUCTION_STANDARD",
  "versionNumber": 2,
  "changeReason": "…",
  "source": "…the data's own source of record…",
  "sourceRef": { "url": null, "documentTitle": "…", "documentVersion": "…", "sourceDate": "YYYY-MM-DD" },
  "data": { "…the existing domain object (ConstructionStandard, Material, HettichProductionDataset, …)…" },
  "provenance": { "VARIABLE": { "unit": "MM", "source": "…", "evidenceRef": "…", "note": null } },
  "recipe": { "entityCode": "…", "versionNumber": 1 }
}
```

`provenance` is for numeric standards; `recipe` is for products.

**Accepted types (16):** every type with an existing domain model and persistence mapping:
- `construction_standard`, `planning_standard`, `edge_band_standard`;
- `material`, `edge_band`, `finish`;
- `hardware_rule_set`, `construction_recipe`, `product`;
- `material_catalog`, `finish_catalog`, `hardware_catalog`, `product_catalog`;
- `hettich_dataset`, `pricing_standard`, `quotation_policy`.

Catalog `data` is `{ versionLabel, description, members: [{ itemType, entityCode, versionNumber }] }`.

**Refused types, with the reason:**

| Type | Why refused |
|---|---|
| `hardware_item`, `appliance`, `appliance_catalog` | No domain model exists; accepting them would mean inventing one |
| `manufacturing_standard` | Phase 2 |

### 2.2 Checks before anything is written (fail closed)

| Check | What refuses |
|---|---|
| **Schema** | Strict Zod mirrors of the domain types. The build fails if a mirror and its type drift apart; a negative check was verified. Unknown keys and wrong types are refused, with exact paths |
| **TEST_FIXTURE** | Any of these is refused (`TEST_FIXTURE_REFUSED`), before any database access: <br>• a TEST_FIXTURE marker anywhere in the file (`findTestFixtureMarker`); <br>• `classification: TEST_FIXTURE`; <br>• a fixture dataset kind; <br>• `FIXTURE-*` articles; <br>• fixture entity codes. <br>The database CHECK refuses it again |
| **Lifecycle** | The data must be `DRAFT`. An APPROVED or RETIRED object is refused: approval happens only through the workflow. A rate card's `effectiveFrom` must be null (the approval sets it) |
| **Version identity** | Explicit `entityCode` equal to the data's own id, and an explicit `versionNumber`. <br>In the database: the same number with the same content is `UNCHANGED`; the same number with other content is `VERSION_CONFLICT`; the same content as another version is `DUPLICATE_CONTENT`; a skipped number is `VERSION_NOT_NEXT` |
| **Provenance** | One source of record (`source` must equal the data's own source). <br>A value without a source is refused (`VALUE_WITHOUT_SOURCE`); a value without evidence is `UNVERIFIED`. <br>Provenance for an undeclared value is refused. <br>A production candidate names and dates its source document |
| **Required fields / completeness** | Every NULL value, missing variable, missing limit, empty rule set, empty catalog, missing rate and every Hettich BLOCKER from `validateProductionRecord` / `validateProductionRule` is listed as `UNVERIFIED` |
| **Explicit production use** | `intent: PRODUCTION_CANDIDATE` is refused while anything is `UNVERIFIED` (`INCOMPLETE_PRODUCTION_DATA`). A Hettich licence that is not OFFICIAL_PUBLIC / AUTHORISED is refused outright |
| **Dependencies** | A product needs its exact recipe version. Catalog members must be exact existing item versions. Banded edges must reference existing catalog edge bands. <br>For a production candidate every dependency must be APPROVED / LOCKED (`DEPENDENCY_NOT_APPROVED`) |
| **Duplicates / conflicts** | Duplicate records inside a dataset (Hettich records, articles and rules; hardware rules; recipe templates, formulas and rules; product parameters; catalog members). Undefined tax-rate references |
| **Author** | An ACTIVE internal member of the organization holding the type's author action (`AUTHOR_NOT_MEMBER` / `AUTHOR_NOT_PERMITTED`). A member of another organization can never write into this one |

**The report:**
- **Deterministic:** findings are sorted by level, path, code and message. The same bytes always give the same report.
- **Stable ids:** entity and version ids are derived from organization, type, code and version, so re-imports are idempotent.

### 2.3 Writing, audit and approval

**Import:**
- It runs in one transaction, over the **direct** migration connection, but **as the named author**: `SET LOCAL ROLE design_os_api` with the author's claims. RLS and the author action therefore bound every row, exactly as for the API.
- The rows come from the existing `@lintel/persistence` mappers, which also refuse TEST_FIXTURE.
- It writes DRAFT only. The row is read back to confirm DRAFT, PRODUCTION, the computed content hash and the author.
- `--dry-run` rolls everything back and reports `WOULD_CREATE` with the row counts.

**Audit:** every row lands in the hash-chained `audit_log`.
- The actor is the author.
- The reason is `reference-data intake <type> <code> v<n> (<intent>) file <sha256> by operator <who>`.
- The request id is `intake:<file hash>`.

**Submit and approve:** both call `design_os.transition()`; the tool never writes a status itself.
- `submit` runs as the operator-named draft author (`--as`). It is refused while the database's approval preconditions report problems.
- `approve` runs only as an **authenticated** approver (§2.4) and requires `--expected-content-hash`.
- The database enforces the rest: the action (LD001), approver ≠ submitter (LD004), the reviewed hash (LD007), dependency lifecycles and completeness.

### 2.4 Three identities (operator, draft author, authenticated approver)

| Identity | Who | How it is established | What it may do | Where it is recorded |
|---|---|---|---|---|
| **Operator** | The person running the tool with the migration credential | `--operator <who>` (asserted) | Run the tool; never an actor in the data | The audit `reason` of every intake / submit / approve, and the idempotent request id |
| **Draft author** | The Lintel member who owns the DRAFT content | `--as <email>`, named by the operator. It must be an ACTIVE internal member of the organization holding the type's author action | `import` (a DRAFT only) and `submit` | `created_by`, `submitted_by`, the audit `actor_user_id` and the SUBMIT `approval_decision` |
| **Authenticated production approver** | The Lintel member who approves | Their **own Supabase Auth access token** (`--access-token-file <path>` or `APPROVER_ACCESS_TOKEN`). It is verified exactly as the API verifies tokens: the same settings (`AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL` / `AUTH_JWT_SECRET`), signature, issuer, audience, expiry, `role = authenticated` and a UUID `sub`. `approve` refuses `--as` | `approve` | `approved_by`, the audit `actor_user_id` and the APPROVE `approval_decision`, all as the token's `sub` resolved to that user's own ACTIVE membership in the organization |

**Why the approver is authenticated and the author is not.**
- A DRAFT cannot be used by anything production-facing. It becomes usable only through an APPROVE, so the operator-named author is accepted for drafts.
- An APPROVE makes data production-usable, so it never rests on an email the operator typed. Whoever holds the database credential cannot approve in another person's name without that person's own, unexpired access token.

**Refusals, before the database is touched:**
- no token (usage error);
- an unverifiable, expired, foreign-project or non-`authenticated` token (`APPROVER_NOT_AUTHENTICATED`);
- missing verification settings.

The authenticated user must also be an ACTIVE internal member of the named organization (`ACTOR_NOT_MEMBER`). The database's approver ≠ submitter rule (LD004) applies unchanged.

**How the approver obtains the token:** by signing in to the project's Supabase Auth, the same identity they use for the API and, later, the UI. The token is short-lived. It is read from a file or the environment, never from the command line. Production approval through the authenticated API / UI path replaces this CLI step later; the rule stays the same.

## 3. Supabase connections and keys

| Connection | Rules |
|---|---|
| **Migration / intake / org init** (`MIGRATION_DATABASE_URL`) | **Direct connection only** (`db.<project-ref>.supabase.co:5432`, TLS). Both Supavisor pooler modes are refused by the tool. Staging and production need `--confirm <project-ref>` |
| **API runtime** (`DATABASE_URL`) | A separate URL and login role (`design_os_api_login`). It may use the transaction pooler. It has no DDL and is never used for migrations |

**Supabase API keys** use the current model: publishable (`sb_publishable_…`) and secret (`sb_secret_…`), which replace `anon` and `service_role`.
- The web app may hold a publishable key only.
- A secret key never appears in browser or client code, the repository, the web app or the Design OS API.
- The API verifies Supabase JWTs via JWKS and reaches Postgres only as `design_os_api`.

## 4. Remaining risks / notes

- **Draft authors are named by the operator** (`--as`). This is acceptable for DRAFT data only. APPROVE requires the approver's own verified access token (§2.4), so a DB-credential holder cannot approve in someone else's name.
  - An operator could still create DRAFT content under another member's name. It is audited (author, operator, file hash), and it can never be approved without a different, authenticated approver who states the reviewed hash.
- **The migration credential itself stays privileged.** Someone holding it could bypass any tool with direct SQL. The tool removes the *tool* path for approving in another person's name. Protecting the credential (secret store, few holders, the audit chain) remains an operational control (plan §1.4, §6).
- **Token handling:** the approver's access token passes through the operator's machine for the duration of one command. It is short-lived and never logged or stored by the tool. The authenticated API / UI approval path, a later milestone, removes this hand-over.
- **Some types have no domain model yet:** `hardware_item`, `appliance` and `appliance_catalog`. They are readable through G1 but not importable. The V1 pilot does not need them (OD-M6-5; hardware resolves through the Hettich dataset).
- **Recipe / product semantics:** there is no engine-level cross-validation of recipe and product formulas at intake beyond the schema and duplicate checks. The design engine validates them when a design uses them (BLOCKERs), and the approver reviews the golden outputs (§2.2 of the plan).
- **The intake uses repository objects as its schema.** A domain-type change requires a matching schema change (the build enforces it) and a new intake file version.
- **PR #14 (the M6 plan) is still an open draft on GitHub.** The plan's §1.4 / §5.2 key wording should be aligned with §3 above when it is merged.
