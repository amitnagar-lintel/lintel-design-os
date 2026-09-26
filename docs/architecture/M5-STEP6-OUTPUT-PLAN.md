# M5 Step 6: Output Architecture and API Contract (review-only plan)

**Status:** proposal for review. **Nothing here is implemented.** This step adds no endpoints, migrations, engine code, UI, hosted Supabase changes, production rates, production Hettich data or production ManufacturingStandard values.

**Scope:** the output pipeline

```
DesignVersion → Validation → BOM → BOQ → Pricing → Quotation
DesignVersion → Validation → Drawing
DesignVersion → Validation → Manufacturing Document
```

**Builds on:**

- `M5-TECHNICAL-DESIGN.md` §3 and §6: insert-only snapshots, provenance, staleness computed rather than stored.
- `M5-STEP4-API-PLAN.md` §6 (engine boundary), §7 (storage), §8 and §8.1 (issue and manufacturing release).
- The Step 5 design-version, validation and engine-build work (migrations 0015 and 0016).

The existing contracts it relies on are:

- migrations 0007, 0010, 0012 and 0016;
- `@lintel/persistence` `buildSnapshotRecord` and `OUTPUT_PURPOSE_RULES`;
- the engines `@lintel/design-engine`, `bom-engine`, `boq-engine`, `pricing-engine` and `drawing-engine`.

Contents:

1. Findings that change the brief
2. Output dependency graph
3. Engine invocation boundaries
4. Snapshot provenance model
5. Validation requirements
6. Purpose and lifecycle rules
7. Staleness model
8. Per-output contracts: BOM, BOQ, Pricing, Quotation, Drawing, Manufacturing Document
9. Endpoint list
10. Request and response schemas
11. OpenAPI approach
12. Schema changes this contract needs (proposed migration 0017, not written)
13. Unresolved architectural issues and decisions requested
14. Proposed Step 7 implementation sequence (after approval)

---

## 1. Findings that change the brief

These come from reading the code. Each one changes what the contract can promise.

| # | Finding | Consequence |
|---|---|---|
| F1 | **There is no manufacturing engine.** `packages/manufacturing-engine` has only a README ("Status: not started", PRD Phase 7). It is excluded from the workspace. `CabinetComponent.manufacturingData` is always `null`. There is no ManufacturingStandard TypeScript type, and every ManufacturingStandard value is NULL / UNVERIFIED (`docs/catalog/production-data/06-manufacturing-standards.md`). | "Reuse the existing manufacturing engine" cannot be satisfied. §8.6 defines the contract but proposes **deferring the endpoint** rather than writing a new calculation (decision OD-S6-1). |
| F2 | **The BOM and BOQ engines have no version constant.** Only `ENGINE_VERSION` (design, 0.1.0), `PRICING_ENGINE_VERSION` (0.1.0) and `DRAWING_ENGINE_VERSION` (0.1.0) exist. | The engine identity needs `BOM_ENGINE_VERSION` and `BOQ_ENGINE_VERSION`. These are one-line constants in those packages and involve no calculation change (§4.3). |
| F3 | **There is no room-level pricing function.** `priceCabinet` prices one cabinet. `priceQuotation` prices every cabinet internally, but only as part of a quotation. | A standalone PRICING output needs a pure `priceRoom` in `@lintel/pricing-engine` that runs `priceCabinet` for each cabinet under the same gates. The API must not loop and aggregate prices itself (§8.3, OD-S6-4). |
| F4 | **Snapshot tables have no `engine_build`.** Their `engine_hash` means something different from `validation_run.engine_hash`. On snapshots it is the engine's own payload seal (`hash53`, 53-bit, not cryptographic, taken from `payload.contentHash`). On validation runs it is the engine fingerprint (SHA-256 of engine versions + build). | Proposed migration 0017 aligns them: see §4 and §12. No snapshot row exists in any environment, so the redefinition is safe. |
| F5 | **`drawing_snapshot_file` has primary key `(snapshot_id, format)`,** so a snapshot can hold only one SVG. `renderSvg` produces one SVG per sheet. `drawing_type` has no CHECK and defaults to `FRONT_ELEVATION`. There is no column for the wall or object a drawing covers. | Needs sheet-level file links and a checked `drawing_type` and scope (§12). |
| F6 | **The `manufacturing_document_snapshot` INSERT policy requires `manufacturing.release`** (0010). The Step 4 plan says generation needs `output.generate.engineering`. | Generating a document and releasing it to manufacturing are different acts. The proposal aligns the policy with `output.generate.engineering` (§12, OD-S6-7). |
| F7 | **Nothing in the database makes snapshots unique or idempotent.** `M5-TECHNICAL-DESIGN.md` §6 describes "idempotent on (design_version_id, kind, input_hash, engine_version)", but that index was never created. `quotation_snapshot.revision_number` is not unique either. | §4.6 proposes Idempotency-Key replay plus a unique quotation revision, not content deduplication. The Technical Design text will be corrected. |
| F8 | **All production commercial data is NULL.** Every rate and rule field of `LINTEL_PRODUCTION_RATE_CARD` and `LINTEL_PRODUCTION_PRICING_RULES` is `null`. `LINTEL_PRODUCTION_QUOTATION_POLICY` has no tax policy, rounding or rates. | In production mode the engines return `UNAVAILABLE` with BLOCKERs. The API reports that honestly and **never** substitutes a value. Successful pricing and quotation can be tested only with the test-only synthetic data in rolled-back or race-database tests, as validation is today. |
| F9 | **`record_validation_run()` accepts only DRAFT or IN_REVIEW versions.** After a redeploy, an APPROVED version can never get a validation run from the new build. | Validation evidence for an output is the approval-time run for the exact inputs. The output itself carries a fresh engine validation from the running build (§5). |

---

## 2. Output dependency graph

```
                         DesignVersion (exact inputs: room revision, objects, overrides, 12 pins)
                                   │ input_hash / input_revision
                                   ▼
                         ValidationRun (exact input_hash + input_revision)
                   ┌───────────────┼──────────────────────────┐
                   ▼               ▼                          ▼
                  BOM           Drawing              Manufacturing Document
                   │         (independent)        (independent; deferred, F1)
                   ▼
                  BOQ
                   │  + PricingStandard pin (rate card + pricing rules)
                   ▼
                Pricing
                   │  + QuotationPolicy pin
                   ▼
               Quotation
```

**Rules:**

1. **Every edge is explicit and persisted.** Each snapshot stores:
   - `validation_run_id`;
   - the ids of the upstream snapshots it consumed:
     - BOQ stores `bom_snapshot_id`;
     - Pricing stores `bom_snapshot_id` and `boq_snapshot_id`;
     - Quotation stores `boq_snapshot_id` and `pricing_snapshot_id`.
   A downstream snapshot never finds its input by "latest". The request names the upstream snapshot.
