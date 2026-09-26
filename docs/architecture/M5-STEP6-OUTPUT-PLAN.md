# M5 Step 6: Output Architecture and API Contract (review-only plan, revision 2)

**Status:** revision 2. It records the decisions OD-S6-1 … OD-S6-8 and the architectural corrections from the review of revision 1.

**Nothing here is implemented.** This step contains:

- no migration SQL;
- no engine code;
- no BOM, BOQ, pricing, quotation, drawing or manufacturing API;
- no UI;
- no hosted Supabase;
- no production rates, Hettich data or ManufacturingStandard values.

**Builds on:**

- `M5-TECHNICAL-DESIGN.md` §3 and §6.
- `M5-STEP4-API-PLAN.md` §6–§8.1.
- `M5-STEP5-CORE-DESIGN-API.md`, with migrations 0015 (catalog/object guard) and 0016 (engine build).

**Contents**

0. Decisions recorded
1. Survey findings
2. Dependency graph
3. Engineering and commercial dependency model
4. Output engine identity and provenance
5. Server-orchestrated dependency resolution
6. Output snapshot schema
7. Snapshot uniqueness and idempotency
8. Staleness algorithm
9. Validation and purpose rules
10. Per-output contracts, including the drawing engine → endpoint map and the manufacturing boundary
11. Drawing file model
12. Output permission matrix
13. Endpoint list
14. Request and response schemas
15. OpenAPI approach
16. Prerequisite matrix
17. Changes the next step must make (described here; not written)
18. Unresolved risks
19. Implementation sequence after approval

---

## 0. Decisions recorded

| ID | Decision |
|---|---|
| OD-S6-1 | **Manufacturing-document generation is deferred.** No manufacturing engine and no production ManufacturingStandard exist, and no new manufacturing calculation is created to satisfy the roadmap. This step documents the future boundary (§10.6) and the current production blockers (§16). No manufacturing output endpoint is created. |
| OD-S6-2 | **The server resolves output dependencies.** A client requests the output it wants. The server finds an exact compatible upstream snapshot, or generates one, and records the exact dependency. There is never a global "latest". A client may name an exact existing upstream snapshot only to reproduce an earlier output (§5). |
| OD-S6-3 | **The fingerprint is per output engine:** `validation`, `bom`, `boq`, `pricing`, `quotation`, `drawing` (and `manufacturing` later). Each output records engine name, semantic version, exact build and fingerprint. There is no generic fingerprint (§4). |
| OD-S6-4 | **A pure `priceRoom` is added to `@lintel/pricing-engine`.** The API and application layer never calculate a price or total. |
| OD-S6-5 | **UNAVAILABLE pricing or quotation is not persisted.** The caller receives `UNAVAILABLE` and structured blockers. TEST_FIXTURE pricing stays test-only. |
| OD-S6-6 | **Engineering and commercial dependency domains are separate.** PricingStandard or QuotationPolicy changes never make BOM, BOQ, drawings or validation stale. The exact hash model is in §3. |
| OD-S6-7 | **When manufacturing documents exist:** generation requires `output.generate.engineering`, and release to manufacturing requires `manufacturing.release`. The two are never conflated. Deferred for now. |
| OD-S6-8 | **Both room-level and cabinet-level drawings are included,** using only the existing M3/M4 drawing engine (§10.5). |
| Dependency rule | **A downstream output uses an exact immutable upstream snapshot.** The server verifies the snapshot's provenance and content hash and uses its payload. It **never re-runs the upstream output engine to check it.** If the upstream is stale or incompatible, the server first generates a new upstream snapshot and uses that one (§5). |

---

## 1. Survey findings (from revision 1; unchanged facts)

| # | Finding |
|---|---|
| F1 | **There is no manufacturing engine.** `packages/manufacturing-engine` contains only a README ("not started", PRD Phase 7). There is no ManufacturingStandard type and its variable registry is empty. Every value is NULL / UNVERIFIED. |
| F2 | **Only three engine version constants exist:** `ENGINE_VERSION` (design, 0.1.0), `PRICING_ENGINE_VERSION` and `DRAWING_ENGINE_VERSION`. The BOM and BOQ engines have none, and the quotation module has none of its own. |
| F3 | **There is no room-level pricing function.** In addition, `priceQuotation` **re-prices every cabinet internally** (it calls `priceCabinet`), so today it cannot consume an existing pricing snapshot. |
| F4 | **Snapshot tables have no engine build, engine name or engine fingerprint.** Their `engine_hash` is the engine's 53-bit payload seal (`hash53`), not a fingerprint. |
| F5 | **`drawing_snapshot_file` has primary key `(snapshot_id, format)`,** which allows one SVG per snapshot. `drawing_type` has no CHECK and defaults to `FRONT_ELEVATION`. |
| F6 | **The `manufacturing_document_snapshot` INSERT policy requires `manufacturing.release`**, which conflates generation with release (OD-S6-7). |
| F7 | **No snapshot uniqueness exists in the database.** `M5-TECHNICAL-DESIGN.md` §6 describes one that was never created. |
| F8 | **All production commercial data is NULL or DRAFT**, so production pricing and quotation return UNAVAILABLE. |
| F9 | **`record_validation_run()` accepts only DRAFT or IN_REVIEW design versions.** |
| F10 | **One `input_hash` covers everything today.** `input_hash` (and the DB counter `input_revision`) covers the room revision, objects, overrides **and all 12 pins, commercial ones included**. Validation, SUBMIT (LD010) and APPROVE are bound to it. A commercial pin change on a DRAFT therefore invalidates the validation run today. |

---

## 2. Dependency graph

```
DesignVersion ──► Validation                      (approval evidence; not an input of any output)

DesignVersion ──► BOM ──► BOQ ──► Pricing ──► Quotation
   engineering     │       │        ▲  ▲          ▲  ▲
   inputs          │       │        │  │          │  └── QuotationPolicy pin      (commercial)
                   │       │        │  └──────────┼───── PricingStandard pin      (commercial)
                   │       └────────┼─────────────┘      (Quotation uses the BOQ snapshot)
                   └────────────────┘                    (Pricing uses the BOM and BOQ snapshots)

DesignVersion ──► Drawings                         (room-level and cabinet-level; engineering inputs only)

DesignVersion ──► Manufacturing Document            (FUTURE ONLY: engineering inputs + ManufacturingStandard pin)
```

**Edges persisted on each snapshot:**

| Snapshot | Upstream snapshots | Inputs from the design version |
|---|---|---|
| BOM | none | engineering |
| BOQ | `bom_snapshot_id` | engineering |
| Pricing | `bom_snapshot_id`, `boq_snapshot_id` | engineering + pricing |
| Quotation | `boq_snapshot_id`, `pricing_snapshot_id` | engineering + pricing + quotation policy |
| Drawing | none | engineering |

**Rules:**

- Commercial dependencies enter only at Pricing and Quotation.
- Every engineering-domain output stays current when only commercial dependencies change. A Pricing snapshot also stays current when only the QuotationPolicy changes.

---

## 3. Engineering and commercial dependency model (OD-S6-6)

### 3.1 Domains

| Domain | Inputs | Consumed by |
|---|---|---|
| **ENGINEERING** | room survey revision (id + `content_hash`); design objects (without row ids); relationship overrides (full history); engineering pins: construction standard, planning standard, edge-band standard, material catalog, finish catalog, hardware catalog, product catalog, Hettich dataset, appliance catalog (nullable) | Validation, BOM, BOQ, Drawings, and Pricing, Quotation and Manufacturing through their engineering part |
| **PRICING** (commercial) | PricingStandard pin (rate card + pricing rules, one version) | Pricing, Quotation |
| **QUOTATION** (commercial) | QuotationPolicy pin | Quotation |
| **MANUFACTURING** (future) | ManufacturingStandard pin | Manufacturing Document |

