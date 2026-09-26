# M6 — V1 Go-Live Readiness Plan (review only)

Status: **PLAN FOR REVIEW.** Nothing in this document is implemented. Nothing connects to hosted Supabase, and no UI work starts, until this plan is approved.

**Baseline:** `main` at `79452c7`, with M5 complete:
- core design API;
- output engines;
- drawings and files;
- OpenAPI 3.1;
- issue and finalization.

**Out of scope for V1 (Phase 2):** manufacturing engine, CNC, nesting, drilling, cut lists and the manufacturing release workflow.

**Sources:**
- `docs/architecture/M5-TECHNICAL-DESIGN.md` (§11–§14);
- `M5-STEP6-OUTPUT-PLAN.md`;
- `M5-STEP7-ISSUE-FINALIZATION.md`;
- `docs/catalog/production-data/*`, `docs/catalog/KIT_BASE_STANDARD_DATA_REQUIRED.md`;
- the data objects in `packages/*/src/data` and the database migrations 0001–0018.

---

## 0. Summary and decisions requested

**Where V1 stands:**

- **Backend foundation:** complete, and tested on local and CI PostgreSQL 17.
- **Production data:** none of it exists. Every Lintel data set is `DRAFT`, and almost every value is NULL / UNVERIFIED (§2).
- **What the missing data blocks:** with the current data, the engines correctly return BLOCKERs. A real project can therefore reach PRELIMINARY / FOR_REVIEW outputs, but not APPROVED, FOR_PRODUCTION or issue.
- **Hosted infrastructure:** none exists. The Mumbai cut-over gate is open (§1).
- **UI:** none exists (§5).
- **Backend gaps found while planning:** the V1 pilot cannot run until these exist (§4.4):
  - **G1** — a read API for reference data;
  - **G2** — controlled reference-data intake;
  - **G3** — a resolved-model preview API for the design workspace;
  - **G4** — organization / user onboarding;
  - **G5** — a Supabase storage adapter;
  - **G6** — a production migration runner.
  - **G7** — readiness and audit-read endpoints (operations; not a pilot blocker, but a go-live gate).

**Decisions requested from the reviewer:**

| # | Decision | Recommendation |
|---|---|---|
| OD-M6-1 | Where the API runs in production | Same platform as ops (Railway, per REGION-01 notes), Mumbai region, one service. Confirm |
| OD-M6-2 | Staging environment | A **separate Supabase project** (Mumbai) for staging and the compatibility check, **not** a branch of the ops project |
| OD-M6-3 | Reference-data intake mechanism (G2) | A reviewed, versioned **intake CLI** that maps signed data files through `@lintel/persistence` and approves them through `design_os.transition()` as the named approvers. Admin UI comes later |
| OD-M6-4 | V1 pilot product scope | **Base-cabinet runs of `KIT_BASE_STANDARD` only.** It is the only product with a recipe. Wall / tall units need new recipe data and a new milestone |
| OD-M6-5 | Pilot room scope | **Rectangular kitchen, walls A–D.** The survey model has no openings, services or appliances; these are recorded outside the system for the pilot |
| OD-M6-6 | Error tracking vendor | Sentry (EU/IN region), with PII scrubbing. Alternatively, structured logs only |
| OD-M6-7 | Point-in-time recovery | Enable PITR on the production project (Pro add-on) before the pilot's first issue |
| OD-M6-8 | How pilot outputs reach the client | V1 pilot: internal user downloads the issued PDF (signed URL) and sends it. The client portal is a later milestone |

---

## 1. Hosted Supabase cut-over

### 1.1 Preconditions (ops-owned; Design OS cannot tick them itself)

These come from the Mumbai gate, M5 §13, items 1–8. Each needs a **dated confirmation from the ops owner** in the go-live record.

| # | Precondition | Evidence |
|---|---|---|
| 1 | REGION-01 console steps done: OAuth redirect URIs, Google provider, edge-function secrets, Railway variables, Meta webhook | ops checklist link |
| 2 | Final re-sync done; parity checks pass | parity report |
| 3 | All clients and cron jobs run on Mumbai | ops confirmation |
| 4 | Soak period passed with no rollback | dates |
| 5 | Seoul pause decision recorded | decision link |
| 6 | Ops migration recovery (`chore/recover-applied-migrations`) merged | PR link |
| 7 | Supabase Pro production project confirmed (project ref) | project ref, plan |
| 8 | Ops `@lintelspace.com` restriction and ops RLS helpers give CLIENT identities no ops access | test evidence. Needed before any CLIENT login; the V1 pilot is internal-only, see OD-M6-8 |

### 1.2 Compatibility verification (gate item 9) — on the staging project, never production

The migrations 0001–0018 run unchanged. The procedure:

1. Take a fresh staging project in Mumbai (OD-M6-2).
2. Record its PostgreSQL version and extensions.
3. Run each check below.
4. Keep the outputs as evidence.

**Roles and ownership:**