2. **Every node in a chain agrees on the same inputs.** Every snapshot in one chain has the same `design_version_id`, `input_hash` and engine identity. A database trigger enforces this for the persisted edges (§12).
3. **Upstream stages are recomputed and checked, not re-read.** The engines need the resolved room, which is not stored, so every generation re-runs `resolveRoom` and any upstream stages. The stored upstream snapshot then acts as a **checkpoint**: the recomputed upstream `content_hash` must equal it.
   - If it does not, the request fails with `409 SOURCE_SNAPSHOT_MISMATCH`.
   - With equal inputs and engine identity this can only mean nondeterminism. It is logged as an integrity incident.
4. **A downstream purpose can never exceed its sources' purposes.** A FOR_PRODUCTION quotation requires FOR_PRODUCTION BOQ and pricing snapshots. A PRELIMINARY upstream can feed only PRELIMINARY outputs.
5. **Drawings and manufacturing documents depend only on the design version and its validation.** They never read BOM, BOQ or pricing snapshots. The drawing panel schedule comes from the drawing engine's own `scheduleRows` over the resolved model, as today.

---

## 3. Engine invocation boundaries

**The API orchestrates; the engines calculate.** Each generation runs in one REPEATABLE READ transaction, like validation in Step 5:

1. Load the design version, the exact pinned rows (the existing `design-inputs.repository` `pinned()`, extended with the pricing-standard and quotation-policy rows), the room revision, objects, overrides and the named upstream snapshots.
2. Map the rows to engine types with the `@lintel/persistence` `…FromRows` mappers:
   - `pricingStandardFromRows` gives `{ rateCard, rules }`;
   - `quotationPolicyFromRows` gives `QuotationPolicy`.

   The mappers keep `null` as null and never default a value. Record status is mapped with `engineCalculationStatus`: APPROVED and LOCKED become `APPROVED`; DRAFT and IN_REVIEW become `DRAFT`.
3. Call the engines in `apps/api/src/modules/outputs/engines.ts`. This is a pure module like today's `design-versions/engine.ts`; it has no database access and no business rules of its own.
4. Verify:
   - the engine seal (`verifyQuotation`, `verifyRoomDrawing`, `verifyPriceSnapshot`);
   - that each recomputed upstream matches its checkpoint.
5. Persist with `buildSnapshotRecord` → `snapshotToRow` → INSERT. The provenance and edge triggers check the row again.
6. Upload files, for drawings only (§8.5).

| Output | Engine calls (exact) | Engine mode | Result shape |
|---|---|---|---|
| BOM | `resolveRoom(input)` → `generateRoomBom(room)` | n/a | `RoomBOM` |
| BOQ | `resolveRoom` → `generateRoomBom` → `generateRoomBoq(room, catalog, roomBom)` | n/a | `RoomBOQ` |
| Pricing | … → `priceRoom({ mode: "PRODUCTION", room, roomBom, roomBoq, rateCard, rules, createdAt })`, **new, F3**, which calls `priceCabinet` for each cabinet | always `PRODUCTION` | `PRICED` (`PriceSnapshot[]`) or `UNAVAILABLE` (blockers) |
| Quotation | … → `priceQuotation({ mode: "PRODUCTION", room, roomBom, roomBoq, rateCard, rules, policy, catalog, revision, createdAt })` | always `PRODUCTION` | `PRICED` (`QuotationSnapshot`) or `UNAVAILABLE` |
| Drawing | `resolveRoom` → `createWallInternalElevation` or `createRoomPanelSchedule` (room scope); `createFrontElevation`, `createSideSection`, `createCabinetInternalElevation` or `createPanelSchedule` (object scope, one `ResolvedCabinet` from `room.cabinets`) → `renderSvg` for each sheet, `renderPdf([drawing])` | `requestedStatus = purpose` | `CREATED` (`RoomDrawing` / `Drawing`) or `REFUSED` (blockers) |
| Manufacturing Document | **none exists (F1)** | n/a | n/a |

**Boundaries:**

- **The API always runs the engines in `PRODUCTION` mode.** `TEST_FIXTURE` data can never reach a persisted output. The persistence guard (`assertNoTestFixture`) and the database CHECK (`*_no_test_fixture`) enforce this.
- **The API never re-implements anything the engines own.** That covers quantities, totals, tax, rounding, sizes, blockers and staleness. It only aggregates counts that the engine already produced, such as `blocker_count = validation.counts.BLOCKER` or `blockers.length`.
- **`createdAt` and drawing metadata come from the service, never from the clock inside an engine.** `createdAt` is the transaction timestamp (`now()`, UTC ISO). The engines stay deterministic. `createdAt` is stored in the payload, so re-deriving an output reproduces it exactly.
- **Engines never see the database, the lifecycle status names or the HTTP layer,** consistent with Step 4 §6.

---

## 4. Snapshot provenance model

### 4.1 What every snapshot records

| Question | Column(s) | Source |
|---|---|---|
| Which design version? | `design_version_id`, `design_version_status`, `design_version_content_hash` | the design version row at generation time; the trigger checks equality |
| Which exact inputs? | `input_hash` (and new `input_revision`) | the design version; the trigger checks equality with the current row |
| Which exact dependency versions? | the 12 pins (`*_version_id`); kind-specific pins are non-null only where used | the design version pins; the trigger checks them (0012) |
| What content did those dependencies have? | **new** `dependency_hashes jsonb` | `{ pin → hash of the pinned version's envelope and child rows }` as read in the transaction (§7, U10) |
| Which validation? | **new** `validation_run_id` | the approval-evidence run for exactly `input_hash` + `input_revision` (§5) |
| Which upstream outputs? | **new** `bom_snapshot_id`, `boq_snapshot_id`, `pricing_snapshot_id` (per kind) | named in the request; the trigger checks them (§2) |
| Which engine? | `engine_version`, **new** `engine_build`, `engine_hash` (**redefined** as the engine fingerprint), **new** `engine_seal` | §4.3 |
| What was produced? | `payload` (the engine result, verbatim), `content_hash` (SHA-256 of the payload, computed by `@lintel/persistence`), `blocker_count` | engine result |
| For what purpose? | `purpose` (PRELIMINARY, FOR_REVIEW, FOR_PRODUCTION) | request; `output_purpose_rule` checks it |
| Who and when? | `created_by`, `created_at` | database-stamped / RLS-checked |
| Classification | `data_classification = 'PRODUCTION'` (CHECK) | always |

### 4.2 Snapshot rules

These restate the brief as enforced rules:

- **Immutable.** Snapshots are insert-only: `forbid_mutation` raises LD015, and the API role has no UPDATE or DELETE grant. The same applies to issues, files and file links.
- **One exact design version.** `design_version_id` has a composite FK and the provenance trigger checks it.
- **One exact input hash.** The trigger requires `input_hash = dv.input_hash`. The proposed `input_revision` must equal `dv.input_revision`.
- **Exact standard, catalog and Hettich versions.** The 12 pin columns are checked equal to the design version's pins, and kind-specific pins are NULL where unused. `dependency_hashes` records their content.
- **Exact engine version and build.** `engine_version`, `engine_build` and `engine_hash` are required by CHECK on every new row.
- **Content hashed.** `content_hash` is the SHA-256 of the stable-stringified payload, recomputed by `verifySnapshotRecord`. File bytes are hashed separately (`file_object.checksum`, SHA-256).
- **"Latest" is never resolved.**
  - Pins are exact version ids.
  - Upstream snapshots are named by id.
  - The engine identity is the running build's, and it is recorded.
  - List endpoints may sort newest first for display. No generation path, and no dependency, reads "latest".

### 4.3 Engine identity (extends Step 5 correction 2)

```ts
engineIdentity(build) = {
  version: ROOM_ENGINE_VERSION,                       // semantic version of the primary engine, unchanged meaning
  versions: { design: ENGINE_VERSION, bom: BOM_ENGINE_VERSION, boq: BOQ_ENGINE_VERSION,
              pricing: PRICING_ENGINE_VERSION, drawing: DRAWING_ENGINE_VERSION },
  build,                                              // BUILD_REVISION / GITHUB_SHA / Git checkout (Step 5)
  hash: sha256({ engine: "@lintel/engines", versions, build }),
}
```

