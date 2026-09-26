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

**Submit and approve:** `submit` and `approve` call `design_os.transition()` as the named person.
- `submit` is refused while the database's approval preconditions report problems.
- `approve` requires `--expected-content-hash`.
- The database enforces the rest: the action (LD001), approver ≠ submitter (LD004), the reviewed hash (LD007), dependency lifecycles and completeness.
- The tool never writes a status itself.

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

- **The intake actor is asserted by the operator.** `--as <email>` must be a real, permitted member, and the audit names both the actor and the operator. But the CLI trusts whoever holds the migration credential to name the right person.
  - Mitigation: the named person runs, or witnesses, their own `approve`, and the operator is recorded.
  - An authenticated admin UI or API replaces this later (deferred by OD-M6-3).
- **Some types have no domain model yet:** `hardware_item`, `appliance` and `appliance_catalog`. They are readable through G1 but not importable. The V1 pilot does not need them (OD-M6-5; hardware resolves through the Hettich dataset).
- **Recipe / product semantics:** there is no engine-level cross-validation of recipe and product formulas at intake beyond the schema and duplicate checks. The design engine validates them when a design uses them (BLOCKERs), and the approver reviews the golden outputs (§2.2 of the plan).
- **The intake uses repository objects as its schema.** A domain-type change requires a matching schema change (the build enforces it) and a new intake file version.
- **PR #14 (the M6 plan) is still an open draft on GitHub.** The plan's §1.4 / §5.2 key wording should be aligned with §3 above when it is merged.