- `CREATE ROLE design_os_owner NOLOGIN` and `design_os_api NOLOGIN` work as Supabase's `postgres` role, which is not a superuser.
- `GRANT design_os_owner TO CURRENT_USER` and `SET ROLE design_os_owner` work inside the migration transaction (every migration begins `SET LOCAL ROLE design_os_owner`).
- A dedicated **LOGIN role for the API** (`design_os_api_login`, NOINHERIT, member of `design_os_api`) can be created. The API connects as it and runs `SET LOCAL ROLE design_os_api` per transaction, exactly as in CI.

**`auth.users` integration:**

- `GRANT SELECT, REFERENCES ON auth.users TO design_os_owner` needs a grantor holding that privilege (the table is owned by `supabase_auth_admin`). Verify who can grant it. If `postgres` cannot, record the Supabase-supported alternative before proceeding.
- `design_os.app_user.id REFERENCES auth.users(id)` works.
- Provisioning `app_user` rows for Supabase Auth users is covered by G4.

**SECURITY DEFINER behaviour:**

- These run as `design_os_owner` with `search_path = design_os, pg_temp`:
  - `transition()`, `record_validation_run()`, `claim_idempotency()`;
  - `check_issue()`, `check_snapshot_provenance()`;
  - the audit trigger and the manifest triggers.
- Owner-bypass of RLS inside them behaves as in CI.
- The DB test suite's permission and RLS files (`tenancy-rls`, `error-codes`, `output-purpose`, `provenance`) are run **against staging** as the proof.

**RLS through the pooler:**

- Supavisor runs in **transaction mode**.
- `SET LOCAL ROLE` and `set_config('request.jwt.claims', …, true)` are per-transaction, so they are safe in this mode.
- The `pg` driver sends no named prepared statements; verify that none are sent.
- Run the API DB suite against staging through the pooler URL.

**Exposure:**

- `design_os` is **not** in PostgREST's exposed schemas.
- Nothing is granted to `anon`, `authenticated` or `service_role`. `0011_grants` asserts this; re-assert it on staging.

**Extensions:** none required; `gen_random_uuid`, `sha256` and `jsonb` are core PostgreSQL. Record the server version.

**Migrations:**

- Apply 0001 → 0018 with the production migration runner (G6).
- Roll back to empty, then re-apply.
- Compare `design_os.schema.txt`: the drift check must show zero diff against CI.

**Performance smoke test:**

- Run BOM → BOQ → drawing generation for a 10-cabinet room through the pooler.
- Record the p95 latency.
- Flag anything over 5 s.

**Pass criteria:** every check above is green, with outputs attached to the go-live record. **Only then** is the production project chosen and migrated (§1.6).

### 1.3 Storage (G5)

**Adapter:**

- Implement `SupabaseStorageProvider` behind the existing `FileStorageProvider` interface, in `apps/api/src/infrastructure/storage`.
- The domain and schema do not change (M5 §12).
- The bucket is **private**: `design-os-outputs`, one per environment.

**Keys and checksums:**

- Storage keys stay content-addressed: `org/…/project/…/dv/…/drawing/<sha256>.<ext>`.
- The checksum is verified on upload and on download (as today).
- Signed URLs are Supabase-native and short-lived (300 s), never persisted.
- `GET /file-content/*` is used only by the memory / local providers and is disabled when `FILE_STORAGE=supabase`.

**Orphaned-file limitation (accepted V1 limitation, M5 checkpoint 4 §8):**

- Before go-live, add a **reconciliation report**: storage objects with no `file_object` row.
- It runs **manually** and is read-only. Deletion stays a manual, audited decision; there is no background cleanup.

**Other:**

- Size limit: drawings are small, but set a bucket file-size limit (e.g. 20 MB).
- Backup: Supabase Storage is not covered by the database PITR. Nightly copy of the bucket to a second location (OD: vendor), or accept re-generation. Re-generation is **not** acceptable for issued files, so issued files must be copied.

### 1.4 Environment and secrets

| Variable | Staging / production source | Notes |
|---|---|---|
| `DATABASE_URL` | secret store of the API host | pooler URL, login role `design_os_api_login` |
| `DB_POOL_MAX` | config | sized to the pooler limit |
| `AUTH_ISSUER`, `AUTH_AUDIENCE` | config | the Supabase project's auth issuer |
| `AUTH_JWKS_URL` | config | asymmetric JWT signing keys (preferred over `AUTH_JWT_SECRET`) |
| `CURSOR_SECRET` | secret, ≥ 32 characters, per environment | rotation invalidates open cursors only |
| `FILE_STORAGE=supabase`, bucket, service credential for storage | secret | storage credential scoped to the bucket |
| `FILE_URL_SECRET`, `FILE_URL_BASE` | memory / local only | unused with Supabase-native signed URLs |
| `BUILD_REVISION` | set by the deploy (commit SHA) | the API refuses to start without it |
| `ENGINE_MANIFEST_PATH` | build artefact (`pnpm engines:manifest`) | verified at startup |
| `CORS_ORIGINS` | config | the web app origin(s) only |