- **One API-wide identity per build.** Each snapshot stores `engine_version` (the semantic version of the output's primary engine: bom, boq, pricing or drawing), `engine_build`, and `engine_hash` = `identity.hash`.
- Validation runs use the same identity. The current validation fingerprint covers only the design engine versions, so this changes it. No production runs exist.
- **The engine's own seal (`hash53`) is kept as `engine_seal`** for parity with `verify*()`. It is never used as the authoritative hash.

### 4.4 Snapshot identity (the variant key)

| Kind | A snapshot is one of these per… |
|---|---|
| BOM, BOQ, Pricing | design version × purpose × generation |
| Quotation | design version × `revision_number`. The number is unique per design version and assigned by the service in-transaction (proposed unique index). It is passed to the engine as `revision`. |
| Drawing | design version × `drawing_type` × scope (`wall_id` for wall elevations, `object_id` for cabinet drawings, none for the room panel schedule) × `drawing_number` × `drawing_revision` × purpose |
| Manufacturing Document | deferred (F1) |

### 4.5 Snapshot lifecycle

Snapshots have **no `record_lifecycle_status`.** They are immutable facts. Their lifecycle is:

```
generated ──► (QUOTATION / DRAWING, FOR_PRODUCTION, design LOCKED) issued      [quotation_issue / drawing_issue]
          └─► (MANUFACTURING_DOCUMENT, FOR_PRODUCTION, all guards)  released    [derived, Step 4 §8.1; blocked in V1]
```

`current` or `stale` is a **derived view** (§7), not a state. Issue and release are separate insert-only records or derived conditions, and they never modify a snapshot.

### 4.6 Idempotency and duplicates

- **Every POST that generates an output requires an `Idempotency-Key`.** The scopes already exist: `snapshot.<kind>.generate`, `quotation.issue`, `drawing.issue`, `manufacturing.release` and `file.upload`.
  - The same key with the same request replays the stored response.
  - A snapshot response exceeds the 60 KB stored-body cap, so replay uses the `resource { type, id }` rehydration path that exists today.
- **There is no content-based deduplication.** Two deliberate generations for the same inputs create two snapshots. `createdAt` is part of the pricing and quotation payloads, so their content hashes differ anyway.
- The one exception is uniqueness that has meaning:
  - `(design_version_id, revision_number)` for quotations;
  - `(design_version_id, drawing_type, scope, drawing_number, drawing_revision, purpose)` for drawings.

---

## 5. Validation requirements

**Every output kind and every purpose requires approval evidence.** A `validation_run` must exist for **exactly** the design version's current `input_hash` and `input_revision`, and its id is stored on the snapshot. If none exists, the request fails with `409 VALIDATION_REQUIRED` (new problem code). No output is ever generated from unvalidated inputs.

**The output carries its own validation from the running build.** The generation re-runs `resolveRoom`, and `blocker_count` is the output's own count from the engine run now:

| Kind | `blocker_count` |
|---|---|
| BOM, BOQ | `room.validation.counts.BLOCKER` |
| Pricing, Quotation | `room.validation.counts.BLOCKER` + commercial blockers when the result is UNAVAILABLE |
| Drawing | `room.validation.counts.BLOCKER` |

- If the running build finds a BLOCKER the approval run did not, FOR_PRODUCTION is refused.
- Otherwise (PRELIMINARY or FOR_REVIEW) the difference is recorded, with `validationEngineMatches = false` in the response.

This resolves F9 without letting old evidence approve new code.

| Purpose | Validation run | Output's own BLOCKERs | Design version state |
|---|---|---|---|
| PRELIMINARY | required for the current inputs | allowed; shown, and watermarked on drawings | any (DRAFT … SUPERSEDED) |
| FOR_REVIEW | required | allowed; shown and watermarked | IN_REVIEW, APPROVED, LOCKED |
| FOR_PRODUCTION | required, **and 0 BLOCKERs** | **must be 0** (refused before persisting; the database refuses again, LD011) | APPROVED or LOCKED, plus the production guards |

---

## 6. Purpose and lifecycle rules

This extends the existing `output_purpose_rule` without changing it.

| Purpose | Allowed when | Issue | Release | Source purposes allowed |
|---|---|---|---|---|
| PRELIMINARY | design in any status | never | never | PRELIMINARY, FOR_REVIEW, FOR_PRODUCTION |
| FOR_REVIEW | design IN_REVIEW, APPROVED or LOCKED | never | never | FOR_REVIEW, FOR_PRODUCTION |
| FOR_PRODUCTION | design APPROVED or LOCKED; 0 BLOCKERs in the validation run **and** the output; production guards | quotations and drawings, once the design is LOCKED (`check_issue`) | manufacturing documents only (blocked in V1) | FOR_PRODUCTION only |

**Production guards per kind** (all must hold for FOR_PRODUCTION; failure is `PRODUCTION_GUARD_FAILED` / LD021 or `VALIDATION_BLOCKERS` / LD011):

- **All kinds:**
  - every pin is APPROVED or LOCKED (already guaranteed by design approval);
  - `dependency_hashes` equal the pinned versions' current dependency hashes (always true for APPROVED or LOCKED versions);
  - the engine's classification is `PRODUCTION`.
- **Pricing:**
  - the PricingStandard is APPROVED or LOCKED;
  - the engine result is `PRICED`, not `UNAVAILABLE`;
  - there are no `PRICING_*` BLOCKERs.
- **Quotation:**
  - the Pricing guards apply;
  - the QuotationPolicy is APPROVED or LOCKED (approved by FINANCE only, per `commercial_config.approve`);
  - the result is `PRICED`;
  - there are no `QUOTATION_*` BLOCKERs.
- **Drawing:** the engine's own FOR_PRODUCTION guard (`assertProductionEligible`, `DRAWING_MODEL_NOT_FROM_APPROVED_VERSION`, `DRAWING_TEST_FIXTURE_DATA`) returns `CREATED`.
- **Manufacturing Document:** blocked until an approved ManufacturingStandard exists; its variable registry is empty today, so none can be approved.

**Other rules:**

- **Purpose is never upgraded or changed.** A different purpose is always a new snapshot (`purposeChangeDecision`, which returns `RECORD_IMMUTABLE`).
- **The API does not relax any rule** to make an output available. Unavailable production data yields UNAVAILABLE or REFUSED results with BLOCKERs, never a default.

---

## 7. Staleness model

**Staleness is calculated, never persisted.** This keeps the decision in `M5-TECHNICAL-DESIGN.md` §3 item 7.

- Snapshots are immutable, so a stored flag would need a mutable side table that could drift from the truth.
- Every input needed to decide staleness is already recorded on the snapshot, so it can always be recomputed.

### 7.1 Exact definition

A snapshot `S` of design version `DV` is **stale** if and only if at least one of these holds:

| # | Condition | Covers |
|---|---|---|
| S1 | `S.input_hash ≠ DV.input_hash` or `S.input_revision ≠ DV.input_revision` | design object added, changed or removed; override added or versioned; room survey revision re-pinned on the version; any of the 12 dependency pins changed. Pins, objects and overrides can only change while DV is DRAFT. |
| S2 | some pinned version's current dependency hash (envelope and child rows, U10) `≠ S.dependency_hashes[pin]` | a DRAFT dependency's content changed after generation, e.g. a construction standard value, an edge-band rule, a Hettich article, rate-card line or catalog membership. Content is frozen once a version is APPROVED or LOCKED, so this can only affect outputs built on DRAFT dependencies, which are PRELIMINARY by rule. |
| S3 | `S.engine_hash ≠ engineIdentity(currentBuild).hash` | engine build changed (new commit), or any engine semantic version changed |
| S4 | any upstream snapshot of `S` is stale (S1–S3 applied transitively along the persisted edges) | a BOQ built on a stale BOM, and so on |

**What is *not* staleness** (reported as advisories, never as stale):

- **A newer room survey revision that the design version does not pin** (`newerSurveyAvailable`). The design pins an exact survey. Adopting the new one means a new or edited DRAFT, which then makes S1 true.
- **A newer APPROVED version of a dependency** (`newerDependencyVersions[]`). Outputs never follow "latest".
- **The design version being SUPERSEDED.** The output still faithfully represents that version. It is marked `designSuperseded`, but it is not stale.

### 7.2 Engine build versus inputs

S3 means **not reproducible by the running build**. It does not mean the content is wrong.

| Purpose | Effect of S3 alone |
|---|---|
| PRELIMINARY / FOR_REVIEW | shown as stale with reason `ENGINE_CHANGED` |
| FOR_PRODUCTION, already issued | stays issued. An issue is a fact about what was sent. The response flags `engineChanged: true` so a re-issue can be considered. |

### 7.3 Cheap versus detailed staleness

| Where | How | Cost |
|---|---|---|
| `GET …/snapshots` lists, `GET /{kind}-snapshots/{id}` | S1–S4 from stored hashes: one indexed read of DV, the pinned versions' content hashes and upstream rows | no engine run |
| `GET /{kind}-snapshots/{id}/staleness` | the same, plus a run of the existing engine comparators on the current inputs to say **which objects** changed: `compareRoomTrace`, which `checkQuotationStaleness` and `checkRoomDrawingStaleness` both use | one engine run; `output.read.*` |

**Response shape:** `{ stale, reasons: ("INPUTS_CHANGED" | "DEPENDENCY_CONTENT_CHANGED" | "ENGINE_CHANGED" | "SOURCE_STALE")[], changedObjectIds?, advisories: { newerSurveyAvailable, newerDependencyVersions[], designSuperseded } }`.

The engine comparators' `reasons` strings are passed through as `engineReasons[]`.

---

## 8. Per-output contracts

The following apply to every output below, so they are not repeated per kind:

- purpose, provenance and validation (§4–§6);
- the endpoints (§9) and schemas (§10).

### 8.1 BOM (design model → physical bill of materials)

- **Input:** a DesignVersion (exact inputs) and its `validationRunId`.
- **Engine:** `generateRoomBom(resolveRoom(…))`. The output is `RoomBOM`:
  - `objectBoms[]`: one `BOM` per cabinet, with lines of kind PANEL, BOARD, EDGE_BAND, FINISH and HARDWARE;
  - `totals[]`: BOARD, EDGE_BAND, FINISH and HARDWARE per key;
  - `roomFingerprint`, `trace` and `incomplete`.
- **Contract from the model:**

  | BOM line | Derived from |
  |---|---|
  | PANEL | each generated component (finished size; cut allowances belong to manufacturing, F1) |
  | BOARD | net m² by material |
  | EDGE_BAND | net m by edge band |
  | FINISH | m² × finished faces |
  | HARDWARE | resolved Hettich articles by `MANUFACTURER:ARTICLE`; unresolved requirements appear as `UNRESOLVED` lines with quantity 0 |

  The BOM includes no wastage and no prices.
- **Completeness:** `incomplete` from the engine is shown as-is. An incomplete BOM is allowed for PRELIMINARY and FOR_REVIEW. FOR_PRODUCTION requires `incomplete = false` in addition to 0 BLOCKERs (a production guard; proposed as an API-side and DB-checked payload predicate).
- **Engine version:** `BOM_ENGINE_VERSION` (new constant, F2).
- **Seal:** the BOM has no engine seal of its own, so `engine_seal = null`. `content_hash` covers the payload.

### 8.2 BOQ (commercial, product-level quantities, linked to the BOM and never merged with it)

- **Input:** a DesignVersion, `validationRunId` and `bomSnapshotId`.
- **Engine:** `generateRoomBoq(room, catalog, roomBom)`. The output is `RoomBOQ`: one `BOQItem` per object, with `itemCode` and `description` from the product's BOQ templates, `quantity` from the product's BOQ formula, `measures`, and `linkedBomId`.
- **How BOM and BOQ differ:**
  - **The BOM is physical and engineering:** panels, board, edge, finish and hardware lines per cabinet.
  - **The BOQ is commercial:** one product-level line per object, which is what a client sees.
  - **No engineering logic is duplicated.** The BOQ engine takes the BOM as input and checks its trace and link, but never recounts material. The API adds nothing.
  - **Pricing uses both.** Cost comes from BOM measures, and the selling price is spread over the BOQ lines.
- **Checkpoint:** the recomputed `RoomBOM` must equal the named `bomSnapshotId` payload hash. The engine itself throws if the `roomFingerprint` values disagree; that error maps to `409 SOURCE_SNAPSHOT_MISMATCH`.
- **Engine version:** `BOQ_ENGINE_VERSION` (new constant, F2).

### 8.3 Pricing

- **Input:** a DesignVersion (with a **PricingStandard pin**, required by the provenance trigger), `validationRunId`, `bomSnapshotId` and `boqSnapshotId`.
- **Pricing model:** the pinned `pricing_standard_version`. It is one version of rate card plus pricing rules, from `rate_card_line` and the rule columns, mapped by `pricingStandardFromRows`.
  - The engine requires `status = APPROVED` in PRODUCTION mode (`PRICING_RATE_CARD_NOT_APPROVED`, `PRICING_RULES_NOT_APPROVED`).
  - A DRAFT pricing standard therefore yields UNAVAILABLE.
- **No rates are invented.**
  - A NULL rate gives `PRICING_RATE_UNVERIFIED`.
  - A missing rate gives `PRICING_RATE_MISSING`.
  - The engine never prices at zero.
  - Production rates are all NULL today (F8), and this step adds none.
- **Engine:** `priceRoom` (new, F3). It is pure and lives in `@lintel/pricing-engine`. It applies `priceCabinet` to each cabinet with the same gates and returns `PRICED { priceSnapshots: PriceSnapshot[] }` or `UNAVAILABLE { blockers }`.
  - Money is integer paise, computed by the engine (BigInt internally, safe integers out).
- **UNAVAILABLE results:** see OD-S6-5. The recommendation is to **not persist a snapshot** and to return `200 { status: "UNAVAILABLE", blockers, snapshot: null }`. An empty pricing snapshot would look like a price.
- **Engine version:** `PRICING_ENGINE_VERSION`.

### 8.4 Quotation

- **Input:** a DesignVersion (with **PricingStandard and QuotationPolicy pins**), `validationRunId`, `boqSnapshotId` and `pricingSnapshotId`.
- **Engine:** `priceQuotation`. It consumes the BOQ (through `roomBoq`), the approved PricingStandard (rate card and rules), the approved QuotationPolicy (tax rates, category mapping, tax policy, rounding and discount) and the catalog (product category for the tax mapping).
  - Tax, grouping, rounding and totals are computed **only** by the engine, from policy data.
  - **Nothing financial is decided in a controller or service.** The service only assigns `revision_number` (the next per design version) and `createdAt`.
- **Checkpoint:** each embedded `priceSnapshots[i].contentHash` must equal the corresponding entry of the named pricing snapshot.
- **Not invented:**
  - There is no quote validity or expiry. Neither the policy nor the engine has one, so none is added (unresolved U9).
  - Discounts stay `NONE`, the only mode that exists.
- **Issue:** `POST /quotation-snapshots/{id}/issue` (Step 4 §8):
  1. LOCK the design if it is APPROVED;
  2. INSERT `quotation_issue`;
  3. `check_issue` requires FOR_PRODUCTION, a LOCKED design, 0 BLOCKERs and the same design content hash.
- **Engine version:** `PRICING_ENGINE_VERSION`. The quotation is part of the pricing engine.

### 8.5 Drawing (existing M3/M4 engine only)

- **Input:** a DesignVersion and `validationRunId`. Plus the drawing type and scope:

  | Scope | Drawing types |
  |---|---|
  | room | `WALL_INTERNAL_ELEVATION` (+`wallId`), `ROOM_PANEL_SCHEDULE` |
  | object | `FRONT_ELEVATION`, `SIDE_SECTION` (optional `cutX`), `CABINET_INTERNAL_ELEVATION`, `PANEL_SCHEDULE` (+`objectId`) |

  The request also carries `drawingNumber` and `drawingRevision`.
- **Engine:** `@lintel/drawing-engine` only. **No second drawing calculation exists or is added.** `purpose` is passed as `requestedStatus`, and the three values are identical.
  - A `REFUSED` result returns `422 DRAWING_REFUSED` with the engine's blockers, and nothing is persisted.
  - A `CREATED` result, watermarked when it has BLOCKERs or TEST_FIXTURE inputs, is persisted.
- **Metadata comes from records, never from free text:**

  | Field | Source |
  |---|---|
  | `projectCode` | `project.project_code` |
  | `room` | `room.name` |
  | `designer` | design version `created_by` display name |
  | `checker` | design version `approved_by` display name, or `"-"` until approved |
  | `date` | generation date (UTC) |
- **Files:**
  - one SVG per sheet (`renderSvg(d, i)`, UTF-8) and one PDF (`renderPdf([d])`, ASCII string → bytes);
  - each file is stored through `FileService` under `buildStorageKey({ orgId, projectId, designVersionId, kind: "drawing", fileId, extension })`;
  - each is recorded in `file_object` (SHA-256 checksum) and linked through `drawing_snapshot_file (snapshot_id, format, sheet_index)` (F5);
  - files are uploaded in the same request; an orphan left by a rollback is harmless and reused (Step 4 §7).
- **Storage provider:** memory or local file system only. There is no hosted bucket (§13 gate).
- **Payload:** the `RoomDrawing` or `Drawing` model, with its primitives, title block, trace and `contentHash` (hash53 → `engine_seal`).
- **Staleness detail:** `checkRoomDrawingStaleness` / `checkDrawingStaleness`.
- **Issue:** `POST /drawing-snapshots/{id}/issue`, with the same rules as quotations.
- **Engine version:** `DRAWING_ENGINE_VERSION`.

### 8.6 Manufacturing Document

- **There is no engine to reuse (F1).** The contract is defined so the schema, permissions and graph are complete. **The endpoint is proposed to be deferred** until both of these exist:
  1. a manufacturing engine (cut sizes, cut list, labels, drilling; PRD Phase 7), and
  2. a ManufacturingStandard variable model, with at least one version that can be approved. Its registry is empty today.
- **Contract (when enabled):**
  - **Input:** a DesignVersion (with a **ManufacturingStandard pin**, required by the trigger for this kind even for PRELIMINARY) and `validationRunId`.
  - **Engine:** `@lintel/manufacturing-engine`.
  - **Files:** linked through `manufacturing_document_snapshot_file`. Its `format` needs a CHECK (§12).
  - **Purposes:** PRELIMINARY and FOR_REVIEW are allowed. FOR_PRODUCTION stays blocked until a ManufacturingStandard is genuinely approved, the design is LOCKED, there are 0 BLOCKERs and all guards pass.
  - **Release** is derived (Step 4 §8.1). Nothing is weakened to make it available.
- **Rejected alternative (OD-S6-1, option B):** a "document pack" that bundles the drawing engine's panel schedule and the BOM panel lines. It involves no new calculation. It is **not recommended**: a document called "manufacturing" that holds finished sizes without cut allowances invites being cut from.

---

## 9. Endpoint list (`/api/v1`)

All endpoints follow the Step 4 and Step 5 conventions:

- JWT authentication and an org context (`X-Org` proven by a membership);
- layered API, RLS and database authorization;
- RFC 9457 problems;
- keyset pagination;
- `Idempotency-Key` on every POST.

Snapshots are immutable, so there is no PATCH or DELETE, and no If-Match on the snapshot itself. Snapshot ETags are strong: `"<content_hash>"`.

**Generation** (a DesignVersion in any status; the purpose rules apply)

| Method & path | Action (API guard, RLS, DB) | Body | 201 response |
|---|---|---|---|
| `POST /design-versions/{id}/bom-snapshots` | `output.generate.engineering` | `BomGenerateRequest` | `BomSnapshotResponse` |
| `POST /design-versions/{id}/boq-snapshots` | `output.generate.engineering` | `BoqGenerateRequest` | `BoqSnapshotResponse` |
| `POST /design-versions/{id}/pricing-snapshots` | `output.generate.commercial` | `PricingGenerateRequest` | `PricingSnapshotResponse` (or `200` UNAVAILABLE, OD-S6-5) |
| `POST /design-versions/{id}/quotation-snapshots` | `output.generate.commercial` | `QuotationGenerateRequest` | `QuotationSnapshotResponse` (or `200` UNAVAILABLE) |
| `POST /design-versions/{id}/drawing-snapshots` | `output.generate.engineering` | `DrawingGenerateRequest` | `DrawingSnapshotResponse` (or `422 DRAWING_REFUSED`) |
| `POST /design-versions/{id}/manufacturing-document-snapshots` | `output.generate.engineering` (RLS aligned, F6) | `ManufacturingDocumentGenerateRequest` | **deferred (F1)**: route not registered |

**Reads** (the permissions are the existing RLS read actions)

| Method & path | Action |
|---|---|
| `GET /design-versions/{id}/outputs` | the union of the actions below, filtered by what the caller may read. Summary graph: every snapshot of the version (no payloads) with purpose, blockers, `current` / `stale`, and the edges. |
| `GET /design-versions/{id}/bom-snapshots` · `…/boq-snapshots` · `…/drawing-snapshots` | `output.read.production` |
| `GET /design-versions/{id}/pricing-snapshots` · `…/quotation-snapshots` | `output.read.cost` |
| `GET /bom-snapshots/{id}` · `/boq-snapshots/{id}` · `/drawing-snapshots/{id}` | `output.read.production`. Includes the payload; `?include=payload` is the default. |
| `GET /pricing-snapshots/{id}` · `/quotation-snapshots/{id}` | `output.read.cost` |
| `GET /{kind}-snapshots/{id}/staleness` | as the read above. Runs the engine comparators (§7.3). |
| `GET /drawing-snapshots/{id}/files` | `output.read.production` (or `output.read.issued` for issued drawings, CLIENT deferred) |
| `GET /files/{id}/url` | RLS `file_read` / `client_can_read_file`. Signed URL valid 300 s; never persisted (Step 4 §7). |

**Issue and release** (Step 4 §8 and §8.1; included here for completeness of the lifecycle)

| Method & path | Action |
|---|---|
| `POST /quotation-snapshots/{id}/issue` `{ reason }` | `quotation.issue` |
| `POST /drawing-snapshots/{id}/issue` `{ reason }` | `drawing.issue` |
| `GET /quotation-snapshots/{id}/issue` · `GET /drawing-snapshots/{id}/issue` | read action, or `output.read.issued` |
| `POST /design-versions/{id}/manufacturing-release` `{ reason }` · `GET …/manufacturing-release` | `manufacturing.release` / `output.read.production`. Always refused in V1 (no approvable ManufacturingStandard). |

**Changes from the Step 4 §11.1 proposal:**

- **Resource names.** Step 4 used `/design-versions/{id}/bom` and `GET /snapshots/{kind}/{id}`. This plan uses `/{kind}-snapshots` collections, which are typed per kind, so their permissions and schemas differ cleanly. The issue routes already used this naming.
- **New endpoints:**
  - an outputs summary graph;
  - a detailed staleness endpoint;
  - sheet-level drawing files.
- The client portal remains deferred.

**Problem codes:**

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_REQUIRED` | 409 | new: no validation run for the current inputs |
| `SOURCE_SNAPSHOT_MISMATCH` | 409 | new: a named upstream snapshot is for other inputs or engine, is stale, or its checkpoint hash differs |
| `SOURCE_PURPOSE_INSUFFICIENT` | 409 | new: an upstream purpose is weaker than requested |
| `DRAWING_REFUSED` | 422 | new: the drawing engine's own guard refused |
| `PROVENANCE_MISMATCH` | existing, LD016 | provenance does not match |
| `OUTPUT_PURPOSE_NOT_ALLOWED` | existing, LD024 | purpose not allowed in this state |
| `PRODUCTION_GUARD_FAILED` | existing, LD021 | production guard failed |
| `VALIDATION_BLOCKERS` | existing, LD011 | BLOCKERs present |
| `ISSUE_PRECONDITIONS_FAILED` | existing, LD017 | issue preconditions failed |
| `RECORD_IMMUTABLE` | existing, LD015 | record cannot change |

New database-originated codes are appended to the `design_os.error_code` registry (LD025 onward) by 0017. No existing code changes.

---

## 10. Request and response schemas (Zod, strict objects)

### 10.1 Requests

```ts
const Purpose = z.enum(["PRELIMINARY", "FOR_REVIEW", "FOR_PRODUCTION"]);        // default PRELIMINARY
const GenerateBase = z.strictObject({ purpose: Purpose.default("PRELIMINARY"), validationRunId: Uuid });

BomGenerateRequest       = GenerateBase;
BoqGenerateRequest       = GenerateBase.extend({ bomSnapshotId: Uuid });
PricingGenerateRequest   = GenerateBase.extend({ bomSnapshotId: Uuid, boqSnapshotId: Uuid });
QuotationGenerateRequest = GenerateBase.extend({ boqSnapshotId: Uuid, pricingSnapshotId: Uuid });
DrawingGenerateRequest   = GenerateBase.extend({
  drawingType: z.enum(["WALL_INTERNAL_ELEVATION", "ROOM_PANEL_SCHEDULE", "FRONT_ELEVATION", "SIDE_SECTION",
                       "CABINET_INTERNAL_ELEVATION", "PANEL_SCHEDULE"]),
  wallId: z.enum(["A", "B", "C", "D"]).optional(),   // required iff WALL_INTERNAL_ELEVATION (refine)
  objectId: Uuid.optional(),                          // required iff an object-scope type (refine)
  cutX: Millimetres.optional(),                       // SIDE_SECTION only (refine)
  drawingNumber: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/),
  drawingRevision: z.string().regex(/^[A-Z0-9]{1,4}$/),
});
IssueRequest = z.strictObject({ reason: Reason });
```

**Rules:**

- **No request can carry a quantity, price, rate, tax, total, blocker count, hash, engine identity, `createdAt`, designer or checker.** All of them come from engines, records or the server.
- **`validationRunId` is explicit,** so the client states which evidence it relies on. The server verifies that the run is for the current `input_hash` and `input_revision`.

### 10.2 Responses

```ts
SnapshotEnvelope = {
  id, kind, purpose, designVersionId, designVersionStatus, designVersionContentHash,
  inputHash, inputRevision, pins: Pins /* the 12, exact ids */, dependencyHashes: Record<PinName, Sha256 | null>,
  validationRunId, validationEngineMatches: boolean,
  sources: { bomSnapshotId?, boqSnapshotId?, pricingSnapshotId? },
  engine: { version, build, hash /* fingerprint */, seal /* engine hash53 or null */ },
  contentHash, blockerCount, dataClassification: "PRODUCTION",
  qualifiesForIssue: boolean, qualifiesForRelease: boolean, issued?: IssueSummary,
  staleness: { stale, reasons[], advisories },     // cheap form, §7.3
  createdBy, createdAt,
}
BomSnapshotResponse       = SnapshotEnvelope & { payload: RoomBomPayload }        // RoomBOM
BoqSnapshotResponse       = SnapshotEnvelope & { payload: RoomBoqPayload }        // RoomBOQ
PricingSnapshotResponse   = SnapshotEnvelope & { payload: { priceSnapshots: PriceSnapshotPayload[] } }
QuotationSnapshotResponse = SnapshotEnvelope & { revisionNumber, payload: QuotationSnapshotPayload }
DrawingSnapshotResponse   = SnapshotEnvelope & { drawingType, wallId?, objectId?, drawingNumber, drawingRevision,
                                                 files: { format: "SVG" | "PDF", sheetIndex, fileId, contentType, byteSize, checksum }[],
                                                 payload: DrawingPayload }        // RoomDrawing | Drawing