The appliance catalog is engineering because appliances are placed design content. No engine consumes it yet (there is no appliance data), but it cannot be commercial.

### 3.2 Hashes and counters

**On `design_version`** (proposed; §17):

| Column | Definition | Maintained by |
|---|---|---|
| `engineering_input_hash` | `@lintel/persistence` `engineeringInputHash()` = SHA-256 of `{ roomRevision: {id, contentHash}, objects (no row ids), overrides, engineeringPins }` | API, recomputed on every draft change (like today's `input_hash`) |
| `engineering_input_revision` | counter, bumped by any change to objects, overrides, room revision or an engineering pin | **database** triggers (like `input_revision`); the API cannot forge it |
| `input_hash` (existing) | redefined as `designInputHash()` = SHA-256 of `{ engineeringInputHash, pricingStandardVersionId, quotationPolicyVersionId, manufacturingStandardVersionId }`: the whole version's inputs | API |
| `input_revision` (existing) | unchanged: bumped by any input change | database |

**Commercial pins need no hash and no counter on the design version.**

- They are plain id columns that the database can compare directly.
- The counters exist only because the engineering hash is computed in TypeScript over rows the database cannot hash.

**On each snapshot:**

| Column | Meaning |
|---|---|
| `engineering_input_hash`, `engineering_input_revision` | copied from the design version; the trigger checks equality at insert |
| `dependency_hashes` jsonb | `{ pinColumn → dependencyHash }` for **exactly the pins this kind consumes** (§3.3) |
| `dependency_set_hash` | SHA-256 of `dependency_hashes` (canonical) |
| `commercial_input_hash` | Pricing: `H({ pricingStandardVersionId, dependencyHash })`. Quotation: `H({ pricing part, quotationPolicyVersionId, dependencyHash })`. NULL for engineering kinds. |
| `input_hash`, `input_revision` | the design version's whole-input values, **recorded for provenance only**; never used for staleness or uniqueness |

`dependencyHash(pinned version)` is the SHA-256 of the pinned version's envelope content hash **plus its child rows**: values, rules, rate lines, tax rates, catalog members and Hettich articles.

- Reading and hashing the child rows directly means a DRAFT dependency whose child rows changed is detected even though its envelope `content_hash` is set only by the author.
- For APPROVED and LOCKED versions the child rows are frozen, so the hash is constant.

### 3.3 Consumed pins by kind (the only pins in `dependency_hashes`)

| Kind | Engineering pins | PricingStandard | QuotationPolicy | ManufacturingStandard |
|---|---|---|---|---|
| Validation | ✓ | — | — | — |
| BOM | ✓ | — | — | — |
| BOQ | ✓ | — | — | — |
| Drawing | ✓ | — | — | — |
| Pricing | ✓ | ✓ | — | — |
| Quotation | ✓ | ✓ | ✓ | — |
| Manufacturing (future) | ✓ | — | — | ✓ |

Pin columns a kind does not consume are **NULL on its snapshot**. The existing trigger already does this for pricing, quotation and manufacturing.

### 3.4 Consequences (the correction this achieves)

1. Changing the PricingStandard or QuotationPolicy pin on a DRAFT changes `input_hash` and `input_revision` only.
   - `engineering_input_hash` and `engineering_input_revision` are unchanged.
   - Validation, BOM, BOQ and drawings stay current.
   - Changing the QuotationPolicy leaves Pricing current.
2. **Validation binds to the engineering domain.** Runs record `engineering_input_hash` and `engineering_input_revision`. SUBMIT (LD010) and APPROVE require a run for the **current engineering** hash and revision. A commercial re-pin no longer forces re-validation. This fixes F10.
3. **Approval rules are unchanged.** Every non-null pin, commercial included, must be APPROVED or LOCKED to approve a design version. Commercial pins remain frozen once the version leaves DRAFT.
   - Pricing an APPROVED design with a different price list still needs a new design version.
   - That version's engineering outputs are new snapshots, because snapshots are per exact design version.
   - The engine work is deterministic, and nothing becomes stale on the old version.
   - Moving commercial pins off the design version is recorded as risk R1 (§18) and is **not** part of this plan.

---

## 4. Output engine identity and provenance (OD-S6-3)

### 4.1 Output engines

| Engine name | Package / entry points | Semantic version | Engines it invokes (components) |
|---|---|---|---|
| `validation` | `@lintel/design-engine` `resolveRoom` (`.validation`) | `ROOM_ENGINE_VERSION` | design-engine and its rules, geometry, catalog and Hettich libraries |
| `bom` | `@lintel/bom-engine` `generateRoomBom` | **`BOM_ENGINE_VERSION`** (new) | + design-engine `resolveRoom` |
| `boq` | `@lintel/boq-engine` `generateRoomBoq` | **`BOQ_ENGINE_VERSION`** (new) | + design-engine `resolveRoom` |
| `pricing` | `@lintel/pricing-engine` **`priceRoom`** (new) | `PRICING_ENGINE_VERSION` | + design-engine `resolveRoom` |
| `quotation` | `@lintel/pricing-engine` quotation module, **`quoteRoom`** (new; §10.4) | **`QUOTATION_ENGINE_VERSION`** (new) | + design-engine `resolveRoom` |
| `drawing` | `@lintel/drawing-engine` `create*`, `renderSvg`, `renderPdf` | `DRAWING_ENGINE_VERSION` | + design-engine `resolveRoom` |
| `manufacturing` (future) | `@lintel/manufacturing-engine` | future constant | future |

`resolveRoom` is part of each output engine's own invocation. The resolved room is never stored, and it is not an output snapshot, so resolving it is not "re-running an upstream output engine". Upstream *output* engines (bom → boq → pricing → quotation) are **never re-run** by a downstream output.

### 4.2 Recorded on every snapshot and validation run

| Column | Value |
|---|---|
| `engine_name` | one of §4.1. A registry table `output_engine(name, snapshot_kind)` plus a CHECK tie each snapshot kind to its engine. |
| `engine_version` | the output engine's semantic version |
| `engine_build` | Git commit SHA / build revision (Step 5: `BUILD_REVISION` → `GITHUB_SHA` → Git checkout, `+dirty` locally) |
| `engine_source_hash` | see OD-S6-9 |
| `engine_components` | jsonb `{ "@lintel/design-engine": "0.1.0", "@lintel/bom-engine": "0.1.0", … }`: the semantic versions of every engine package the output engine invokes |
| `engine_fingerprint` | SHA-256 of `{ engine: name, version, components, sourceHash, build? }` (see OD-S6-9) |
| `engine_seal` | the engine's own `hash53` payload seal when it has one (drawing, pricing, quotation); NULL otherwise. For `verify*()` parity only; never authoritative. |

**Validation runs get the same `engine_name` (`validation`) and `engine_fingerprint` scheme.** The existing `engine_hash` column is the validation fingerprint under the new definition. Only development rows exist.

**The platform build.** In this monorepo the API and all engines share the commit SHA, so `engine_build` is also the platform build. A separate platform/orchestrator build column is **not** added now. It can be added later without replacing any engine field.

### 4.3 OD-S6-9 (new decision requested): what the fingerprint hashes

| Option | Fingerprint input | Effect |
|---|---|---|
| **A (recommended)** | `{ name, version, components, sourceHash }`, where `sourceHash` is the Git **tree** hash of the output engine's package directory and every workspace package it depends on (for example `git rev-parse HEAD:packages/bom-engine`), computed at build time into a small manifest, with `+dirty` in dirty local checkouts. `engine_build` (commit SHA) is recorded as well. | A code change to that engine or its dependencies changes its fingerprint automatically, with no manual bump. A deploy that changes only the API, docs or another engine does **not** make its outputs stale. |
| B | `{ name, version, components, build }` (commit SHA) | Simpler, but **every** deploy makes **every** output stale (§8), even when no engine code changed. |

Either way, the output records name, version, exact build and fingerprint, as the brief requires.

---

## 5. Server-orchestrated dependency resolution (OD-S6-2 and the dependency rule)

### 5.1 Compatibility (exact, never "latest")

An existing snapshot `U` of an upstream kind is **compatible** with a request for output `D` of design version `DV` at purpose `P` exactly when **all** of these hold:

1. `U.design_version_id = DV.id`, in the same organization. RLS is still applied.
2. `U` is **current** by the staleness algorithm (§8): engineering hash and revision, dependency hashes, commercial hashes where its kind consumes them, `engine_fingerprint` equal to the current engine for `U.kind`, and all of its own sources current.
3. `U.purpose = P`. The server always resolves upstream at the requested purpose, which keeps the choice deterministic.
4. `verifySnapshotRecord(U)` passes: the SHA-256 of the stored payload equals `U.content_hash`.
5. Kind-specific conditions:
   - for FOR_PRODUCTION, `U.blocker_count = 0`;
   - for FOR_PRODUCTION, a BOM needs `U.output_complete`.

Conditions 1–3 are exactly the upstream kind's **natural identity** (§7), so at most one compatible snapshot exists. Selecting it is a unique-key lookup, never an ordering.

### 5.2 Generation algorithm (one REPEATABLE READ transaction)

```
generate(D, DV, P):
  lock DV FOR SHARE (as validation does); read current engineering hash/revision, pins, dependency hashes
  for each upstream kind K of D, in order BOM → BOQ → Pricing:
      U := lookup natural identity (DV, K, P, current hashes, current engine fingerprint(K), current sources)
      if U missing:  U := generate(K, DV, P)            -- recursive; caller must hold K's generate permission (§12)
      verify U (content hash, provenance)
  input := deserialize(U.payload) through the Zod payload schema (§14) -- never recompute U
  resolved := resolveRoom(current engineering inputs)
  result := D's engine(resolved, input, pins...)
  verify: resolved.roomFingerprint = input.roomFingerprint (engines already assert this for BOQ, pricing, quotation)
  if D's natural identity already exists (a concurrent or earlier request): return it (200, reused)
  insert D with the exact source ids; the DB trigger re-checks provenance, sources and purpose; return 201
```

**What each engine reads from its upstream snapshots:**

| Engine | Deserializes | Checks |
|---|---|---|
| BOQ | `RoomBOM` from the BOM payload | `generateRoomBoq` requires `roomBom.roomFingerprint === room.roomFingerprint`, so a BOM for other inputs is refused |
| Pricing | `RoomBOM` and `RoomBOQ` | `priceRoom` checks traces and links (as `priceCabinet` does) |
| Quotation | `RoomBOQ` and the pricing payload | `quoteRoom` (new) uses the existing `PriceSnapshot`s and **does not re-price** (F3) |

**If an upstream snapshot is stale, incompatible or missing,** a new upstream snapshot is generated first, then used. Old snapshots are never modified.

### 5.3 Explicit reproduction (optional)

A request may name `sources: { bomSnapshotId?, boqSnapshotId?, pricingSnapshotId? }` to reproduce an earlier output from exact upstream snapshots.

**What the server checks:**

- same design version and organization;
- the content hash verifies;
- the purpose is equal or stronger;
- the source's engineering (and, where consumed, commercial) hashes equal the **current** design version values. Otherwise the downstream engine's fingerprint checks would refuse it anyway, with `409 SOURCE_SNAPSHOT_INCOMPATIBLE`.

**What the server allows:** the source's `engine_fingerprint` may differ from the current engine. That difference is the point of reproducing from an older build. The new snapshot records the exact source id, and its staleness reports `SOURCE_STALE` (§8).

---

## 6. Output snapshot schema (exact; §17 describes the migration)

### 6.1 Columns common to every snapshot table

| Column | Type / constraint | Source |
|---|---|---|
| `id` | uuid PK | server |
| `org_id` | uuid, FK organization; `UNIQUE (org_id, id)` | context |
| `kind` | `snapshot_kind`, CHECK = the table's kind | fixed |
| `purpose` | text, CHECK IN (PRELIMINARY, FOR_REVIEW, FOR_PRODUCTION); FK `(kind, purpose)` → `output_purpose_rule` | request |
| `design_version_id` | uuid; composite FK → design_version | request path |
| `design_version_status` | record_lifecycle_status | DV at generation (trigger-checked) |
| `design_version_content_hash` | sha256 | DV (trigger-checked) |
| `engineering_input_hash` | sha256, NOT NULL | DV (trigger-checked equal) |
| `engineering_input_revision` | integer ≥ 1, NOT NULL | DV (trigger-checked equal) |
| `input_hash`, `input_revision` | sha256, integer; provenance only | DV (trigger-checked equal) |
| 12 pin columns | uuid; engineering pins NOT NULL (appliance nullable); commercial and manufacturing pins NOT NULL only for kinds that consume them, NULL otherwise | DV pins (trigger-checked, existing) |
| `dependency_hashes` | jsonb object; keys = exactly the consumed pins of the kind (CHECK on the key set) | server, read in-transaction |
| `dependency_set_hash` | sha256 | `H(dependency_hashes)` |
| `commercial_input_hash` | sha256; NOT NULL for PRICING and QUOTATION, NULL otherwise | §3.2 |
| `engine_name` | text, FK `output_engine`; CHECK matches kind | §4 |
| `engine_version` | text, non-blank | §4 |
| `engine_build` | text, `^[0-9A-Za-z][0-9A-Za-z._+-]{6,127}$` | §4 |
| `engine_source_hash` | text (OD-S6-9 A) | §4.3 |
| `engine_components` | jsonb object of package → semantic version | §4 |
| `engine_fingerprint` | sha256, NOT NULL | §4 |
| `engine_seal` | text NULL (hash53) | engine |
| `blocker_count`, `warning_count` | integer ≥ 0 | engine result counts |
| `output_complete` | boolean NOT NULL (BOM: `!incomplete`; others: true) | engine |
| `payload` | jsonb; no TEST_FIXTURE marker (CHECK) | engine result, verbatim |
| `content_hash` | sha256 of the payload (`@lintel/persistence`) | server |
| `data_classification` | `'PRODUCTION'` (CHECK) | fixed |
| `created_by`, `created_at` | uuid = current user (RLS); timestamptz default `now()` | database |

**Removed:** `engine_hash` on snapshot tables. It meant "payload seal" and becomes `engine_seal`. All snapshot tables are empty in every environment.

### 6.2 Kind-specific columns

| Table | Columns |
|---|---|
| `boq_snapshot` | `bom_snapshot_id` uuid NOT NULL, composite FK |
| `pricing_snapshot` | `bom_snapshot_id`, `boq_snapshot_id` NOT NULL, composite FKs |
| `quotation_snapshot` | `boq_snapshot_id`, `pricing_snapshot_id` NOT NULL; `revision_number` integer ≥ 1 (exists), `UNIQUE (design_version_id, revision_number)` |
| `drawing_snapshot` | `drawing_type` (CHECK: the 6 types, §10.5; no default); `drawing_scope` CHECK IN ('ROOM','OBJECT'); `wall_id` CHECK IN ('A','B','C','D'); `object_id` uuid (composite FK → design_object of the same version); `cut_x_mm` numeric; `drawing_number`, `drawing_revision` text; `file_manifest_hash` sha256 (§11); scope CHECKs (a wall type requires `wall_id`, object types require `object_id`, `cut_x_mm` only for SIDE_SECTION) |
| `manufacturing_document_snapshot` | unchanged until manufacturing exists (future: the same file model as §11) |

**The edge trigger** checks, for every source column:

- the source has the same `design_version_id`, org, `engineering_input_hash` and `engineering_input_revision`;
- for Quotation, the source Pricing has the same `commercial_input_hash` pricing part;
- the source purpose is at least as strong as the snapshot's;
- the source's content hash is the one read. Snapshots are insert-only, so the id fixes the content.

**Validation run additions:** `engine_name` (`'validation'`), `engine_source_hash`, `engine_components`, and `engineering_input_hash` / `engineering_input_revision`, which replace `input_hash` / `input_revision` as the binding for SUBMIT and APPROVE.

---

## 7. Snapshot uniqueness and idempotency

### 7.1 Natural identity

Two snapshots are **the same output** if and only if everything that determines their content is equal.

The key is never just `design_version_id + kind`. Repeated immutable snapshots are legitimate:

- for another purpose;
- for new inputs (a new engineering revision);
- from another engine;
- with other sources.

| Kind | Natural identity (UNIQUE, `NULLS NOT DISTINCT`, PostgreSQL 17) |
|---|---|
| BOM | `(org_id, design_version_id, purpose, engineering_input_hash, engineering_input_revision, dependency_set_hash, engine_fingerprint)` |
| BOQ | BOM key + `bom_snapshot_id` |
| Pricing | BOM key + `commercial_input_hash` + `bom_snapshot_id` + `boq_snapshot_id` |
| Quotation | BOM key + `commercial_input_hash` + `boq_snapshot_id` + `pricing_snapshot_id` |
| Drawing | BOM key + `drawing_type`, `drawing_scope`, `wall_id`, `object_id`, `cut_x_mm`, `drawing_number`, `drawing_revision` |
| Validation run | not unique. A run records evidence at a point in time and is referenced by its id. Behaviour is unchanged. |

**Why each column is there:**

- **`engineering_input_revision`** is in the key because it is how the database detects changes the API did not hash (Step 5 model). A revision bump always yields a new snapshot.
- **`created_at`** is not in the key. Pricing and quotation payloads contain `createdAt`, so their `content_hash` differs between generations. The natural key is therefore over **inputs, engine and sources**, not the payload. A repeated request **reuses** the existing snapshot and returns it with `200` and `reused: true`, instead of creating a new one.
- **Quotation `revision_number`** is assigned only when a new natural identity is inserted: the next number per design version under `UNIQUE (design_version_id, revision_number)`. Identical inputs never create a new quotation revision.

### 7.2 Idempotency layers

| Layer | Behaviour |
|---|---|
| `Idempotency-Key` (existing scopes) | The same key and request replay the original response. Snapshots exceed the 60 KB body cap, so replay uses `resource { type, id }` rehydration. The same key with a different body gives `409 IDEMPOTENCY_KEY_REUSED` (LD022). |
| Natural identity | Different keys, same inputs: the existing snapshot is returned (`200`, `reused: true`). Two concurrent inserts: one wins, and the other catches the unique violation (23505 on the natural-identity index) and returns the winner. |
| Insert-only | A snapshot is never overwritten. Purpose, content and sources can never change (LD015). |

---

## 8. Staleness algorithm (calculated, never stored)

```
isCurrent(S) → { stale, reasons[], advisories }
  DV := S.design_version (same org)
  reasons := []
  -- engineering domain (every kind)
  if S.engineering_input_hash ≠ DV.engineering_input_hash
     or S.engineering_input_revision ≠ DV.engineering_input_revision  → reasons += ENGINEERING_INPUTS_CHANGED
  -- consumed dependency content (only the pins in S.dependency_hashes)
  for (pin, h) in S.dependency_hashes:
     if DV[pin] ≠ S[pin]                                               → reasons += (engineering pin ? ENGINEERING_INPUTS_CHANGED : COMMERCIAL_INPUTS_CHANGED)
     else if dependencyHash(DV[pin]) ≠ h                               → reasons += DEPENDENCY_CONTENT_CHANGED
  -- engine
  if S.engine_fingerprint ≠ currentEngineFingerprint(S.engine_name)    → reasons += ENGINE_CHANGED
  -- sources (transitive, memoised)
  for U in sources(S): if isCurrent(U).stale                           → reasons += SOURCE_STALE
  advisories:
     designSuperseded       := DV.status = SUPERSEDED                  -- historically valid; NOT stale
     newerSurveyAvailable   := a later revision of DV's room exists    -- not adopted, so NOT stale
     newerDependencyVersions:= pinned entities with a later APPROVED version -- never followed, so NOT stale
  return { stale: reasons ≠ [], reasons (deduplicated), advisories }
```

**What never makes an output stale:**

- **A newer approved catalog (or any dependency) version** that the design does not pin. Outputs follow exact pins, never "latest".
- **Commercial pin changes, for engineering kinds.** Those pins are not in their `dependency_hashes`, and the engineering hash and revision do not include them.
- **A QuotationPolicy pin change, for Pricing.**
- **SUPERSEDED or LOCKED design status.** A superseded design's outputs remain historically valid (`designSuperseded` advisory).
- **An issue.** An issued quotation or drawing stays issued. If it later becomes stale (only through ENGINE_CHANGED, because a LOCKED version's inputs are frozen), it is flagged so it can be re-issued. It is never altered.

**Where staleness is computed:**

| Where | Cost |
|---|---|
| Snapshot and list reads | the hashes above: indexed reads plus a dependency-hash read for DRAFT pins only. APPROVED and LOCKED pins are immutable, so their hash is compared to the value recorded at generation without re-reading child rows. No engine run. |
| `GET /{kind}-snapshots/{id}/staleness` | also runs the existing engine comparators, to list which objects changed: `compareRoomTrace`, `checkQuotationStaleness`, `checkRoomDrawingStaleness`, `checkDrawingStaleness`. They are passed through as `changedObjectIds` and `engineReasons`. |

---

## 9. Validation and purpose rules

**Validation is a sibling of the outputs, not an input.** No output requires a validation run to be generated. Every output engine resolves the room and reports its own BLOCKERs and WARNINGs (`blocker_count`, `warning_count`).

| Purpose | Design version state | BLOCKERs in the output | Validation evidence | Sources |
|---|---|---|---|---|
| PRELIMINARY | any (DRAFT … SUPERSEDED) | allowed; shown, and watermarked on drawings | none required | any purpose |
| FOR_REVIEW | IN_REVIEW, APPROVED, LOCKED | allowed; shown and watermarked | implied: SUBMIT required a run for the current engineering inputs (LD010) | FOR_REVIEW or FOR_PRODUCTION |
| FOR_PRODUCTION | APPROVED or LOCKED | **0** (checked before insert and by the database, LD011); for BOM also `output_complete` | implied: APPROVE required a 0-blocker run for the current engineering inputs | FOR_PRODUCTION only |

**Production guards** (FOR_PRODUCTION only; failures return LD021 or LD011):

| Scope | Guards |
|---|---|
| All kinds | every pin APPROVED or LOCKED (guaranteed by design approval); `dependency_hashes` current; engine classification `PRODUCTION` |
| Pricing | the PricingStandard APPROVED or LOCKED; the engine result `PRICED`; no `PRICING_*` BLOCKER |
| Quotation | the Pricing guards; the QuotationPolicy APPROVED or LOCKED (FINANCE); the result `PRICED`; no `QUOTATION_*` BLOCKER |
| Drawing | the drawing engine's own FOR_PRODUCTION guard returns `CREATED` |
| Issue (quotation, drawing) | design LOCKED; `check_issue` (existing: FOR_PRODUCTION, 0 BLOCKERs, same design content hash) |
| Release (manufacturing) | deferred (§10.6) |

**Further rules:**

- The existing `output_purpose_rule` and `outputPurposeProblems` remain the single rule source.
- A purpose is never upgraded. A different purpose is always a new snapshot.

---

## 10. Per-output contracts

### 10.1 BOM (design model → physical bill of materials)

- **Engine:** `bom`: `generateRoomBom(resolveRoom(engineering inputs))` → `RoomBOM`.
- **Lines:**
  - PANEL: per generated component, finished size; cut allowances belong to future manufacturing.
  - BOARD: m² per material.
  - EDGE_BAND: m per band.
  - FINISH: m² × finished faces.
  - HARDWARE: resolved `MANUFACTURER:ARTICLE`; unresolved requirements appear as `UNRESOLVED` with quantity 0.
  - Per-cabinet `objectBoms`, room `totals`, `roomFingerprint` and `incomplete`.
  - The BOM includes no wastage and no prices.
- **Stored:** `output_complete = !incomplete`. FOR_PRODUCTION requires complete.

### 10.2 BOQ (commercial product lines, linked to the BOM and never merged with it)

- **Engine:** `boq`: `generateRoomBoq(room, catalog, roomBomFromSnapshot)` → `RoomBOQ`. One `BOQItem` per object: `itemCode` and `description` from product templates, quantity from the product BOQ formula, `measures`, `linkedBomId`.
- **How it differs from the BOM:**
  - The BOM is physical and engineering: material, panel and hardware lines.
  - The BOQ is what a client is quoted: product lines.
- **No engineering logic is duplicated.** The BOQ engine takes the BOM **snapshot** payload and checks its fingerprint and link. It never recounts material.

### 10.3 Pricing

- **Engine:** `pricing`: **`priceRoom`** (new, pure, `@lintel/pricing-engine`).
  - Input: `{ mode: "PRODUCTION", room, roomBom, roomBoq (both from snapshots), rateCard, rules, createdAt }`.
  - It applies the existing `priceCabinet` gates and arithmetic to each cabinet.
  - It returns `PRICED { priceSnapshots, totals? }` or `UNAVAILABLE { blockers }`.
- **Room totals:** if a room total is wanted, `priceRoom` computes it. The API never sums.
- **Pricing model:** the pinned PricingStandard version (rate card + rules), from `pricingStandardFromRows`. The engine requires APPROVED in production mode.
- **No rates are invented:**
  - NULL rates give `PRICING_RATE_UNVERIFIED`.
  - Missing rates give `PRICING_RATE_MISSING`.
  - Nothing is priced at zero.
- **UNAVAILABLE results are not persisted (OD-S6-5).** The response is `200 { status: "UNAVAILABLE", blockers, snapshot: null }`. Any BOM or BOQ snapshots created on the way remain valid engineering snapshots.

### 10.4 Quotation

- **Engine:** `quotation`: **`quoteRoom`** (new, pure, in the pricing-engine quotation module).
  - Input: `{ mode: "PRODUCTION", room, roomBoq, pricing: the pricing snapshot payload (PriceSnapshot[]), policy, catalog, revision, createdAt }`.
  - It applies the existing policy gate, tax mapping, `PER_LINE` / `PER_RATE_GROUP` tax, rounding and totals code.
  - It **does not call `priceCabinet`**; it uses the pricing snapshot.
  - It keeps the `QUOTATION_TAX_RATE_CONFLICT` check against each `PriceSnapshot.pricingRules.gstPercent`.
- **Keeping existing behaviour:** the existing `priceQuotation` becomes `priceRoom` + `quoteRoom`, so behaviour is byte-identical. Its golden and unit tests stay unchanged.
- **Nothing financial is decided in a controller or service.** The service only assigns `revision_number` and `createdAt`.
- **Not added:**
  - quote validity or expiry (not modelled);
  - discounts other than `NONE`.
- **UNAVAILABLE results are not persisted.**
- **Issue:** `POST /quotation-snapshots/{id}/issue`:
  1. LOCK the design if it is APPROVED;
  2. INSERT `quotation_issue`;
  3. `check_issue`.

### 10.5 Drawings: existing engine → API map (OD-S6-8)

Every drawing uses only `@lintel/drawing-engine`. There is no second drawing calculation.

| Existing engine function | Scope | API `drawingType` | Required parameters | Staleness detail | Verify |
|---|---|---|---|---|---|
| `createWallInternalElevation` | room | `WALL_INTERNAL_ELEVATION` | `wallId` (A–D) | `checkRoomDrawingStaleness` | `verifyRoomDrawing` |
| `createRoomPanelSchedule` | room | `ROOM_PANEL_SCHEDULE` | — | `checkRoomDrawingStaleness` | `verifyRoomDrawing` |
| `createFrontElevation` | cabinet | `FRONT_ELEVATION` | `objectId` | `checkDrawingStaleness` | `verifyDrawing` |
| `createSideSection` | cabinet | `SIDE_SECTION` | `objectId`, optional `cutXMm` | `checkDrawingStaleness` | `verifyDrawing` |
| `createCabinetInternalElevation` | cabinet | `CABINET_INTERNAL_ELEVATION` | `objectId` | `checkDrawingStaleness` | `verifyDrawing` |
| `createPanelSchedule` | cabinet | `PANEL_SCHEDULE` | `objectId` | `checkDrawingStaleness` | `verifyDrawing` |
| `renderSvg(drawing, sheetIndex)` | both | files: one `SVG` per sheet | — | — | SHA-256 per file |
| `renderPdf([drawing])` | both | files: one `PDF` document | — | — | SHA-256 per file |

**All six types go through one endpoint,** `POST /design-versions/{id}/drawing-snapshots`, with a discriminated `drawingType` body (§14).

**Rules:**

- **Cabinet drawings** use the cabinet from the room resolution (`room.cabinets` by `objectId`), so room and cabinet drawings of one version share one resolution.
- **Purpose becomes the engine's `requestedStatus`.** The three values are identical.
- **A `REFUSED` result** returns `422 DRAWING_REFUSED` with the engine blockers. Nothing is persisted.
- **A `CREATED` result is persisted.** It may be watermarked because of BLOCKERs.
- **Title-block metadata comes from records, never free text:**

  | Field | Source |
  |---|---|
  | `projectCode` | `project.project_code` |
  | `room` | `room.name` |
  | `designer` | DV `created_by` display name |
  | `checker` | DV `approved_by` display name, or `-` |
  | `date` | generation date, UTC |
  | `drawingNumber`, `drawingRevision` | the request (validated format) |

### 10.6 Manufacturing Document: future boundary (OD-S6-1, OD-S6-7). No endpoint in this step.

**Future boundary:**

- **Engine:** `manufacturing`, in `@lintel/manufacturing-engine`. It consumes engineering inputs (the resolved room) and an exact ManufacturingStandard version. Inputs from the BOM are expected (panel lines); the dependency edges would be decided when the engine exists.
- **Domain:** engineering + MANUFACTURING (§3.3). ManufacturingStandard changes never make BOM, drawings or commercial outputs stale.
- **Snapshot:** `manufacturing_document_snapshot`, with the same common columns (§6.1), the same file model (§11), `engine_name = 'manufacturing'`, and a non-null ManufacturingStandard pin.
- **Permissions:** generation requires `output.generate.engineering`; release to manufacturing requires `manufacturing.release`. The INSERT policy is corrected when manufacturing is enabled (F6).
- **Purposes:** PRELIMINARY and FOR_REVIEW become possible once the engine exists. FOR_PRODUCTION and release need all of:
  - an APPROVED or LOCKED ManufacturingStandard;
  - a LOCKED design;
  - 0 BLOCKERs;
  - every production guard (Step 4 §8.1).

**Current production blockers:**

1. There is no manufacturing engine. Cut sizes, cut list, drilling, labels and CNC do not exist (PRD Phase 7).
2. There is no ManufacturingStandard type, and the `manufacturing_variable` registry is empty, so no version can be approved (`completeness.test.ts`).
3. Every manufacturing value is NULL / UNVERIFIED: saw kerf, edge trim, cut versus finished size, groove, system hole pitch, joinery, CNC post-processor, label format, wastage.
4. The construction standard's cut-size allowances (A7) are NULL / UNVERIFIED.

**Consequence:** no manufacturing output endpoint exists, `POST …/manufacturing-release` stays refused, and nothing is weakened.

---

## 11. Drawing file model (one-to-many; any format)

**Registry `output_file_format`:**

- Columns: `code` PK, `content_type`, `extension`, `sort_order`, `sheet_scoped` boolean, `kinds` snapshot_kind[].
- Seed rows: `PDF` (application/pdf, document-scoped), `SVG` (image/svg+xml, sheet-scoped).
- A future `DXF` (image/vnd.dxf) is **one registry row**, with no change to the snapshot tables.
- The registry is not audited, like the other registries.

**`drawing_snapshot_file`** is redefined. The table is empty, so it is dropped and recreated in the migration.

| Column | Constraint |
|---|---|
| `org_id`, `snapshot_id` | composite FK → drawing_snapshot |
| `sequence` | integer ≥ 1; **PK `(snapshot_id, sequence)`** |
| `format` | FK → `output_file_format(code)` |
| `sheet_index` | integer ≥ 0; NOT NULL iff the format is `sheet_scoped`, else NULL |
| `file_object_id` | composite FK → file_object; UNIQUE `(snapshot_id, format, sheet_index) NULLS NOT DISTINCT` |

**Deterministic identity.** `sequence` is assigned by ordering the files on `(format.sort_order, sheet_index)`, so the same drawing always gets the same sequence numbers. For example: PDF is 1, SVG sheet 0 is 2, SVG sheet 1 is 3.

**The manifest seals the file set:**

- `drawing_snapshot.file_manifest_hash` = SHA-256 of the ordered `[{sequence, format, sheetIndex, checksum, byteSize, contentType}]`. It is computed after rendering and before the snapshot insert.
- A DEFERRABLE INITIALLY DEFERRED constraint trigger checks at commit that the linked files exactly match the manifest.
- A snapshot therefore can never gain, lose or swap a file.

**Storage.**

- Files go through `FileService` under `buildStorageKey({ orgId, projectId, designVersionId, kind: "drawing", fileId, extension })`.
- `file_object` is insert-only and stores a SHA-256 checksum.
- An orphan left by a rollback is harmless and reused on retry (Step 4 §7).
- Providers are memory (tests) and local file system (development). There is **no hosted bucket**.

**Byte encoding.** `renderPdf` returns an ASCII string, stored as `latin1` bytes. `renderSvg` returns UTF-8.

**Manufacturing documents** use an identical `manufacturing_document_snapshot_file` shape, with their formats as registry rows, when enabled.

---

## 12. Output permission matrix

**Actions** are the existing permissions (0002 seeds). **Layers:** API guard + RLS policy + database trigger/function, as in Step 5.

| Output | Generate | Read | Issue / release |
|---|---|---|---|
| Validation run | `design_version.author` **or** `output.generate.engineering` (+ `reference.read`) | project scope | — |
| BOM | `output.generate.engineering` | `output.read.production` | — |
| BOQ | `output.generate.engineering` | `output.read.production` | — |
| Pricing | `output.generate.commercial` | `output.read.cost` | — |
| Quotation | `output.generate.commercial` | `output.read.cost`; issued: `output.read.issued` | `quotation.issue` |
| Drawing | `output.generate.engineering` | `output.read.production`; issued: `output.read.issued` | `drawing.issue` |
| Manufacturing Document (future) | `output.generate.engineering` (policy corrected, F6) | `output.read.production` | release: `manufacturing.release` |
| Files (signed URL) | the generating action | `file_read` / `client_can_read_file` | — |

**Default roles today (seeds):**

| Role | Generate | Read | Issue / release |
|---|---|---|---|
| DESIGNER | engineering | production, issued | — |
| DESIGN_HEAD | engineering | cost, production, issued | `drawing.issue`, lock |
| COSTING | engineering, commercial | cost, production, issued | — |
| SALES | — | issued | `quotation.issue` |
| FINANCE | — | cost, issued | — |
| PROCUREMENT | — | cost, production | — |
| PRODUCTION | — | production, issued | `manufacturing.release` |
| SITE_ENGINEER | — | production, issued | — |
| ADMIN | — | cost, production, issued | — |
| CLIENT | — | issued only (portal deferred) | — |

**Orchestration never escalates.**

- Generating an upstream snapshot on the caller's behalf (§5.2) runs **as the caller**. The caller needs that upstream's generate permission, and read permission for existing upstreams.
- **Pricing and Quotation callers** (commercial) therefore also need `output.generate.engineering` or `output.read.production` to use BOM and BOQ snapshots. COSTING has all of these. Anyone else gets `403 PERMISSION_DENIED` naming the missing upstream action.
- There is **no SECURITY DEFINER path** that generates on someone else's authority.

---

## 13. Endpoint list (`/api/v1`)

**Conventions** (as Step 4 and Step 5):

- JWT authentication and an X-Org org context proven by a membership;
- RFC 9457 problems;
- keyset pagination;
- `Idempotency-Key` on every POST (existing scopes).

Snapshots are immutable, so there is no PATCH or DELETE. Their ETags are strong: `"<content_hash>"`.

**Generation** (server-orchestrated dependencies):

| Method & path | Action | Body | Responses |
|---|---|---|---|
| `POST /design-versions/{id}/bom-snapshots` | `output.generate.engineering` | `BomGenerateRequest` | 201 new · 200 reused |
| `POST /design-versions/{id}/boq-snapshots` | `output.generate.engineering` | `BoqGenerateRequest` | 201 · 200 reused (+ any BOM generated, in `dependencies[]`) |
| `POST /design-versions/{id}/pricing-snapshots` | `output.generate.commercial` (+ upstream, §12) | `PricingGenerateRequest` | 201 · 200 reused · 200 `UNAVAILABLE` (not persisted) |
| `POST /design-versions/{id}/quotation-snapshots` | `output.generate.commercial` (+ upstream) | `QuotationGenerateRequest` | 201 · 200 reused · 200 `UNAVAILABLE` |
| `POST /design-versions/{id}/drawing-snapshots` | `output.generate.engineering` | `DrawingGenerateRequest` (6 types, §10.5) | 201 · 200 reused · 422 `DRAWING_REFUSED` |
| ~~`POST /design-versions/{id}/manufacturing-document-snapshots`~~ | — | — | **not created (OD-S6-1)** |

**Reads:**

| Method & path | Action |
|---|---|
| `GET /design-versions/{id}/outputs` | the union of the read actions, filtered per kind: a graph of all snapshots (no payloads), with purpose, blockers, current/stale and edges |
| `GET /design-versions/{id}/{bom,boq,drawing}-snapshots` | `output.read.production` |
| `GET /design-versions/{id}/{pricing,quotation}-snapshots` | `output.read.cost` |
| `GET /{bom,boq,drawing}-snapshots/{id}` · `GET /{pricing,quotation}-snapshots/{id}` | as above; includes the payload |
| `GET /{kind}-snapshots/{id}/staleness` | as the read; runs the engine comparators (§8) |
| `GET /drawing-snapshots/{id}/files` | `output.read.production` (or issued) |
| `GET /files/{id}/url` | RLS `file_read` / `client_can_read_file`; signed URL valid 300 s; never persisted |

**Issue** (Step 4 §8):

| Method & path | Action |
|---|---|
| `POST /quotation-snapshots/{id}/issue` `{ reason }` · `GET …/issue` | `quotation.issue` / read |
| `POST /drawing-snapshots/{id}/issue` `{ reason }` · `GET …/issue` | `drawing.issue` / read |

**Manufacturing release.** `POST` / `GET /design-versions/{id}/manufacturing-release` (Step 4 §8.1) remains documented and **deferred with manufacturing documents**. It is not built in Step 7.

**New problem codes:**

| Code | Status | Meaning |
|---|---|---|
| `SOURCE_SNAPSHOT_INCOMPATIBLE` | 409 | a named or found source does not match the current inputs |
| `SOURCE_PURPOSE_INSUFFICIENT` | 409 | the source purpose is weaker than requested |
| `DRAWING_REFUSED` | 422 | the drawing engine's own guard refused |

The database-originated ones get LD025 onward in the `error_code` registry.

---

## 14. Request and response schemas (Zod, strict)

### 14.1 Requests

```ts
const Purpose = z.enum(["PRELIMINARY", "FOR_REVIEW", "FOR_PRODUCTION"]);
const Sources = z.strictObject({ bomSnapshotId: Uuid.optional(), boqSnapshotId: Uuid.optional(), pricingSnapshotId: Uuid.optional() });
const GenerateBase = z.strictObject({ purpose: Purpose.default("PRELIMINARY") });

BomGenerateRequest       = GenerateBase;
BoqGenerateRequest       = GenerateBase.extend({ sources: Sources.pick({ bomSnapshotId: true }).optional() });
PricingGenerateRequest   = GenerateBase.extend({ sources: Sources.pick({ bomSnapshotId: true, boqSnapshotId: true }).optional() });
QuotationGenerateRequest = GenerateBase.extend({ sources: Sources.pick({ boqSnapshotId: true, pricingSnapshotId: true }).optional() });
DrawingGenerateRequest   = z.discriminatedUnion("drawingType", [
  GenerateBase.extend({ drawingType: z.literal("WALL_INTERNAL_ELEVATION"), wallId: z.enum(["A", "B", "C", "D"]), ...Numbering }),
  GenerateBase.extend({ drawingType: z.literal("ROOM_PANEL_SCHEDULE"), ...Numbering }),
  GenerateBase.extend({ drawingType: z.literal("FRONT_ELEVATION"), objectId: Uuid, ...Numbering }),
  GenerateBase.extend({ drawingType: z.literal("SIDE_SECTION"), objectId: Uuid, cutXMm: Millimetres.optional(), ...Numbering }),
  GenerateBase.extend({ drawingType: z.literal("CABINET_INTERNAL_ELEVATION"), objectId: Uuid, ...Numbering }),
  GenerateBase.extend({ drawingType: z.literal("PANEL_SCHEDULE"), objectId: Uuid, ...Numbering }),
]);
// Numbering = { drawingNumber: /^[A-Z0-9][A-Z0-9-]{0,39}$/, drawingRevision: /^[A-Z0-9]{1,4}$/ }
IssueRequest = z.strictObject({ reason: Reason });
```

**What a request can never carry:**

- quantities, prices, rates, tax or totals;
- blocker counts, hashes, engine fields or `createdAt`;
- designer or checker;
- anything that means "latest".

### 14.2 Responses

```ts
EngineProvenance = { name, version, build, sourceHash, components: Record<string, string>, fingerprint, seal: string | null };
SnapshotEnvelope = {
  id, kind, purpose, designVersionId, designVersionStatus, designVersionContentHash,
  engineering: { inputHash, inputRevision },
  commercial: { inputHash } | null,                     // pricing / quotation
  input: { hash, revision },                            // whole design version, provenance only
  pins: Pins,                                           // the 12; non-consumed = null
  dependencyHashes: Partial<Record<PinName, Sha256>>, dependencySetHash,
  sources: { bomSnapshotId?, boqSnapshotId?, pricingSnapshotId? },
  engine: EngineProvenance,
  contentHash, blockerCount, warningCount, outputComplete, dataClassification: "PRODUCTION",
  qualifiesForIssue, qualifiesForRelease, issue?: { issuedBy, issuedAt, reason },
  staleness: { stale, reasons: ("ENGINEERING_INPUTS_CHANGED" | "COMMERCIAL_INPUTS_CHANGED" | "DEPENDENCY_CONTENT_CHANGED"
                                | "ENGINE_CHANGED" | "SOURCE_STALE")[],
               advisories: { designSuperseded, newerSurveyAvailable, newerDependencyVersions: { pin, versionId }[] } },
  createdBy, createdAt,
};
GenerateResponse<T>       = { snapshot: T, reused: boolean, dependencies: SnapshotSummary[] /* upstreams generated or reused */ };
BomSnapshot               = SnapshotEnvelope & { payload: RoomBomPayload };           // RoomBOM
BoqSnapshot               = SnapshotEnvelope & { payload: RoomBoqPayload };           // RoomBOQ
PricingSnapshot           = SnapshotEnvelope & { payload: RoomPricingPayload };       // priceRoom PRICED result
QuotationSnapshot         = SnapshotEnvelope & { revisionNumber, payload: QuotationPayload };  // QuotationSnapshot
DrawingSnapshot           = SnapshotEnvelope & { drawingType, drawingScope, wallId, objectId, cutXMm, drawingNumber, drawingRevision,
                                                 fileManifestHash, files: { sequence, format, sheetIndex, fileId, contentType, byteSize, checksum }[],
                                                 payload: RoomDrawingPayload | DrawingPayload };
Unavailable               = { status: "UNAVAILABLE", blockers: ValidationMessage[], snapshot: null, dependencies: SnapshotSummary[] };
Staleness                 = SnapshotEnvelope["staleness"] & { changedObjectIds: string[], engineReasons: string[] };
OutputsGraph              = { designVersionId, engineering: { inputHash, inputRevision }, nodes: SnapshotSummary[], edges: { from, to }[] };
```

**Payload schemas mirror the engine types.** Each payload schema is a Zod mirror of its `@lintel/types` type and serves three purposes:

1. response validation;
2. safe **deserialization of upstream payloads** into engine inputs (§5.2);
3. OpenAPI.

A compile-time equality assertion against the engine type fails the typecheck on drift. No engine logic is duplicated.

**Encoding:**

- Money is integer paise; the engine guarantees safe integers.
- Dimensions are millimetres, as the engine emits them.
- The API never formats or recomputes either.

---

## 15. OpenAPI approach

1. **Source of truth:** the Zod schemas (§14 plus Step 4 and Step 5). There are no hand-written YAML files.
2. **Route metadata:** each route registers its metadata (method, path, action, request and response schemas, problem codes) with explicit decorators, without reflection.
3. **Build:** `pnpm api:openapi` builds **OpenAPI 3.1** using Zod 4 `z.toJSONSchema()`. Problems use the RFC 9457 schema, with the `type` URN enumerated from `PROBLEM_CODES`.
4. **Artifact and drift check:** the committed artifact is `apps/api/openapi/openapi.json`. A CI drift test fails on any difference, like the database schema snapshot.
5. **Timing:**
   - The final artifact is **generated only when Step 7 implements the output modules.**
   - Deferred endpoints (manufacturing) are absent.
   - Until then this document is the contract.

---

## 16. Prerequisite matrix

| Capability | Existing | Missing (before API generation) | Production blocker |
|---|---|---|---|
| **Validation** | `POST/GET validation-runs`; `record_validation_run` (engine build); engine `resolveRoom`; SUBMIT and APPROVE checks | engineering hash and revision binding (F10); `engine_name`, `engine_components`, `engine_source_hash`, per-engine fingerprint (§4) | approved production standards, catalogs and Hettich data. Today's data yields BLOCKERs (for example `EDGE_RULES_UNDEFINED`, `MATERIAL_UNKNOWN`), so no production design can be approved |
| **BOM** | `generateRoomBom`, types, golden tests | `BOM_ENGINE_VERSION`; snapshot provenance columns (§6); natural identity; payload Zod schema; API module | the approved engineering data above; unresolved Hettich hardware makes the BOM `incomplete` |
| **BOQ** | `generateRoomBoq` (checks BOM fingerprint), types | `BOQ_ENGINE_VERSION`; BOM-snapshot deserialization; BOQ source edge; API | approved product catalog BOQ templates and quantities (the engineering approvals above) |
| **Pricing** | `priceCabinet` (gates, BigInt money), `verifyPriceSnapshot`, types | **`priceRoom`**; commercial hash (§3); BOM and BOQ source edges; UNAVAILABLE handling; API | production rate card and pricing rules are DRAFT with every value NULL (F8) → `UNAVAILABLE` |
| **Quotation** | `priceQuotation` (policy gate, tax, rounding), `verifyQuotation`, `checkQuotationStaleness` | **`QUOTATION_ENGINE_VERSION`**; **`quoteRoom`**, consuming pricing snapshots without re-pricing (F3); BOQ and pricing edges; unique revision; API | production QuotationPolicy (tax rates, tax policy, rounding) is NULL and needs FINANCE approval; validity and expiry are not modelled |
| **Drawings** | `@lintel/drawing-engine`: 6 drawing functions, SVG/PDF renderers, verify and staleness functions; ADR-0007/0008; golden tests | file model redesign (§11); `drawing_type` and scope columns; storage provider wiring in the API; metadata mapping; byte encoding; issue endpoint | FOR_PRODUCTION needs an APPROVED or LOCKED design with 0 BLOCKERs, which the current production data cannot give; issue needs LOCKED |
| **Manufacturing** | snapshot table, purpose rules, pins, permissions and idempotency scopes (reserved) | **manufacturing engine; ManufacturingStandard type and variable model;** INSERT policy correction (F6); file formats | no engine, empty variable registry, every value NULL / UNVERIFIED → deferred (OD-S6-1) |

---

## 17. Changes the next step must make (described; **no SQL or code in Step 6**)

**Engines** (pure, tested, no calculation change):

- `BOM_ENGINE_VERSION`, `BOQ_ENGINE_VERSION` and `QUOTATION_ENGINE_VERSION` constants.
- `priceRoom` and `quoteRoom`. `priceQuotation` is re-expressed as their composition, with golden output unchanged.
- A build-time engine source manifest (OD-S6-9 A).

**`@lintel/persistence`:**

- `engineeringInputHash()`; the redefined `designInputHash()`;
- `dependencyHash()` readers per pinned type;
- `SnapshotRecord` / `SnapshotRow` with the §6 fields;
- the natural-identity builder;
- payload Zod schemas (or in the API: decided in implementation, not duplicated).

**Migration 0017:**

- **Design versions and validation runs:**
  - `design_version.engineering_input_hash` and `engineering_input_revision`, maintained by the database with the bump rules of §3.2;
  - `validation_run` engineering binding, `engine_name`, `engine_components` and `engine_source_hash`;
  - SUBMIT (LD010) and APPROVE rebound to the engineering domain;
  - `record_validation_run` updated.
- **Snapshot tables:**
  - the common columns of §6.1: engine provenance, engineering binding, dependency hashes, `commercial_input_hash`, `warning_count`, `output_complete`;
  - `engine_hash` replaced by `engine_seal`;
  - source columns and the edge trigger (§6.2);
  - natural-identity unique indexes (§7);
  - the quotation revision unique index;
  - drawing type and scope columns and CHECKs.
- **Files:** the `output_file_format` and `output_engine` registries; `drawing_snapshot_file` redefined (§11) with the deferred manifest trigger.
- **Provenance:** `check_snapshot_provenance` extended with the engineering binding, consumed-pin key set and commercial hash presence.
- **Errors:** LD025 onward registered.
- **Checks:** up, down and up again; drift; rollback equivalence.

**Not in 0017:** the manufacturing INSERT policy correction and manufacturing file formats. They wait for manufacturing.

---

## 18. Unresolved risks

| # | Risk | Mitigation / status |
|---|---|---|
| R1 | **Commercial pins are still frozen on the design version.** Re-pricing an APPROVED design with a new price list needs a new design version, and that version's engineering outputs are new snapshots, though deterministic and identical in content. | Accept for Step 7. A separate "commercial context" (exact pricing and policy chosen per quotation, independent of design approval) is a product decision for later. |
| R2 | **Engine staleness churn.** Under OD-S6-9 B every deploy stales every output. | Recommend OD-S6-9 A (per-engine source-tree hash). |
| R3 | **Engine seals are `hash53`.** | SHA-256 `content_hash` is authoritative; the seal is kept for parity only. Upgrading the engine seal is a separate engine change. |
| R4 | **All production commercial data is NULL; engineering data is unapproved.** | FOR_PRODUCTION outputs are impossible until real data is approved. Successful paths can be tested only with test-only synthetic data in rolled-back or race databases (existing pattern). Nothing is invented. |
| R5 | **Deserializing upstream payloads** (RoomBOM, RoomBOQ, PriceSnapshot) into engine inputs relies on a lossless JSON round-trip. | The Zod payload schemas and the content-hash check guard it. Golden round-trip tests are needed in Step 7. |
| R6 | **BL-1 and BL-2 remain open:** the hardware rule-set version is visible only through the catalog version, and the Hettich dataset status is invisible to the engine. | The pins and dependency hashes still record both exactly. The engine trace is coarser than the provenance. |
| R7 | **Response size** of drawing payloads and quotations. | Lists never include payloads. Replay uses rehydration. Later: per-sheet payload paging. |
| R8 | **Storage:** content-addressed orphans after a rollback; only memory and local providers. | Accepted. Hosted buckets wait for the Mumbai gate. |
| R9 | **`dependencyHash` must cover every child table of each pinned type.** Missing one would hide a DRAFT change. | A database test must enumerate every table with an FK to a pinned version table and assert it is covered. |
| R10 | **No manufacturing engine or ManufacturingStandard model.** | Deferred (OD-S6-1). |
| R11 | **Redefining `input_hash` and adding the engineering binding changes the approval rule** (SUBMIT and APPROVE bind to the engineering domain). | This is a deliberate behaviour change. It is covered by database and API tests in 0017. Only development data exists. |
| R12 | **`M5-TECHNICAL-DESIGN.md` §6 is out of date** (non-existent uniqueness; `engine_version` described as including the SHA). | To be corrected together with 0017. |

---

## 19. Implementation sequence (only after this revision is approved)

1. Engine constants, `priceRoom`, `quoteRoom` (the `priceQuotation` refactor keeps golden output unchanged), and the engine source manifest. Unit and golden tests.
2. `@lintel/persistence`: hashes, dependency hashes, snapshot record and natural identity, payload schemas. Unit tests.
3. Migration 0017, with full database tests: engineering binding, provenance, edges, natural identity, purposes, file manifest, R9 coverage.
4. API: the outputs module, in the order BOM → BOQ → drawings (files) → pricing → quotation → issue. Then the outputs graph and staleness. API database tests for every rule, including cross-tenant and orchestration permissions.
5. OpenAPI generator and artifact with a drift check.
6. Manufacturing: nothing until the engine and ManufacturingStandard exist.

**Stop point.** No implementation starts before this revision is reviewed.