**Rules:**

- No secret in the repository, the image or logs. The existing log redaction covers `authorization`, `cookie`, `idempotency-key` and `token`.
- Separate secrets per environment.
- The `service_role` key is **never** given to the API or the web app.

### 1.5 Backup and recovery

- **Pro daily backups** are on. PITR (OD-M6-7) is on before the first real issue.
- Take `pg_dump --schema=design_os` before every hosted migration, and keep it for 30 days.
- The storage bucket is copied nightly (§1.3).
- **Restore drill (acceptance item):**
  1. Restore the latest production backup into staging.
  2. Run the audit-chain verification.
  3. Verify file checksums against `file_object`.
  4. Open an issued quotation / drawing.
  5. Record the recovery time.
- **Data rollback stays forward-fix** (M5 §14): a bad version is corrected by an approved successor, and audit rows are never removed.

### 1.6 Production deployment process

1. **PR** → CI (typecheck, lint, unit, DB, OpenAPI drift) → merge to `main`.
2. **Build:**
   - Build the API image with `BUILD_REVISION = SHA`.
   - Produce the engine manifest (`pnpm engines:manifest`) as a build artefact.
   - Take the OpenAPI document from the repository.
3. **Staging deploy (automatic):**
   - Pending migrations run with the migration runner (G6), which takes a `pg_dump` first.
   - Then the smoke tests run: health / readiness, and one BOM + drawing generation on a synthetic staging project.
4. **Production deploy (manual approval):**
   - Take a `pg_dump`.
   - Run the migrations, **each reviewed and applied in its own step** (forward-only; rollback scripts exist but are for emergencies).
   - Deploy the image.
   - Readiness must be green before traffic switches.
5. **Rollback:**
   - For the API: redeploy the previous image. `/api/v1` is backwards-compatible, and engine fingerprints are recorded, so stored snapshots are unaffected.
   - For a migration: forward-fix, or the tested down script after a fresh dump.

**G6 — production migration runner:** promote the logic of `tests/db/support/migrate.ts` into a small CLI (`pnpm db:migrate --target <env>`). It will:
- apply each file in its own transaction;
- write to the same `design_os_migrations.applied` ledger with checksums;
- refuse a changed checksum;
- require an explicit `--confirm <project-ref>` for production.

---

## 2. Production Lintel data intake

### 2.1 Status vocabulary (never mixed)

| Status | Meaning | Can drive production output? |
|---|---|---|
| **APPROVED** | A version approved through `transition()` by the named approver role, every value with a source and evidence | Yes (and LOCKED after first issue) |
| **DRAFT** | A version record exists, authored, not approved | No — the engines raise BLOCKERs; FOR_PRODUCTION is impossible |
| **UNVERIFIED** | A value is NULL: not provided, or provided without a source or approval | No — it is never defaulted and never zero |
| **TEST_FIXTURE** | Synthetic values for tests only | **Never.** It may not be persisted as production: `assertNoTestFixture`, `data_classification = 'PRODUCTION'` CHECKs, and "never copy" (production-data README) |

**Current state: APPROVED = none.** Every production data set below is DRAFT, and every value marked NULL is UNVERIFIED.

**TEST_FIXTURE counterparts, listed so nobody mistakes them for data:**
- `TEST_FIXTURE_CONSTRUCTION_STANDARD`, `TEST_FIXTURE_EDGE_BAND_STANDARD`, `TEST_FIXTURE_PLANNING_STANDARD` (`packages/catalog-engine/src/fixtures`);
- `TEST_FIXTURE_RATE_CARD`, `TEST_FIXTURE_PRICING_RULES`, `TEST_FIXTURE_QUOTATION_POLICY` (`packages/pricing-engine/src/fixtures`);
- `HETTICH_TEST_FIXTURE_DATASET` (`FIXTURE-*` articles);
- the synthetic module under `tests/db/support/` (carries the database-test-only marker; its isolation is enforced by `tests/synthetic-data-isolation.test.ts`).

### 2.2 Intake procedure (per data set)

1. **Provider** supplies each value with its unit, source document, date and evidence reference (production-data README process).
2. **Author** (role below) encodes the values as a **new DRAFT version** through the intake tool (OD-M6-3). No value may be typed without a source; the tool refuses null-to-value changes that lack `source` and `evidence_ref`.
3. **Checks:**
   - engine validation of the reference cabinet;
   - golden fixtures regenerated and reviewed;
   - the `QUOTATION_TAX_RATE_CONFLICT` check (GST in pricing rules equals the policy rate).
4. **Approver** (role below, a named person, not the author) approves through `transition()`. The version becomes APPROVED, and the audit and approval-decision records are written.
5. **Record** the approval (name, date, version id) in `docs/catalog/production-data/*.md`.

### 2.3 Checklist per data set

Every row is currently **DRAFT**, and every listed field is **UNVERIFIED (NULL)** unless it says otherwise.