Unavailable               = { status: "UNAVAILABLE", blockers: ValidationMessage[], snapshot: null }   // OD-S6-5
StalenessResponse         = { stale, reasons[], changedObjectIds[], engineReasons[], advisories }
OutputsGraphResponse      = { designVersionId, inputHash, nodes: SnapshotSummary[], edges: { from, to, kind }[] }
```

**Payload schemas mirror the engine types exactly.** Each payload schema (`RoomBomPayload`, …) is a Zod mirror of the corresponding `@lintel/types` interface, used for response validation and OpenAPI only. A compile-time assertion per schema (`Expect<Equal<z.infer<typeof RoomBomPayload>, RoomBOM>>`) fails the typecheck if the engine type and the contract drift. No engine logic is duplicated.

**Encoding:**

- **Money** is integer paise as JSON numbers. The engine guarantees safe integers (`toSafeNumber` throws above 2^53).
- **Dimensions** are integer or decimal millimetres, as the engine emits them.
- **Neither is formatted or recomputed** in the API.

---

## 11. OpenAPI approach

1. **Single source of truth.** The Zod request and response schemas above, plus the existing Step 4 and Step 5 schemas, are the contract. There are no hand-written YAML files.
2. **Generation.**
   - Controllers register route metadata (method, path, action, request and response schemas, problem codes) in a small route registry. This reuses the decorators that exist today, with no reflection metadata.
   - A build script (`pnpm api:openapi`) converts each schema with Zod 4 `z.toJSONSchema()` and assembles an **OpenAPI 3.1** document.
   - Problems are the RFC 9457 schema, with the `type` URN enumerated from `PROBLEM_CODES`.
3. **Artifact and drift check.**
   - The committed file is `apps/api/openapi/openapi.json`.
   - A CI test regenerates it and fails on any difference, the same pattern as `database/schema/design_os.schema.txt`.
   - Payload schemas are also checked against the engine types at compile time (§10.2).
4. **Timing (per the brief).**
   - This step defines the schemas only.
   - The final OpenAPI artifact is generated when Step 7 implements the output modules. The generator can emit today's Step 4 and Step 5 endpoints earlier if wanted, but the output paths appear only once implemented.
   - The deferred manufacturing endpoint is omitted until it exists.

---

## 12. Schema changes this contract needs (proposed migration 0017, **not written**)

| Change | Why |
|---|---|
| All snapshot tables: add `engine_build text` and a NOT VALID CHECK (same pattern as `validation_run`) | engine build provenance (F4) |
| All snapshot tables: redefine `engine_hash` as the SHA-256 engine fingerprint (CHECK `sha256:` + 64 hex); add `engine_seal text NULL` for the engine's hash53. Update `buildSnapshotRecord` / `SnapshotRecord` to match. | one meaning of `engine_hash` across runs and snapshots. The tables are empty everywhere, so this is safe. |
| All snapshot tables: add `input_revision integer NOT NULL`, `validation_run_id uuid NOT NULL` (composite FK), `dependency_hashes jsonb NOT NULL` | §4 and §5. Trigger checks: revision equals `dv.input_revision`; the run is for exactly this `input_hash` + `input_revision`; the dependency hashes equal the pinned versions' content hashes at insert. |
| `boq_snapshot.bom_snapshot_id`; `pricing_snapshot.bom_snapshot_id`, `boq_snapshot_id`; `quotation_snapshot.boq_snapshot_id`, `pricing_snapshot_id` (composite FKs, NOT NULL) and an edge trigger | §2 graph. Sources have the same `design_version_id`, `input_hash` and `engine_hash`, and a purpose at least as strong (§6). |
| `quotation_snapshot`: UNIQUE `(design_version_id, revision_number)` | F7 |
| `drawing_snapshot`: CHECK on `drawing_type` (6 values); drop the `FRONT_ELEVATION` default; add `wall_id`, `object_id`, `drawing_number`, `drawing_revision` with scope CHECKs; UNIQUE per §4.4 | F5 |
| `drawing_snapshot_file`: add `sheet_index integer NULL` (SVG only); PK becomes `(snapshot_id, format, sheet_index)` via a unique index that treats NULL as 0 | F5 |
| `manufacturing_document_snapshot_file.format`: CHECK (`'PDF'`, `'CSV'`, `'JSON'`; to be confirmed with the engine) | F1 |
| `manufacturing_document_snapshot` INSERT policy: `output.generate.engineering` (release stays `manufacturing.release`) | F6 |
| `error_code` registry: LD025 onward for `VALIDATION_REQUIRED`, `SOURCE_SNAPSHOT_MISMATCH`, `SOURCE_PURPOSE_INSUFFICIENT` | §9 |
| Down migration restores 0016 exactly; rollback-equivalence and drift checks as in Step 5 | — |

**Engine-package changes the contract needs.** None of them change a calculation:

- `BOM_ENGINE_VERSION` and `BOQ_ENGINE_VERSION` constants (F2);
- `priceRoom` in `@lintel/pricing-engine` (F3), a pure composition of `priceCabinet` with tests.

---

## 13. Unresolved architectural issues and decisions requested

**Decisions** (the recommendation is marked):

| ID | Question | Options | Recommendation |
|---|---|---|---|
| OD-S6-1 | Manufacturing documents without a manufacturing engine | A: defer the endpoint until the engine and an approvable ManufacturingStandard exist · B: a document pack of existing drawing and BOM outputs, PRELIMINARY / FOR_REVIEW only | **A** |
| OD-S6-2 | How downstream outputs get their inputs | A: explicit upstream snapshot ids in the request, recomputed and checkpoint-verified · B: the server generates missing upstream snapshots in the same request | **A** (explicit graph). B can be a later convenience. |
| OD-S6-3 | Engine identity | A: one API-wide fingerprint (all engine versions + build), used by validation runs and snapshots · B: a per-output-kind fingerprint | **A** |
| OD-S6-4 | Room-level pricing | A: add pure `priceRoom` to `@lintel/pricing-engine` · B: PRICING stays per-cabinet only (no room pricing snapshot) | **A** |
| OD-S6-5 | Persist UNAVAILABLE pricing / quotation results? | A: no snapshot; `200 { status: "UNAVAILABLE", blockers }` · B: persist a snapshot with `blocker_count > 0` and no prices | **A** |
| OD-S6-6 | Commercial pins live in the design version's input hash | A: keep (today's model). Changing the pricing standard or quotation policy of a DRAFT makes its engineering outputs stale too, and an APPROVED version without commercial pins needs a new design version to be priced. · B: kind-scoped input hashes, or commercial pins moved to a separate versioned "commercial context" | **A for Step 7.** B is recorded as follow-up U1. |
| OD-S6-7 | Manufacturing snapshot INSERT permission | A: `output.generate.engineering` (generation ≠ release) · B: keep `manufacturing.release` | **A** |
| OD-S6-8 | Drawing snapshot scope | A: room drawings and object (cabinet) drawings · B: room drawings only in Step 7 | **A.** Both engines exist and are tested. |

**Unresolved issues** (known limits, not blocking Step 7 unless noted):

| # | Issue |
|---|---|
| U1 | **Commercial pins inside the design input hash (OD-S6-6).** Engineering and commercial inputs share one hash, so commercial changes stale engineering outputs. Commercial terms also cannot be revised on an APPROVED design without a new design version. Needs a product decision before production quoting. |
| U2 | **BL-1 and BL-2 remain open.** The hardware rule-set version is visible only through `catalogVersion`, and the Hettich dataset status is invisible to the engine. The snapshot pins still record both exactly, but the engine trace is coarser than the provenance. |
| U3 | **Engine seals are `hash53` (53-bit, not cryptographic).** SHA-256 `content_hash` is authoritative. The seal is kept only for engine parity. Upgrading the engine seal to SHA-256 is a separate engine change. |
| U4 | **All production commercial data is NULL (F8).** Every production pricing and quotation returns UNAVAILABLE until finance and procurement approve real data. Nothing is invented. |
| U5 | **No manufacturing engine or ManufacturingStandard model (F1).** Release is impossible in V1, as intended. |
| U6 | **Response sizes.** Drawing primitives and quotations can be large. Replay uses resource rehydration. List endpoints never include payloads. If needed, `?include=payload` pagination by object is a later option. |
| U7 | **Storage.** The API needs a configured `FileStorageProvider` (memory for tests, local file system for development). Hosted buckets wait for the §13 Mumbai gate. Content-addressed orphans after a rollback are accepted. |
| U8 | **`M5-TECHNICAL-DESIGN.md` §6 is out of date.** It describes an idempotent unique index that does not exist, and `engine_version` as "package version + git SHA". Both are corrected by this plan and would be updated with the approval. |
| U9 | **Quotation validity and expiry, discounts other than NONE, and currency other than INR** are not modelled in the policy or engine. They are financial policy and are not added. |
| U10 | **Staleness S2 relies on a content hash for every pinned version.** Every version table carries `content_hash` (the 0001 envelope). While a version is DRAFT, however, its child rows can change without that hash being recomputed: catalog members, rate-card lines, standard values, Hettich articles. Step 7 must either recompute the version `content_hash` whenever child rows change in DRAFT, or have S2 hash the pinned version's child rows directly. **Recommendation:** hash the child rows directly (read-only, no new trigger). This affects PRELIMINARY outputs on DRAFT dependencies only. |
| U11 | **Object-scope drawings need a cabinet from the room resolution** (`room.cabinets` by `objectId`). The cabinet trace then carries the room's design version, so a cabinet drawing's staleness uses `checkDrawingStaleness` against the same resolution. This needs confirming in tests. |

---

## 14. Proposed Step 7 implementation sequence (only after this plan is approved)

1. Engine constants and `priceRoom` (F2, F3), with unit tests. No calculation changes.
2. Migration 0017 (§12): up, down and up again; drift check; rollback equivalence; database tests for every trigger rule (provenance, edges, validation evidence, dependency hashes, purposes, uniqueness).
3. `@lintel/persistence`:
   - the `SnapshotRecord` / `SnapshotRow` additions;
   - an extended `engineIdentity`;
   - dependency-hash readers.
4. Outputs module: BOM and BOQ, then drawings with files, then pricing and quotation, then issue. Each has API database tests covering:
   - the purpose × state matrix;
   - checkpoint mismatches;
   - cross-tenant refusal;
   - replay;
   - staleness S1–S4.
5. OpenAPI generator and committed artifact with a drift check (§11).
6. Manufacturing: nothing until OD-S6-1 is revisited.

**Stop point.** This document is the Step 6 review checkpoint. No output implementation starts before it is approved.