| Data set | Code object (current version) | Fields required before APPROVED | Author → Approver |
|---|---|---|---|
| **ConstructionStandard** | `LINTEL_CONSTRUCTION_STANDARD_DRAFT` v0.2.0 | BACK_GROOVE_DEPTH, BACK_REAR_OFFSET, TOP_RAIL_WIDTH, SHELF_FRONT_SETBACK, SHELF_SIDE_CLEARANCE, OVERLAY_EDGE_GAP, OVERLAY_TOP_GAP, OVERLAY_BOTTOM_GAP, FRONT_BETWEEN_GAP, INSET_GAP, FRONT_FINISHED_FACES (count), SHUTTER_BACK_GAP (depends on the chosen hinge system). Each needs unit, source and evidence. Recipe assumptions A1–A7 confirmed (`01-construction-standards.md`) | PRODUCTION → DESIGN_HEAD (provider: Lintel production engineering; approver: production lead + design lead) |
| **PlanningStandard** | `LINTEL_PLANNING_STANDARD_DRAFT` v0.1.0 | MIN_WALL_CLEARANCE, MIN_CABINET_GAP, MAX_GAP_WITHOUT_FILLER, FILLER_THRESHOLD, MAX_RUN_LENGTH, SERVICE_VOID_REAR, and the confirmed meaning of each (`08-planning-standards.md`) | PRODUCTION → DESIGN_HEAD |
| **EdgeBandStandard** | `LINTEL_EDGE_BAND_STANDARD_DRAFT` v0.1.0, `CARCASS_STANDARD: {}` | The full component × side matrix (32 rows) for SIDE_LEFT, SIDE_RIGHT, BOTTOM, TOP_SUPPORT_FRONT, TOP_SUPPORT_BACK, BACK, SHELF, SHUTTER, each side naming an edge band item; plus process data: pre-milling allowance, trim, band-thickness deduction, adhesive (`03-edge-banding-standards.md`) | PRODUCTION → DESIGN_HEAD |
| **Material catalog** | `MATERIALS`, `EDGE_BANDS` (DRAFT items) | BOARD_BWP_18: density, thickness tolerance, grade, brand / supplier (thickness 18 and sheet 1220×2440 are PRD-STATED; confirm). BOARD_HDHMR_18: sheet size, grain, density, tolerance, grade, brand. BOARD_BACK_6: substrate, sheet size, grain, density, tolerance, grade, brand. EDGE_ABS_2MM / EDGE_ABS_0_8MM: width, colour match, brand (0.8 mm is LEGACY-REFERENCE only). Then a material catalog **version** listing the exact approved items | PROCUREMENT → DESIGN_HEAD |
| **Finish catalog** | `FINISHES`: LAMINATE_WHITE (DRAFT) | Surface / texture, brand code, whether a balancing laminate is required (thickness 1 is PRD-STATED; confirm). Then a finish catalog version | PROCUREMENT → DESIGN_HEAD |
| **Hardware catalog** | `HINGE_STANDARD` v1.0.0 (DRAFT), rule `HINGE_SHUTTER`, no article numbers | Lintel hinge selection (family, opening angle, soft-close), mounting mapping confirmed, rule linked to the Hettich articles loaded below. Then a hardware catalog version | PROCUREMENT → PRODUCTION |
| **Product / Recipe catalog** | `KIT_BASE_STANDARD` v1.0.0, `KITCHEN_BASE_STANDARD_V1` v1.1.0 (DRAFT) | The 12 dimensional limits (`05-dimensional-limits.md`: W/H/D min–max etc.); defaults (W 600, H 720, D 560, T 18, TB 6, 1 shelf, 2 shutters, OVERLAY) confirmed; the 6 recipe rules reviewed. Then a product catalog version | DESIGN_HEAD → PRODUCTION |
| **Appliance catalog** | none (DB table only; **no engine consumes appliances**) | **Not required for V1.** The design pin is nullable. The pilot records appliances outside the system (OD-M6-5) | PROCUREMENT → DESIGN_HEAD (future) |
| **Hettich dataset** | `HETTICH_PRODUCTION_DATASET`, `records: []`, `sourceVersion "none-loaded"` | For every article the recipe resolves (hinges and mounting plates for the chosen family): article number, official hettich.com source URL with date / title / version, licence status OFFICIAL_PUBLIC or AUTHORISED (UNKNOWN / RESTRICTED are refused), calculation rules (e.g. hinges per door height), verified by / at. The ops batch `kg_03_hettich_nkba_ingest_01` is a **lead, not a source** | PROCUREMENT → PRODUCTION |
| **PricingStandard** | `LINTEL_PRODUCTION_RATE_CARD` v0.1.0 + `LINTEL_PRODUCTION_PRICING_RULES` (DRAFT, PRODUCTION) | Rate card: boardPerM2 for BOARD_BWP_18, BOARD_HDHMR_18, BOARD_BACK_6; edgeBandPerM for EDGE_ABS_2MM, EDGE_ABS_0_8MM; finishPerM2 for LAMINATE_WHITE; hardwarePerUnit per loaded Hettich article; effectiveFrom. Rules: manufacturingCost formula, wastage % (board, edge band, finish), overhead %, margin basis and %, GST %. The legacy `rate_library` is **not** a source | COSTING → **FINANCE** (FINANCE-only approval) |
| **QuotationPolicy** | `LINTEL_PRODUCTION_QUOTATION_POLICY` v0.1.0 (DRAFT) | taxRates (rate ids and %), taxRateByProductCategory (KITCHEN_BASE → rate id), taxPolicy (PER_LINE / PER_RATE_GROUP), rounding (tax, grand total: mode + increment), discountPolicy (NONE only). Tax adviser sign-off | COSTING → **FINANCE** |
| *ManufacturingStandard* | none (Phase 2) | **Not required for V1** | — |

**Pilot minimum:** every row above except Appliance and ManufacturingStandard must be APPROVED before a pilot design can be APPROVED (engineering rows), priced (PricingStandard) and quoted (QuotationPolicy).

**G2 — intake tooling (OD-M6-3):**

- **What the CLI does:**
  1. Reads a signed data file (JSON / YAML) per version.
  2. Maps it with the existing `@lintel/persistence` mappers (`*ToRows`), which already refuse TEST_FIXTURE.
  3. Inserts it as DRAFT, acting as the author.
  4. Approves it by calling `transition()` as the approver in a separate, approver-run command. Separation of duties is enforced by the database.
- **Why:** there is no reference-data write API today, and V1 does not need one; an admin UI is later.
- **Review:** the CLI and the data files are reviewed like code.

---

## 3. V1 production gates

These are the exact conditions for a **real Lintel project**. The database-enforced conditions already exist (migrations 0008–0018). The data conditions follow from §2.

| State / action | Database / API enforced (exists) | Additionally required for a real project |
|---|---|---|
| **IN_REVIEW** (SUBMIT) | APPROVAL validation run for the current input hash and revision exists (LD010); author permission | Room survey entered from a real measurement (§4) |
| **APPROVED** | IN_REVIEW; approver ≠ submitter (LD004); `design_version.approve`; `expectedContentHash` matches; the latest APPROVAL run has **0 BLOCKERs**; every pinned engineering dependency APPROVED / LOCKED | All engineering data sets of §2.3 APPROVED and pinned; the running build validates with 0 BLOCKERs, which is impossible until they are |
| **LOCKED** | APPROVED; `design_version.lock` (or an issue action); cascades LOCK to the pinned engineering versions | A named person decides the design is final for issue |
| **FOR_REVIEW output** | Design IN_REVIEW / APPROVED / LOCKED / SUPERSEDED; BLOCKERs shown, never hidden; watermarked | Reviewer is internal; FOR_REVIEW is never issued |
| **FOR_PRODUCTION output** | Design APPROVED / LOCKED; OUTPUT_GENERATION run of the **running build** with 0 BLOCKERs; output 0 BLOCKERs; BOM complete (every hardware requirement resolved); commercial versions APPROVED / LOCKED; no TEST_FIXTURE anywhere (DB CHECKs) | Hettich dataset loaded and APPROVED (so hardware resolves); PricingStandard and QuotationPolicy APPROVED by FINANCE |
| **QUOTATION ISSUE** | `quotation.issue`; design LOCKED; FOR_PRODUCTION; 0 BLOCKERs; current inputs and dependency content; declared content hash and exact commercial versions match; locks them; one issue per snapshot / revision; audited | GST / tax sign-off recorded; a person has reviewed the quotation PDF / payload; client identity for delivery is outside the system (OD-M6-8) |
| **DRAWING ISSUE** | `drawing.issue`; design LOCKED; FOR_PRODUCTION; 0 BLOCKERs; exact sealed file manifest; one issue per snapshot / number + revision; audited | Drawing numbering scheme agreed (per project); checker = approver of the design version (title block from records) |

**Operational gates** apply to every state on hosted infrastructure:
- the §1 cut-over is complete;
- PITR is on (OD-M6-7);
- the restore drill has passed;
- monitoring and alerting are live (§6).

---

## 4. Real-project pilot (internal, no manufacturing)

### 4.1 Scope

- **One real Lintel kitchen project,** internal users only:

  | Role | Pilot user |
  |---|---|
  | SALES | 1 |
  | DESIGNER | 1 |
  | DESIGN_HEAD | 1 |
  | COSTING | 1 |
  | FINANCE | 1 |
  | SITE_ENGINEER | 1 |

- **Room:** rectangular kitchen, walls A–D (OD-M6-5).
- **Product:** base-cabinet runs of `KIT_BASE_STANDARD` only (OD-M6-4).
- **Outputs:** BOM, BOQ, pricing, quotation, and execution drawings (wall internal elevations, room panel schedule, cabinet drawings).
- **Excluded:**
  - manufacturing documents, cut lists, CNC and nesting;
  - client portal login (the PDF goes to the client by email, OD-M6-8);
  - appliances in the model.

### 4.2 Workflow (every step through the V1 UI, §5)

| # | Step | Actor (role) | System | Evidence / gate |
|---|---|---|---|---|
| 1 | Project | SALES | `POST /clients`, `POST /projects`, assign members | project code, members |
| 2 | Measurement | SITE_ENGINEER | on-site tape / laser; openings, services and appliance positions noted **off-system** (OD-M6-5) | signed measurement sheet (scan attached to project record — see risk R4) |
| 3 | Room | SITE_ENGINEER | `POST /projects/{id}/rooms` with `initialSurvey` (length, width, height, wall thickness, source) | room survey revision 1 |
| 4 | Design | DESIGNER | `POST /rooms/{id}/designs` | design |
| 5 | Design version | DESIGNER | `POST /designs/{id}/versions` with the exact APPROVED engineering pins (picked from G1), place cabinets (`/objects`), overrides if any | DRAFT, input hash |
| 6 | Validation | DESIGNER | `POST /validation-runs` (APPROVAL); fix BLOCKERs; SUBMIT | 0 BLOCKERs, IN_REVIEW |
| 7 | Review and approve | DESIGN_HEAD | FOR_REVIEW BOM / drawings to review; APPROVE with content hash | APPROVED (≠ submitter) |
| 8 | BOM | DESIGNER | `POST /bom-snapshots` FOR_PRODUCTION | complete BOM, 0 BLOCKERs |
| 9 | BOQ | DESIGNER | `POST /boq-snapshots` FOR_PRODUCTION (consumes the exact BOM) | BOQ |
| 10 | Pricing | COSTING | `POST /pricing-snapshots` FOR_PRODUCTION with the APPROVED PricingStandard version | PRICED (not UNAVAILABLE) |
| 11 | Quotation | COSTING | `POST /quotation-snapshots` FOR_PRODUCTION with the APPROVED QuotationPolicy | revision 1 |
| 12 | Execution drawings | DESIGNER | `POST /drawing-snapshots` FOR_PRODUCTION: WALL_INTERNAL_ELEVATION per wall, ROOM_PANEL_SCHEDULE, cabinet drawings as needed | PDF + SVG, sealed manifest |
| 13 | Lock | DESIGN_HEAD (or SALES at issue) | transition LOCK | LOCKED (locks the engineering pins) |
| 14 | Issue | SALES (quotation), DESIGN_HEAD (drawings) | `POST /quotation-snapshots/{id}/issue`, `POST /drawing-snapshots/{id}/issue` | immutable issue records; commercial versions LOCKED; audit |
| 15 | Deliver | SALES | download issued PDFs (signed URL), send to the client | delivery noted in the project record |

**Pilot exit:**
- all 15 steps are done on the real project without database intervention;
- the outputs are reconciled against the team's manual BOM / quotation for the same kitchen, with differences explained;
- the issued documents are accepted by the design head and finance.

### 4.3 Pilot data prerequisite

**Every §2.3 data set except Appliance and ManufacturingStandard is APPROVED on production.** Without it, steps 6–14 stop at BLOCKERs or UNAVAILABLE, which is the correct and intended behaviour.

### 4.4 Backend gaps to close before the pilot (implementation after this plan is approved)

| # | Gap | Why | Size |
|---|---|---|---|
| G1 | **Reference-data read API**: list / get versions of standards, catalogs, Hettich datasets, PricingStandard, QuotationPolicy (status, label, content hash) | The UI must pick exact pins and commercial versions; there is no endpoint today | small |
| G2 | **Reference-data intake CLI** (OD-M6-3) | There is no way to enter approved production data | medium |
| G3 | **Resolved-model preview**: `GET /design-versions/{id}/model`, a non-persisted engine resolution (component boxes, placements, runs, validation messages) | The 2D / 3D workspace must render the engine's geometry; the UI never calculates | medium |
| G4 | **Organization and user onboarding**: provision `app_user` from Supabase Auth, org membership and roles (ADMIN-only, audited) | Today members exist only via SQL seeding | small |
| G5 | **SupabaseStorageProvider**, plus the orphan reconciliation report | Hosted file storage | small |
| G6 | **Production migration runner** | Hosted migrations | small |
| G7 | **Readiness and audit-read endpoints** (§6) | Operations | small |

---

## 5. UI / Design Studio — architecture plan (first UI milestone, M7; review only)

### 5.1 Principles

- **The UI is a view / controller over the API.** No business calculations, no geometry rules, no pricing (CLAUDE.md).
- **Every number comes from the API** (engine outputs) or the G3 preview. The UI never re-derives BOM, BOQ, price or dimensions.
- **Types come from the OpenAPI 3.1 document.** A generated typed client (`openapi-typescript` + a thin fetch wrapper) lives in `packages/api-client`. Domain types are never re-declared in UI packages.
- **Errors are RFC 9457 problems,** mapped by `code` (never by title) to user messages. ETag / If-Match and Idempotency-Key are handled by the client wrapper.

### 5.2 Stack

- **Framework:** Next.js (App Router) + React + TypeScript, with Tailwind (PRD §7).
- **Structure:** `apps/web` for the designer studio; `packages/ui` for shared components.
- **Auth:** Supabase Auth (email and Google, as ops). The web app holds the session and sends `Authorization: Bearer <access token>` and `X-Org` to the API. The web app has **no database access** and no service key.
- **Data:** TanStack Query for server state (cache keys per resource, ETag-aware mutations). Local UI state only for editor interaction.
- **3D / 2D:**
  - Three.js via react-three-fiber renders the G3 model (component boxes, placements), read-only geometry.
  - Placement edits send object create / update requests; the API returns the new state, and the view re-renders from the engine result.
  - 2D plan view is an SVG top-down projection of the same model.
- **Drawings:** show the stored SVG sheets (signed URL) and download the PDF. No drawing is rendered client-side.

### 5.3 Minimum V1 screens

| Area | Screens | API used |
|---|---|---|
| Authentication | Sign-in, sign-out, session expiry | Supabase Auth; `GET /me` |
| Organization / project selection | Org switcher (`/me/organizations`), project list | `/me`, `/projects` |
| Project dashboard | Client, members, rooms, designs, latest versions and their status, outputs graph per version | `/projects/{id}`, `/rooms`, `/designs`, `/design-versions/{id}/outputs` |
| Room setup / measurement | Room create, survey revision entry (length, width, height, wall thickness, source), revision history | `/rooms`, `/rooms/{id}/revisions` |
| Design workspace | Version header (status, ETag, pins), cabinet list, properties panel (dimensions, parameters within product limits), relationship overrides | `/design-versions/{id}`, `/objects`, `/overrides`, G1, G3 |
| 2D / 3D view | Plan (2D) and 3D viewer of the G3 model; selection syncs with the list | G3 |
| Cabinet placement | Add, move and resize on a wall; every change is an API write, then re-render | `/objects` (If-Match) |
| Design-version lifecycle | Create version (exact pins picker), submit, request changes, approve (content hash shown), lock; new version from a base | `/versions`, `/transitions` |
| Validation / blockers | Run validation; BLOCKER / WARNING list linked to objects and components; "can approve" state | `/validation-runs` |
| BOM | Generate (purpose picker), room totals, per-cabinet lines, completeness, staleness | `/bom-snapshots` |
| BOQ | Generate, lines, link to BOM | `/boq-snapshots` |
| Pricing | Choose an exact PricingStandard version; PRICED totals or UNAVAILABLE blockers | `/pricing-snapshots` (COSTING) |
| Quotation | Choose QuotationPolicy; lines, tax groups, totals; revision | `/quotation-snapshots` |
| Drawings | Generate by type / wall / cabinet; sheet viewer (SVG); PDF download; files | `/drawing-snapshots`, `/files/{id}/url` |
| Issue / review | Issue quotation / drawing (confirm content hash and commercial versions); issued badge; issue record; staleness and "newer version" advisories | `/issue` endpoints |

**Visibility:** every screen hides actions the user's permissions (`/me`) do not allow. The API still enforces them.

### 5.4 Quality

**Tests:**
- Component tests.
- Playwright end-to-end tests of the full pilot workflow (§4.2) against a local API and PostgreSQL with synthetic test data. TEST_FIXTURE data appears **only** in the E2E environment.

**Access and presentation:**
- Accessibility: keyboard reachable, labelled controls.
- The target is desktop browsers (the design studio). Mobile and the client portal are later milestones.

---

## 6. Production readiness

| Concern | Today | Required for V1 |
|---|---|---|
| Logging | Structured pino logs with redaction; `x-request-id` on every response | Ship JSON logs to the host's log drain; 30-day retention; request id, user id and org id on every line; no bodies, no secrets |
| Monitoring | none | Uptime check on `/api/v1/health` and readiness; latency / error-rate dashboards per route; database CPU, connections and pooler saturation; storage usage; alerts to the on-call channel |
| Error tracking | none | OD-M6-6 (Sentry), with release = `BUILD_REVISION` and PII scrubbing; 5xx and `INTERNAL*` problems alert |
| Audit visibility | hash-chained `audit_log`, `approval_decision`, issue records; no API | Read-only audit API for `audit.read` (G7) by entity / project / date; an audit-chain verification command run nightly with an alert on mismatch |
| Backups | none (hosted) | §1.5: daily + PITR + pre-migration dumps + storage copy; quarterly restore drill |
| Deployment | CI only | §1.6: staging auto, production with manual approval, readiness-gated |
| Environment separation | local / CI | local (Docker PostgreSQL 17, memory storage), staging (separate Supabase project), production; separate secrets, buckets and auth projects |
| Secret management | env vars | Host secret store; rotation runbook (cursor secret, storage credential, JWT key rotation via JWKS) |
| Rate limiting | none (1 MB body limit) | `@fastify/rate-limit`: per user plus a per-IP fallback; stricter on generation / issue POSTs (e.g. 30 / min per user) and on `/file-content`; 429 as an RFC 9457 problem |
| API health checks | `/api/v1/health` (liveness only) | Add `/api/v1/ready`: database round-trip as `design_os_api`, applied-migration version = expected, engine manifest loaded, storage reachable. Readiness gates deploys and traffic |
| Rollback | M5 §14 | API: redeploy previous image. DB: forward-fix or tested down after dump. Data: approved successor, never deletion. Storage: immutable, content-addressed |

---

## 7. V1 acceptance checklist (internal real-project pilot)

Each item needs evidence (link, report or test run) in the go-live record. **V1 is ready for the pilot when every box is ticked.**

**A. Infrastructure and cut-over**

- [ ] Mumbai gate items 1–8 confirmed by the ops owner (§1.1)
- [ ] Gate item 9 compatibility verification passed on staging, with outputs attached (§1.2)
- [ ] Production project migrated 0001 → latest with the migration runner; drift check zero diff
- [ ] Private storage bucket live; checksums verified on a round trip; orphan reconciliation report runs
- [ ] Secrets in the host store; nothing in the repository or image; `service_role` not used by the API or web app
- [ ] Daily backups + PITR on; restore drill passed with recovery time recorded

**B. Security and access**

- [ ] RLS / permission suites green against staging through the pooler
- [ ] `design_os` not exposed via PostgREST; no grants to anon / authenticated / service_role
- [ ] Pilot users onboarded with least-privilege roles (G4); separation of duties verified (submitter ≠ approver)
- [ ] CLIENT logins remain disabled for the pilot (OD-M6-8), or gate item 8 is verified

**C. Production data**

- [ ] ConstructionStandard, PlanningStandard, EdgeBandStandard APPROVED with sources (§2.3)
- [ ] Material, Finish, Hardware and Product / Recipe catalog versions APPROVED
- [ ] Hettich dataset loaded with official sources and cleared licences, APPROVED
- [ ] PricingStandard and QuotationPolicy APPROVED by FINANCE; no tax-rate conflict
- [ ] No TEST_FIXTURE value anywhere in production (DB check query run and attached)
- [ ] Reference cabinet (600 × 720 × 560, 2 shutters, 1 shelf) validates with 0 BLOCKERs; golden outputs reviewed by the design head

**D. Product**

- [ ] Backend gaps G1–G7 implemented and tested
- [ ] V1 UI (§5.3) complete; Playwright pilot-workflow E2E green
- [ ] OpenAPI drift check green; typed client generated from it

**E. Operations**

- [ ] Logging, monitoring, error tracking and alerting live (§6)
- [ ] `/ready` gates deploys; rate limiting on
- [ ] Nightly audit-chain verification green
- [ ] Deployment and rollback runbooks written and rehearsed on staging

**F. Pilot**

- [ ] Pilot users trained; pilot project chosen (rectangular kitchen, base runs, OD-M6-4 / 5)
- [ ] All 15 workflow steps (§4.2) complete on the real project without database intervention
- [ ] Outputs reconciled against the manual BOM / quotation; differences explained
- [ ] Issued quotation and drawings accepted by the design head and finance

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Production data takes longer than the software | Start the §2 data intake now, in parallel with G1–G7 and the UI; it is the critical path |
| R2 | Supabase `auth.users` REFERENCES grant not available to `postgres` | Found by §1.2 on staging before production; the fallback is recorded before proceeding |
| R3 | The pilot kitchen needs products other than base cabinets | OD-M6-4: choose a base-run kitchen, or schedule wall / tall recipes (new data plus a milestone) |
| R4 | Openings, services and appliances are not modelled | OD-M6-5: recorded off-system; the measurement sheet is attached to the project record (file upload is a later feature; until then, stored in the existing document system) |
| R5 | Orphaned files in hosted storage | Accepted V1 limitation; manual read-only reconciliation report (§1.3) |
| R6 | Issued files not covered by database PITR | Nightly bucket copy (§1.3) |
| R7 | Engine change after issue | Issued outputs keep their fingerprint and are flagged `ENGINE_CHANGED` for possible re-issue; never altered |

---

## 9. Proposed sequence (after approval)

1. **Now, in parallel:**
   - production data intake (§2) — Lintel teams;
   - ops confirms gate items 1–8.
2. **M6-A (backend, local / CI):** G1, G2, G3, G4, G6, G7, then the rate limiting and readiness of §6.
3. **M6-B (staging):**
   - create the staging project;
   - gate item 9 verification;
   - G5 storage;
   - deploy pipeline;
   - monitoring.
4. **M7 (UI):** §5, with E2E tests on synthetic data.
5. **Production:**
   - migrate;
   - intake the APPROVED data;
   - onboard users;
   - restore drill;
   - acceptance checklist §7.
6. **Pilot** (§4).

Each step stops for review, as in M5.
