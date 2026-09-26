# M5 Step 6: Output Architecture and API Contract (review-only plan, revision 4)

**Status:** revision 4. Revision 3 added three things to revisions 1 and 2:

- **OD-S6-9** is resolved: the dependency-closure engine fingerprint.
- **Correction 1:** commercial dependencies are decoupled from the design version.
- **Correction 2:** validation runs get a purpose (APPROVAL or OUTPUT_GENERATION).

Revision 4 adds two final clarifications:

- **Clarification A:** one shared, immutable `OutputExecutionContext` per request (§7.2).
- **Clarification B:** output rules for SUPERSEDED designs (§11).

**Nothing here is implemented.** There is:

- no migration SQL;
- no engine code;
- no BOM, BOQ, pricing, quotation, drawing or manufacturing API;
- no UI and no hosted Supabase;
- no production rates, Hettich data or ManufacturingStandard values.

**Builds on:**

- `M5-TECHNICAL-DESIGN.md` §3 and §6;
- `M5-STEP4-API-PLAN.md` §6–§8.1;
- `M5-STEP5-CORE-DESIGN-API.md` (migrations 0015 and 0016).

**Contents**

0. Decisions
1. Survey findings
2. Dependency graph
3. Engineering dependency model
4. Commercial dependency model
5. Validation-run purpose model
6. Engine identity and fingerprint algorithm
7. Server-orchestrated dependency resolution
8. Output snapshot provenance schema
9. Snapshot uniqueness and idempotency
10. Staleness algorithm
11. Purpose and lifecycle rules
12. Per-output contracts, including the drawing map and the manufacturing boundary
13. Drawing file model
14. Output permission matrix
15. Endpoint list
16. Request and response schemas
17. OpenAPI approach
18. Prerequisite matrix
19. Changes the next step must make (described; not written)
20. Unresolved risks
21. Implementation sequence

---

## 0. Decisions

| ID | Decision |
|---|---|
| OD-S6-1 | **Manufacturing-document generation is deferred.** No manufacturing engine and no production ManufacturingStandard exist. No new calculation is created and no manufacturing output endpoint exists. The future boundary and the current blockers are documented (§12.6). |
| OD-S6-2 | **The server resolves dependencies.** A client requests the output it wants. The server finds an exact compatible upstream snapshot by natural identity, or generates one, and records its exact id. There is no "latest". A client may name exact upstream snapshots only to reproduce an earlier output (§7). |
| OD-S6-3 | **A fingerprint is recorded per output engine:** `validation`, `bom`, `boq`, `pricing`, `quotation`, `drawing` (later `manufacturing`). Each output records the engine name, semantic version, exact build and fingerprint (§6). |
| OD-S6-4 | **A pure `priceRoom` is added to `@lintel/pricing-engine`.** The API never calculates a price or total. |
| OD-S6-5 | **UNAVAILABLE pricing or quotation results are never persisted.** The response carries structured blockers. TEST_FIXTURE pricing stays test-only. |
| OD-S6-6 | **Engineering and commercial dependencies are separate domains.** Revision 3 completes this through Correction 1. |
| OD-S6-7 | **Manufacturing generation and release are separate authorities** (for the future). Generation requires `output.generate.engineering`; release requires `manufacturing.release`. |
| OD-S6-8 | **Both room and cabinet drawings are included,** using only the existing M3/M4 drawing engine (§12.5). |
| **OD-S6-9** | **The fingerprint is a dependency-closure fingerprint (§6).** It covers the engine's semantic version, the source files of the engine and of every internal package it reaches, and the locked versions of external dependencies. The human-readable commit/build is recorded **separately**. The repository as a whole is never hashed. |
| **Correction 1** | **Commercial dependencies are chosen when an output is generated, never pinned on the design version (§4).** The design version's PricingStandard and QuotationPolicy pins are **removed** from the design version. Commercial provenance lives only on Pricing and Quotation snapshots. The ManufacturingStandard pin follows the same rule (§3.3). |
| **Correction 2** | **Validation runs have a purpose: `APPROVAL` or `OUTPUT_GENERATION` (§5).** Output generation records its own immutable OUTPUT_GENERATION run, for any design status, and never mutates the design. |
| **Clarification A** | **Every generation request builds exactly one immutable `OutputExecutionContext` (§7.2).** The room and model are resolved **once**. That same context is validated and used for the requested output and any upstream outputs generated in the request. The OUTPUT_GENERATION run and the snapshots are persisted atomically in one transaction. Validation and output never come from two independently rebuilt contexts, and there is no second room resolution. |
| **Clarification B** | **SUPERSEDED designs support only PRELIMINARY and FOR_REVIEW outputs, for reproduction or review (§11).** FOR_PRODUCTION, quotation issue, drawing issue and manufacturing release are forbidden. APPROVED and LOCKED designs keep every applicable purpose under the production guards. DRAFT and IN_REVIEW follow the existing matrix. |
| Dependency rule | **A downstream output uses an exact immutable upstream snapshot.** The server verifies its provenance and content hash and never re-runs the upstream output engine. If the upstream is stale or incompatible, a new one is generated first (§7). |

---

## 1. Survey findings (unchanged facts)

| # | Finding |
|---|---|
| F1 | **There is no manufacturing engine.** `packages/manufacturing-engine` contains only a README. There is no ManufacturingStandard type, the variable registry is empty, and every value is NULL / UNVERIFIED. |
| F2 | **Only some engines have a version constant.** They are `ENGINE_VERSION` (design), `PRICING_ENGINE_VERSION` and `DRAWING_ENGINE_VERSION`. There is none for BOM, BOQ or quotation. |
| F3 | **There is no room-level pricing function,** and `priceQuotation` re-prices every cabinet internally. |
| F4 | **Snapshots do not record the engine.** They have no engine name, build or fingerprint. Their `engine_hash` is the engine's `hash53` payload seal. |
| F5 | **`drawing_snapshot_file` allows only one SVG per snapshot.** Its key is `(snapshot_id, format)`. |
| F6 | **The manufacturing snapshot INSERT policy requires `manufacturing.release`.** |
| F7 | **There is no snapshot uniqueness in the database.** |
| F8 | **All production commercial data is NULL or DRAFT.** |
| F9 | **`record_validation_run()` accepts only DRAFT or IN_REVIEW versions.** Output-time validation of APPROVED or LOCKED designs is therefore impossible today. |
| F10 | **The design version's `input_hash` and `input_revision` cover all 12 pins,** commercial pins included. Validation, SUBMIT (LD010) and APPROVE are bound to them. |
| F11 | **The design package imports four internal packages; the Hettich engine is not among them.** `@lintel/design-engine` imports `types`, `rules-engine`, `geometry-engine` and `catalog-engine`. The Hettich engine reaches `resolveRoom` only through the adapter the API injects (`createHettichAdapter`). Engine inputs are built by the `@lintel/persistence` mappers. The engines have **no external runtime dependencies** today. |

---

## 2. Dependency graph

```
DesignVersion (engineering inputs only) ─► ValidationRun [APPROVAL]            ─► SUBMIT / APPROVE
                                        └► ValidationRun [OUTPUT_GENERATION]    ─► gating evidence for every snapshot (§5)

DesignVersion ─► BOM ─► BOQ ─► Pricing ─────► Quotation
                                  ▲               ▲   ▲
                   PricingStandard version        │   └── QuotationPolicy version (chosen at generation)
                   (chosen at generation) ────────┘       Quotation uses the Pricing snapshot's PricingStandard

DesignVersion ─► Drawings (room-level and cabinet-level)
DesignVersion ─► Manufacturing Document (FUTURE ONLY; + ManufacturingStandard version chosen at generation)
```

| Snapshot | Upstream snapshots | Evidence | Commercial versions (recorded on the snapshot) |
|---|---|---|---|
| BOM | none | OUTPUT_GENERATION run | none |
| BOQ | BOM | OUTPUT_GENERATION run | none |
| Pricing | BOM, BOQ | OUTPUT_GENERATION run | PricingStandard |
| Quotation | BOQ, Pricing | OUTPUT_GENERATION run | PricingStandard (= its Pricing snapshot's), QuotationPolicy |
| Drawing | none | OUTPUT_GENERATION run | none |

**What the evidence link is.** The validation run is **evidence and gating provenance**, not an upstream calculation. No engine reads a validation run as input.

**What can make an engineering output stale.** Commercial data can never make a design, a validation run, a BOM, a BOQ or a drawing stale.

---

## 3. Engineering dependency model

### 3.1 What a design version is

A DesignVersion is **only** the physical design and its engineering dependencies:

| Group | Inputs |
|---|---|
| Room | the room survey revision (exact id + `content_hash`) |
| Content | design objects (without row ids) and relationship overrides (full version history) |
| Engineering pins (9) | construction standard, planning standard, edge-band standard, material catalog, finish catalog, hardware catalog, product catalog, appliance catalog (nullable; no data yet), Hettich dataset |

### 3.2 Hashes and counters (existing columns; definition narrowed)

| Column | Definition after Correction 1 | Maintained by |
|---|---|---|
| `design_version.input_hash` | **The engineering input hash.** `designInputHash()` = SHA-256 of `{ roomRevision: { id, contentHash }, objects, overrides, engineeringPins (the 9) }`. It no longer contains any commercial or manufacturing pin. | API, recomputed on every draft change (as today) |
| `design_version.input_revision` | **The engineering input revision.** A counter bumped by any change to objects, overrides, the room revision or an engineering pin. | database triggers (as today); the API cannot forge it |

- The column names stay the same, and the API fields `inputHash` and `inputRevision` keep their names. **Their meaning is "engineering inputs"**, because that is all a design version now has.
- No separate `engineering_input_hash` column is needed.

### 3.3 The existing commercial and manufacturing pin columns on `design_version`

**`pricing_standard_version_id`, `quotation_policy_version_id` and `manufacturing_standard_version_id` are removed from the design version.** They are not kept as deprecated or ignored columns.

- **Pricing and quotation.** The versions an output used are recorded **on the Pricing and Quotation snapshots**, which already carry these columns (§8). That is the only commercial provenance.
- **Manufacturing.** ManufacturingStandard is process data that is not part of the physical design. Like commercial data, it is chosen when a manufacturing document is generated and recorded on that snapshot (future). Nothing reads the design-version pin today: manufacturing is deferred, and no ManufacturingStandard version can be approved.
- **Why removed rather than deprecated.** An ignored column would still appear in queries, pins and `lock_cascade`, and invite misuse. No production data exists; the change is applied to local or CI databases only.

**Everything that references these pins changes with them (§19):**

- the API `PinsInput` and `Pins` (12 → 9 pins);
- the `@lintel/persistence` `DesignVersionPins`;
- `designInputHash`;
- `maintain_input_revision`;
- the approval pin check;
- `lock_cascade`;
- `check_snapshot_provenance`;
- the design-version tests.

### 3.4 Consequences

- **Design approval covers engineering only.** It requires every engineering pin to be APPROVED or LOCKED, and an APPROVAL validation run with 0 BLOCKERs for the current `input_hash` and `input_revision`.
- **Commercial approval is checked where commercial data is used:** by Pricing and Quotation generation at FOR_PRODUCTION (§11), and by quotation issue.
- **LOCK of a design** cascades to its engineering pins only.
- **Issuing a quotation** additionally locks the exact PricingStandard and QuotationPolicy versions the quotation snapshot used (§4.4).

---

## 4. Commercial dependency model

### 4.1 Chosen at generation, exactly

Each Pricing and Quotation request names **exact** commercial versions:

| Output | Request field | Constraint |
|---|---|---|
| Pricing | `pricingStandardVersionId` (required) | same organization |
| Quotation | `quotationPolicyVersionId` (required) | same organization |
| Quotation | `pricingStandardVersionId` (required) | the Pricing snapshot used must have been produced with this exact version (the server resolves or generates it with this version, §7) |

- **There is no default and no "current price list" lookup.** A client that wants the newest approved PricingStandard must say which version that is; the API offers the list through the reference-data endpoints.
- **A future project-level "commercial context"** (a stored choice of versions) could supply these ids, but it would still resolve to exact ids recorded on the snapshot. It is recorded as risk R1 and is not part of this plan.

### 4.2 Commercial provenance on snapshots

| Column | Pricing | Quotation |
|---|---|---|
| `pricing_standard_version_id` | NOT NULL, FK (org) | NOT NULL, FK (org); must equal the source Pricing snapshot's |
| `quotation_policy_version_id` | NULL | NOT NULL, FK (org) |
| `commercial_input_hash` | `H({ pricingStandard: { id, dependencyHash } })` | `H({ pricingStandard: { id, dependencyHash }, quotationPolicy: { id, dependencyHash } })` |
| `dependency_hashes` | the 9 engineering pins + PricingStandard | the 9 engineering pins + PricingStandard + QuotationPolicy |

**`dependencyHash(version)`** is the SHA-256 of the version's envelope `content_hash` plus all of its child rows:

| Version type | Child rows |
|---|---|
| PricingStandard | rate-card lines |
| QuotationPolicy | tax rates and tax-rate mappings |
| Engineering pins | their values, rules, members or articles |

Child rows are read and hashed directly, so a change to a DRAFT version's child rows is detected.

### 4.3 The worked example

```
Design V12 + PricingStandard V3  → Pricing snapshot A   (natural identity includes PricingStandard V3)
Design V12 + PricingStandard V4  → Pricing snapshot B   (another identity; no Design V13)
Pricing B + QuotationPolicy P2   → Quotation Q1
Pricing B + QuotationPolicy P3   → Quotation Q2         (BOM, BOQ, drawings and Pricing B untouched)
```

- **The BOM and BOQ snapshots of V12 are reused** by both A and B: they are the same engineering outputs.
- **The engine version gates.** The engine requires APPROVED commercial data in production mode. A DRAFT PricingStandard or QuotationPolicy therefore yields `UNAVAILABLE`, which is not persisted.

### 4.4 Commercial lifecycle rules

| Purpose | PricingStandard / QuotationPolicy status required |
|---|---|
| PRELIMINARY / FOR_REVIEW | any (DRAFT … LOCKED). The engine returns UNAVAILABLE for non-APPROVED data in production mode. Only a real PRICED result is persisted, so in practice every persisted Pricing or Quotation needs APPROVED or LOCKED commercial versions. |
| FOR_PRODUCTION | APPROVED or LOCKED, **plus** the design APPROVED or LOCKED |
| Quotation issue | `check_issue` (FOR_PRODUCTION, design LOCKED, 0 BLOCKERs, same design content hash). In the same transaction, the design is LOCKed if it is APPROVED, and the exact PricingStandard and QuotationPolicy versions are LOCKed if they are APPROVED, through `transition(…, 'LOCK')`. **An issued quotation's commercial basis can never change or be superseded out from under it.** |

---

## 5. Validation-run purpose model (Correction 2)

### 5.1 Two purposes

| | `APPROVAL` | `OUTPUT_GENERATION` |
|---|---|---|
| Created by | `POST /design-versions/{id}/validation-runs` (exists) | the server, inside every output generation transaction; there is **no public endpoint** that creates one |
| Design status allowed | DRAFT, IN_REVIEW (unchanged, F9) | **any**: DRAFT, IN_REVIEW, APPROVED, LOCKED, SUPERSEDED |
| Used by | SUBMIT (LD010) and APPROVE: the latest **APPROVAL** run for the current engineering `input_hash` + `input_revision`, with 0 BLOCKERs for APPROVE | output snapshots, as `validation_run_id` (NOT NULL): gating evidence |
| Mutates the design? | no | **no.** The design row is only read (`FOR SHARE`); no lifecycle, hash, revision or column changes. |
| Immutable | yes (insert-only, LD015) | yes (insert-only, LD015) |
| Records | engine name `validation`, version, build, fingerprint; engineering `input_hash`, `input_revision`, `dependency_set_hash`; blocker and warning counts; messages; `content_hash`; `created_by`; `created_at` | the same |
| Permission | `design_version.author` or `output.generate.engineering` | the generating action of the output: `output.generate.engineering`, or `output.generate.commercial` for Pricing and Quotation |
| Reuse | none (each run is approval evidence at a point in time) | natural identity `(org, design_version_id, input_hash, input_revision, dependency_set_hash, engine_fingerprint)`, unique where `purpose = 'OUTPUT_GENERATION'`. Many snapshots can reference one run. |

### 5.2 How output generation validates

1. The request builds one `OutputExecutionContext` (§7.2), which resolves the room **once**.
2. The OUTPUT_GENERATION run is recorded, or reused by natural identity, from `context.resolved.validation`, the validation of **that exact context**. There is no second room resolution. The run carries the `validation` engine's fingerprint (§6).
3. The requested output, and any upstream output generated in the same request, are computed from the **same** `context.resolved`.
4. The snapshot references the run (`validation_run_id`). The run is evidence, not an input: the snapshot's payload is computed from the context, never from the run.
5. The run and the snapshots are written in **one transaction**. Either all of them are committed or none is.

**Gating:**

| Purpose | Gate |
|---|---|
| PRELIMINARY / FOR_REVIEW | none. The run's BLOCKERs are shown and propagated to `blocker_count`. |
| FOR_PRODUCTION | the OUTPUT_GENERATION run has **0 BLOCKERs** **and** the output's own engine result has 0 BLOCKERs **and** the design is APPROVED or LOCKED |

For FOR_PRODUCTION, the design was approved on an APPROVAL run, possibly from an older build. The OUTPUT_GENERATION run proves that **the running build** also finds no BLOCKERs on the exact same engineering inputs. This resolves F9 without letting old evidence approve new code.

**Database rules** (trigger on insert into the snapshot tables and `validation_run`):

- A snapshot's `validation_run_id` must reference a run with `purpose = 'OUTPUT_GENERATION'`, the same organization and `design_version_id`, and the same `input_hash`, `input_revision` and `dependency_set_hash` of the engineering pins.
- For FOR_PRODUCTION, the run must have `blocker_count = 0`.
- An APPROVAL run can never be referenced by a snapshot.
- An OUTPUT_GENERATION run can never satisfy SUBMIT or APPROVE.
- `record_validation_run` takes `p_purpose`.
  - APPROVAL keeps the DRAFT / IN_REVIEW rule.
  - OUTPUT_GENERATION accepts any status and requires the output-generation permissions. For a SUPERSEDED design, the snapshot rules of §11 still decide which outputs can use the run: only PRELIMINARY and FOR_REVIEW.
- **A newly inserted OUTPUT_GENERATION run must be referenced by at least one snapshot inserted in the same transaction.** A deferred constraint trigger checks this at commit, so a run is never recorded as a side effect. A run that was *reused* by natural identity is already referenced.

---

## 6. Engine identity and fingerprint algorithm (OD-S6-9)

### 6.1 Output engines and their entry points

Each output engine has **one composition entry module** in the API. The entry module is the only place that wires rows to engines: it holds the mapper calls, the adapters and the engine calls.

| Engine name | Entry module (Step 7) | Semantic version | Reaches (import graph) |
|---|---|---|---|
| `validation` | `apps/api/src/modules/outputs/engines/validation.ts` | `ROOM_ENGINE_VERSION` | design-engine, rules, geometry, catalog, types; hettich-engine (adapter); persistence mappers |
| `bom` | `…/engines/bom.ts` | **`BOM_ENGINE_VERSION`** (new) | bom-engine + everything `validation` reaches |
| `boq` | `…/engines/boq.ts` | **`BOQ_ENGINE_VERSION`** (new) | boq-engine + the same |
| `pricing` | `…/engines/pricing.ts` | `PRICING_ENGINE_VERSION` | pricing-engine (`priceRoom`, new) + the same |
| `quotation` | `…/engines/quotation.ts` | **`QUOTATION_ENGINE_VERSION`** (new) | pricing-engine quotation module (`quoteRoom`, new) + the same |
| `drawing` | `…/engines/drawing.ts` | `DRAWING_ENGINE_VERSION` | drawing-engine + the same |
| `manufacturing` | future | future | future |

### 6.2 Algorithm

**Build-time manifest.** `pnpm engines:manifest` is run by the build and CI; in development and tests the same function runs at startup. For each output engine it does the following.

**Step 1: find the closure.** Take the static import graph from the engine's entry module. It is resolved with the repository's own TypeScript resolution through the bundler's module graph (rolldown/esbuild metafile). Nothing is executed.

**Step 2: internal source files.** Take every **internal source file** reached: files under `packages/*/src` and the entry module's own `apps/api/src` imports. For each package, compute:

```
packageSourceHash(pkg) = SHA-256( canonical [ (relativePath, SHA-256(fileBytes)) for every reached file of pkg, sorted by path ]
                                  + SHA-256(pkg/package.json normalized: name, version, dependencies, exports) )
```

- Only files that are **reached** count: `src` code actually imported.
- Tests, READMEs, docs, UI packages, and unreached modules of the same package are excluded **by construction**.

**Step 3: external dependencies.** Take every **external package** reached (resolved into `node_modules`) and record `name@version` plus its `integrity` from `pnpm-lock.yaml`, transitively for everything reached. Today this list is empty (F11); it is still computed and hashed.

**Step 4: the fingerprint.**

```
engine_fingerprint = "sha256:" + SHA-256( canonicalJSON({
    engine:   name,                         // e.g. "bom"
    version:  semanticVersion,              // e.g. BOM_ENGINE_VERSION
    packages: { "@lintel/bom-engine": packageSourceHash, "@lintel/design-engine": …, "@lintel/persistence": …, … },
    entry:    SHA-256(entry module bytes),
    externals:{ "<name>": "<version>+<integrity>", … },
    runtime:  "node-<major>"                // semantics-relevant runtime; major only
}))
```

**Guarantees:**

- Same engine code, same dependency closure and same externals give the **same fingerprint** on any commit, machine or checkout.
- Any change to a reached file, a reached package's manifest, a locked external version or the semantic version gives a **different fingerprint**. No manual bump is needed.
- A change to docs, UI, tests, or an unreached file (for example an unrelated API module) **does not** change it. That is the brief's requirement.
- **The whole repository is never hashed.**

**Human-readable build is separate.** `engine_build` = the commit SHA / build revision (Step 5: `BUILD_REVISION` → `GITHUB_SHA` → Git checkout, with a `+dirty` marker). It is recorded **alongside** the fingerprint and is **not** an input to it.

- **Why the commit is not hashed in.** Hashing the commit would make every commit a new fingerprint, which contradicts "same engine code, same fingerprint".
- **How the build is still covered.** The fingerprint covers the build's engine content exactly, through the source hashes. The commit answers "which build ran", and the fingerprint answers "which exact engine code ran".
- **Dirty checkouts.** The file hashes are computed from the working tree, not from Git, so an uncommitted change also changes the fingerprint.

**Deployment.**

- Production artifacts carry the generated `engine-manifest.json`. The API loads it at startup and refuses to start if it is missing or does not match its schema.
- In development and tests the manifest is computed on startup. A CI test asserts that the computed manifest matches the one the build produced.

### 6.3 Recorded on every snapshot and every validation run

| Column | Value |
|---|---|
| `engine_name` | §6.1 name. The `output_engine` registry and a CHECK tie each snapshot kind to its engine. Validation runs use `validation`. |
| `engine_version` | semantic version |
| `engine_build` | commit SHA / build revision (human-readable) |
| `engine_fingerprint` | the §6.2 fingerprint (`sha256:` + 64 hex) |
| `engine_closure` | jsonb: `{ packages: { name → packageSourceHash }, externals: { … }, runtime }`. Shows *what* the fingerprint covers. |
| `engine_seal` | the engine's own `hash53` payload seal where one exists (drawing, pricing, quotation); NULL otherwise. Parity only; never authoritative. |

- **Validation runs.** The existing `engine_hash` on `validation_run` is replaced by `engine_fingerprint` and `engine_closure`, together with `engine_name` and `purpose`. Only development rows exist.
- **Platform build.** A separate platform/orchestrator build id is not added now. It could be added later without replacing any engine field.

---

## 7. Server-orchestrated dependency resolution

### 7.1 Compatibility (exact; never "latest")

An existing upstream snapshot `U` of kind `K` is compatible with a request for design version `DV`, purpose `P` and commercial versions `C` exactly when:

1. `U.design_version_id = DV.id`, in the same organization (RLS applies).
2. `U.input_hash = DV.input_hash` and `U.input_revision = DV.input_revision`.
3. `U.dependency_hashes` equal the current dependency hashes of the same exact versions.
4. `U.engine_fingerprint = currentFingerprint(K)`.
5. For Pricing, `U.pricing_standard_version_id = C.pricingStandardVersionId`.
6. `U`'s own sources are compatible (recursively).
7. `U.purpose = P`.
8. `verifySnapshotRecord(U)` holds.
9. For FOR_PRODUCTION, `U.blocker_count = 0` and, for a BOM, `U.output_complete`.

Conditions 1–7 are `K`'s **natural identity** (§9), so at most one `U` matches. The lookup is by unique key and never sorts.

### 7.2 Generation: one `OutputExecutionContext` in one REPEATABLE READ transaction

#### 7.2.1 The context

The context is built once per request and deep-frozen. It is the only input to the validation record and to every engine call in the request.

```ts
interface OutputExecutionContext {
  readonly orgId: string;
  readonly actor: string;                              // user id; permissions checked before and by RLS
  readonly createdAt: string;                          // transaction timestamp (UTC ISO), passed to engines that need it
  readonly designVersion: { id; status; contentHash; inputHash; inputRevision };   // exact row as read under FOR SHARE
  readonly engineering: {                              // exact engineering inputs
    readonly roomRevision; readonly objects; readonly overrides;                  // rows as read
    readonly pins: EngineeringPins;                    // the 9 exact version ids
    readonly dependencyHashes: Record<EngineeringPin, Sha256>;  readonly dependencySetHash: Sha256;
    readonly engineInputs: ResolveRoomInput;           // mapped once by @lintel/persistence (standards, catalog, Hettich adapter, …)
  };
  readonly commercial: null | {                        // Pricing / Quotation requests only
    readonly pricingStandard: { versionId; status; dependencyHash; data: { rateCard; rules } };
    readonly quotationPolicy?: { versionId; status; dependencyHash; data: QuotationPolicy };
    readonly commercialInputHash: Sha256;
  };
  readonly resolved: ResolvedRoom;                     // resolveRoom(engineering.engineInputs), computed exactly once
  readonly engines: Record<EngineName, EngineIdentity>;// name, version, build, fingerprint, closure: from the loaded manifest
}
```

**Building it** (`buildOutputExecutionContext`):

1. Lock the design version row `FOR SHARE`.
2. Read the exact rows: the room revision, objects, overrides, and the 9 pinned versions with their child rows. For Pricing and Quotation, also read the chosen commercial versions with their child rows, after checking they belong to the organization (`422 COMMERCIAL_VERSION_NOT_FOUND` otherwise).
3. Map the rows with `@lintel/persistence`.
4. Recompute the engineering `input_hash` from the loaded rows. It must equal `DV.input_hash`, or the request fails with `409 VALIDATION_INPUT_MISMATCH`, as validation does today.
5. Compute the dependency and commercial hashes.
6. Call `resolveRoom` **once**.
7. Take the engine identities from the manifest loaded at startup.
8. Freeze the result.

**Rules:**

- **Nothing re-reads or re-resolves after the context is built.** Every consumer receives the context object:
  - the validation record;
  - the BOM, BOQ, pricing, quotation and drawing engines;
  - cabinet drawings, which use `context.resolved.cabinets`.
- **The context itself is never stored.** What it contained is recorded on the run and the snapshots: hashes, pins, commercial versions and engine identities.

#### 7.2.2 The flow

```
generate(D, DV, P, C):
  BEGIN REPEATABLE READ
  ctx := buildOutputExecutionContext(DV, C)                          -- exact inputs → one resolution (§7.2.1)
  purposeAllowed(D, P, ctx.designVersion.status)                     -- §11 matrix, including SUPERSEDED
  run := findOrRecord OUTPUT_GENERATION run from ctx.resolved.validation + ctx.engines.validation
  if P = FOR_PRODUCTION and run.blockerCount > 0 → ROLLBACK; 409 VALIDATION_BLOCKERS
  for each upstream kind K of D (BOM → BOQ → Pricing), in order:
      U := natural-identity lookup(K, ctx, P, sources)                -- exact identity, never "latest"
      if none: U := produce(K, ctx, run, inputs from earlier U's)     -- same ctx, same run; caller needs K's permission (§14)
      else:    input_K := deserialize(U.payload) via the Zod payload schema; verify U.content_hash
  result := D's engine(ctx.resolved, inputs from upstream U's, ctx.commercial)
  UNAVAILABLE → if upstream snapshots were created in this request: COMMIT them with the run that they reference
                (valid engineering outputs of the same ctx); otherwise ROLLBACK (nothing new is persisted);
                200 { status: "UNAVAILABLE", blockers, dependencies } -- D itself is never persisted (OD-S6-5)
  if D's natural identity exists → COMMIT; 200 { reused: true }
  insert D (validation_run_id = run.id, sources, provenance from ctx) → COMMIT; 201
  any error (engine refusal, trigger, permission, conflict) → ROLLBACK: no run, no snapshot
```

**Atomicity:**

- The run, the upstream snapshots created in the request and the requested snapshot commit together, or none of them does.
- An UNAVAILABLE result commits only what is valid on its own: upstream engineering snapshots created in the request, together with the run they reference, all from the same context. If none was created, nothing is committed. It never commits a Pricing or Quotation snapshot, and never a run without a referencing snapshot.
- A reused upstream snapshot was produced by an earlier request from its own context. Its compatibility is established by natural identity: the same inputs, dependency hashes and engine fingerprint. It is never re-derived.

- **Upstream output engines are never re-run to verify a snapshot.** The stored payload is used after its content hash is verified.
- **The engines assert the fingerprint links themselves:** `generateRoomBoq` requires the BOM's `roomFingerprint` to equal the room's, and `priceRoom` and `quoteRoom` check their traces. A mismatch means an incompatible source and returns `409 SOURCE_SNAPSHOT_INCOMPATIBLE`.

### 7.3 Explicit reproduction

A request may name `sources` (exact snapshot ids).

**What the server checks:**

- same design version and organization;
- the content hash verifies;
- conditions 2, 3 and 5 of §7.1 hold, so the engineering and commercial inputs are the current exact ones;
- the source purpose is equal or stronger.

**What the server allows:** the source's `engine_fingerprint` may differ from the current one. That is how an earlier output is reproduced after the engine has changed. The new snapshot reports `SOURCE_STALE` (§10).

---

## 8. Output snapshot provenance schema

### 8.1 Columns common to every snapshot table

| Column | Type / rule | Source |
|---|---|---|
| `id`, `org_id` | uuid PK; `UNIQUE (org_id, id)` | server / context |
| `kind` | `snapshot_kind`, CHECK = the table's kind | fixed |
| `purpose` | PRELIMINARY / FOR_REVIEW / FOR_PRODUCTION; FK `(kind, purpose)` → `output_purpose_rule` | request |
| `design_version_id`, `design_version_status`, `design_version_content_hash` | composite FK; values trigger-checked against the design version | design version |
| `input_hash`, `input_revision` | engineering input hash and revision; trigger-checked equal to the design version | design version |
| 9 engineering pin columns | NOT NULL (appliance nullable); trigger-checked equal to the design version's pins | design version |
| `pricing_standard_version_id`, `quotation_policy_version_id` | per §4.2 (NULL for engineering kinds); composite FKs | request (commercial) |
| `manufacturing_standard_version_id` | NULL until manufacturing exists (future: chosen at generation) | — |
| `dependency_hashes` | jsonb; keys = exactly the consumed pins (9 engineering, plus commercial per kind); CHECK on the key set | server |
| `dependency_set_hash` | sha256 of the canonical `dependency_hashes` | server |
| `commercial_input_hash` | sha256; NOT NULL for Pricing and Quotation, NULL otherwise | §4.2 |
| `validation_run_id` | uuid NOT NULL; composite FK → `validation_run`; trigger rules of §5.2 | server |
| `engine_name`, `engine_version`, `engine_build`, `engine_fingerprint`, `engine_closure`, `engine_seal` | §6.3 | engine manifest |
| `blocker_count`, `warning_count` | integer ≥ 0; from the engine result, including the run's BLOCKERs | engine |
| `output_complete` | boolean (BOM: `!incomplete`; others: true) | engine |
| `payload` | jsonb, the engine result verbatim; no TEST_FIXTURE marker (CHECK) | engine |
| `content_hash` | SHA-256 of the payload (`@lintel/persistence`) | server |
| `data_classification` | `'PRODUCTION'` (CHECK) | fixed |
| `created_by`, `created_at` | current user (RLS); `now()` | database |

**Removed or replaced:**

- `engine_hash` on snapshots becomes `engine_seal`.
- The DV-equality rule for commercial and manufacturing pins is replaced by §4.2.

### 8.2 Kind-specific columns

| Table | Columns |
|---|---|
| `boq_snapshot` | `bom_snapshot_id` NOT NULL (composite FK) |
| `pricing_snapshot` | `bom_snapshot_id`, `boq_snapshot_id` NOT NULL |
| `quotation_snapshot` | `boq_snapshot_id`, `pricing_snapshot_id` NOT NULL; `revision_number` (UNIQUE per design version) |
| `drawing_snapshot` | `drawing_type` (CHECK: 6 types; no default), `drawing_scope` (ROOM / OBJECT), `wall_id` (A–D), `object_id` (composite FK → design_object of the same version), `cut_x_mm`, `drawing_number`, `drawing_revision`, `file_manifest_hash`; scope CHECKs |
| `manufacturing_document_snapshot` | unchanged until manufacturing is revisited |

**The edge trigger** checks, for every source:

- the same organization, `design_version_id`, `input_hash`, `input_revision` and engineering `dependency_hashes`;
- for Quotation, `pricing_snapshot.pricing_standard_version_id = quotation_snapshot.pricing_standard_version_id`;
- a source purpose at least as strong as the snapshot's.

### 8.3 Validation-run columns (after Correction 2)

| Column | Rule |
|---|---|
| existing | `id`, `seq`, `org_id`, `design_version_id`, `input_hash`, `input_revision`, `content_hash`, `blocker_count`, `warning_count`, `messages`, `created_by`, `created_at` |
| new | `purpose` (APPROVAL / OUTPUT_GENERATION), `dependency_set_hash` (engineering pins), `engine_name` = `validation`, `engine_fingerprint`, `engine_closure` |
| kept | `engine_version`, `engine_build` (0016) |
| replaced | `engine_hash` → `engine_fingerprint` |

---

## 9. Snapshot uniqueness and idempotency

### 9.1 Natural identity (UNIQUE, `NULLS NOT DISTINCT`, PostgreSQL 17)

The key is never just `design_version_id + kind`. Repeated immutable snapshots are legitimate:

- for another purpose;
- for another engineering revision;
- for other commercial versions;
- from another engine;
- with other sources.

| Kind | Natural identity |
|---|---|
| Engineering base (BOM) | `(org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_fingerprint)` |
| BOQ | base + `bom_snapshot_id` |
| Pricing | base + `commercial_input_hash` + `bom_snapshot_id` + `boq_snapshot_id` |
| Quotation | base + `commercial_input_hash` + `boq_snapshot_id` + `pricing_snapshot_id` |
| Drawing | base + `drawing_type`, `drawing_scope`, `wall_id`, `object_id`, `cut_x_mm`, `drawing_number`, `drawing_revision` |
| OUTPUT_GENERATION run | `(org_id, design_version_id, input_hash, input_revision, dependency_set_hash, engine_fingerprint)` (partial unique index) |
| APPROVAL run | not unique (unchanged) |

**Notes on the key:**

- `dependency_set_hash` covers the commercial versions too, so the identity changes whenever a pinned or chosen version's content changes.
- **`created_at`** is not in the key, and neither is the payload's `createdAt`. A repeat request **reuses** the existing snapshot (`200`, `reused: true`).
- **Quotation `revision_number`** is assigned only when a new identity is inserted: the next number per design version, `UNIQUE (design_version_id, revision_number)`.

### 9.2 Idempotency layers

| Layer | Behaviour |
|---|---|
| `Idempotency-Key` (existing scopes) | The same key and body replay the original response, by resource rehydration because snapshots exceed the 60 KB cap. The same key with a different body gives `409` (LD022). |
| Natural identity | Different keys, same inputs: the existing snapshot is returned. Two concurrent inserts: the loser catches 23505 on the identity index and returns the winner. |
| Insert-only | A snapshot or validation run is never overwritten (LD015). |

---

## 10. Staleness algorithm (calculated, never stored)

```
isCurrent(S) → { stale, reasons[], advisories }
  DV := design_version of S (same org);  reasons := []
  -- engineering (every kind)
  if S.input_hash ≠ DV.input_hash or S.input_revision ≠ DV.input_revision   → ENGINEERING_INPUTS_CHANGED
  for pin in the 9 engineering pins:
      if S[pin] ≠ DV[pin]                                                     → ENGINEERING_INPUTS_CHANGED
      else if dependencyHash(DV[pin]) ≠ S.dependency_hashes[pin]              → DEPENDENCY_CONTENT_CHANGED
  -- commercial (Pricing, Quotation): the snapshot's OWN exact versions; there is no "current" commercial pin
  for v in {S.pricing_standard_version_id, S.quotation_policy_version_id} \ {null}:
      if dependencyHash(v) ≠ S.dependency_hashes[v's pin]                      → COMMERCIAL_CONTENT_CHANGED   (DRAFT only)
  -- engine
  if S.engine_fingerprint ≠ currentFingerprint(S.engine_name)                  → ENGINE_CHANGED
  -- sources (transitive, memoised)
  for U in sources(S): if isCurrent(U).stale                                   → SOURCE_STALE
  advisories (never staleness):
      designSuperseded        := DV.status = SUPERSEDED           -- historically valid
      newerSurveyAvailable    := a later survey revision of the room exists and is not pinned
      newerDependencyVersions := pinned engineering entities with a later APPROVED version
      newerCommercialVersions := the snapshot's PricingStandard/QuotationPolicy entities with a later APPROVED version
  return { stale: reasons ≠ ∅, reasons (deduplicated), advisories }
```

**What never makes an output stale:**

- **A new PricingStandard or QuotationPolicy version.** Commercial versions are chosen per output. A new one is a new output, not a stale old one; it appears only as a `newerCommercialVersions` advisory on Pricing and Quotation.
- **Anything commercial, for BOM, BOQ, drawings or validation.** They have no commercial inputs.
- **A newer approved catalog or standard version the design does not pin.**
- **A newer survey that is not adopted.**
- **A SUPERSEDED or LOCKED design.**
- **An issue.** An issued output is never altered. If it becomes stale through ENGINE_CHANGED, it is flagged for possible re-issue.

**The validation-run link** is not a separate staleness reason. The run's engineering hash, revision and dependency hashes are equal to the snapshot's by trigger, so it is current exactly when they are.

**Cost:**

| Where | How |
|---|---|
| Read and list endpoints | computed from the stored hashes. `dependencyHash` is re-read only for DRAFT versions, because APPROVED and LOCKED content is frozen. |
| `GET /{kind}-snapshots/{id}/staleness` | also runs the engine comparators: `compareRoomTrace`, `checkQuotationStaleness`, `checkRoomDrawingStaleness`, `checkDrawingStaleness`. It reports `changedObjectIds`. |

---

## 11. Purpose and lifecycle rules (commercial gates moved; SUPERSEDED clarified)

### 11.1 Design status × purpose

| Design status | PRELIMINARY | FOR_REVIEW | FOR_PRODUCTION | Quotation / drawing issue | Manufacturing release (future) |
|---|---|---|---|---|---|
| DRAFT | ✓ | ✗ | ✗ | ✗ | ✗ |
| IN_REVIEW | ✓ | ✓ | ✗ | ✗ | ✗ |
| APPROVED | ✓ | ✓ | ✓ (production guards) | ✗ until LOCKED (issue LOCKs it, Step 4 §8) | ✗ until LOCKED |
| LOCKED | ✓ | ✓ | ✓ (production guards) | ✓ (`check_issue`) | ✓ (future guards, §12.6) |
| **SUPERSEDED** | **✓ (reproduction / review)** | **✓ (reproduction / review)** | **✗** | **✗** | **✗** |

- **OUTPUT_GENERATION runs may be recorded for a SUPERSEDED design,** but only as part of a PRELIMINARY or FOR_REVIEW generation. The purpose check (§7.2.2) runs before anything is recorded.
- **A FOR_PRODUCTION request on a SUPERSEDED design** is refused with `PRODUCTION_GUARD_FAILED` (LD021). Nothing is persisted, including the run.
- **Issuing a snapshot of a SUPERSEDED design is refused by `check_issue`** (`ISSUE_PRECONDITIONS_FAILED`, LD017). `check_issue` requires the design's **current** status to be LOCKED, which also covers a FOR_PRODUCTION snapshot generated before the design was superseded.
- **Issues already made while the design was LOCKED stay valid.** They are historical records; supersession never alters them.
- **Manufacturing release** requires LOCKED (future), so SUPERSEDED is refused.
- **Snapshots of a SUPERSEDED design** keep the `designSuperseded` advisory (§10); they are historically valid, not stale.

**Registry change needed (0017):**

- The approved rule table today (0012) allows FOR_REVIEW only for `{IN_REVIEW, APPROVED, LOCKED}`, and the CHECK `output_purpose_rule_review_states` enforces that subset.
- To allow FOR_REVIEW for SUPERSEDED designs, 0017 extends the six FOR_REVIEW rows to `{IN_REVIEW, APPROVED, LOCKED, SUPERSEDED}` and widens that CHECK to the same set.
- `@lintel/persistence` `OUTPUT_PURPOSE_RULES` changes with it, and the existing parity test keeps them identical.
- PRELIMINARY already includes SUPERSEDED. FOR_PRODUCTION stays `{APPROVED, LOCKED}` under the CHECK `output_purpose_rule_production_guard`.

### 11.2 Gates per purpose

| Purpose | OUTPUT_GENERATION run | Output BLOCKERs | Commercial versions | Sources |
|---|---|---|---|---|
| PRELIMINARY | recorded; BLOCKERs allowed | allowed (shown and watermarked) | any status (the engine gates) | any purpose |
| FOR_REVIEW | recorded; BLOCKERs allowed | allowed | any status (the engine gates) | FOR_REVIEW or FOR_PRODUCTION |
| FOR_PRODUCTION | **0 BLOCKERs** | **0**; a BOM must be complete | **APPROVED or LOCKED** | FOR_PRODUCTION |

**Further rules:**

- **Issue (quotation, drawing):** `check_issue`, plus locking of the design and, for quotations, of the exact commercial versions (§4.4).
- **Manufacturing release:** deferred (§12.6).
- **Purpose is never upgraded.** A different purpose is always a new snapshot.
- **The rule registry stays the single source of truth:** `output_purpose_rule` and `outputPurposeProblems`.

---

## 12. Per-output contracts

### 12.1 BOM

- **Engine:** `bom`: `generateRoomBom(resolved)` → `RoomBOM`.
- **Lines:** PANEL (finished size), BOARD m², EDGE_BAND m, FINISH m² × faces, HARDWARE (resolved articles, or `UNRESOLVED` with quantity 0).
- **No wastage and no prices.**
- **Stored:** `output_complete = !incomplete`.

### 12.2 BOQ

- **Engine:** `boq`: `generateRoomBoq(resolved, catalog, roomBom from the BOM snapshot)` → `RoomBOQ`. One product line per object.
- **How it differs from the BOM:**
  - The BOM is physical and engineering.
  - The BOQ is the commercial product quantity.
  - They are linked, never merged.
- **No engineering logic is duplicated,** and the BOM is never recounted.

### 12.3 Pricing

- **Engine:** `pricing`: **`priceRoom`** (new, pure).
  - Input: `{ mode: "PRODUCTION", room: resolved, roomBom, roomBoq (from snapshots), rateCard, rules (from the chosen PricingStandard version), createdAt }`.
  - It applies the existing `priceCabinet` gates and arithmetic per cabinet, plus any room totals.
  - It returns `PRICED` or `UNAVAILABLE`.
- **The API sums nothing.**
- **No invented rates.** NULL rates give `PRICING_RATE_UNVERIFIED` and missing rates give `PRICING_RATE_MISSING`. Nothing is priced at zero.
- **UNAVAILABLE is not persisted.**

### 12.4 Quotation

- **Engine:** `quotation`: **`quoteRoom`** (new, pure).
  - Input: `{ mode: "PRODUCTION", room: resolved, roomBoq, pricing (the Pricing snapshot payload), policy (the chosen QuotationPolicy version), catalog, revision, createdAt }`.
  - It reuses the existing policy gate, tax mapping, tax policy, rounding and totals.
  - **It does not re-price.**
- **Keeping existing behaviour:** `priceQuotation` becomes `priceRoom` + `quoteRoom`, with golden output unchanged.
- **The service only assigns `revision_number` and `createdAt`.**
- **Not modelled, not invented:** quote validity or expiry, and discounts other than NONE.

### 12.5 Drawings: existing engine → endpoint map

All six types use one endpoint, `POST /design-versions/{id}/drawing-snapshots`, with a discriminated `drawingType`.

| Existing engine function | Scope | API `drawingType` | Parameters | Staleness detail | Verify |
|---|---|---|---|---|---|
| `createWallInternalElevation` | room | `WALL_INTERNAL_ELEVATION` | `wallId` | `checkRoomDrawingStaleness` | `verifyRoomDrawing` |
| `createRoomPanelSchedule` | room | `ROOM_PANEL_SCHEDULE` | — | `checkRoomDrawingStaleness` | `verifyRoomDrawing` |
| `createFrontElevation` | cabinet | `FRONT_ELEVATION` | `objectId` | `checkDrawingStaleness` | `verifyDrawing` |
| `createSideSection` | cabinet | `SIDE_SECTION` | `objectId`, `cutXMm?` | `checkDrawingStaleness` | `verifyDrawing` |
| `createCabinetInternalElevation` | cabinet | `CABINET_INTERNAL_ELEVATION` | `objectId` | `checkDrawingStaleness` | `verifyDrawing` |
| `createPanelSchedule` | cabinet | `PANEL_SCHEDULE` | `objectId` | `checkDrawingStaleness` | `verifyDrawing` |
| `renderSvg(d, i)` / `renderPdf([d])` | both | files: SVG per sheet, one PDF | — | — | SHA-256 per file |

**Rules:**

- **Cabinet drawings** use `resolved.cabinets` by `objectId`, so both scopes share one resolution.
- **Purpose becomes the engine's `requestedStatus`.**
- **`REFUSED`** returns `422 DRAWING_REFUSED` with the engine blockers. Nothing is persisted.
- **Title-block metadata comes from records:**

  | Field | Source |
  |---|---|
  | project code | `project.project_code` |
  | room | `room.name` |
  | designer | DV `created_by` |
  | checker | DV `approved_by`, or `-` |
  | date | generation date (UTC) |
  | number and revision | the request |

### 12.6 Manufacturing Document: future boundary; no endpoint

**Future boundary:**

- **Engine:** `manufacturing`, in `@lintel/manufacturing-engine`, with its own entry module and fingerprint (§6).
- **Inputs:** the engineering inputs (resolved room), an **exact ManufacturingStandard version chosen at generation** (§3.3), and probably the BOM snapshot.
- **Snapshot:** the common schema (§8) with its own file table (§13); `engine_name = 'manufacturing'`.
- **Permissions:** generation requires `output.generate.engineering` (the INSERT policy is corrected then, F6); release requires `manufacturing.release`.
- **Purposes:** PRELIMINARY and FOR_REVIEW once the engine exists. FOR_PRODUCTION and release need all of:
  - an APPROVED or LOCKED ManufacturingStandard;
  - a LOCKED design;
  - an OUTPUT_GENERATION run with 0 BLOCKERs;
  - 0 output BLOCKERs;
  - every production guard.

**Current production blockers:**

1. There is no manufacturing engine: no cut sizes, cut list, drilling, labels or CNC (PRD Phase 7).
2. There is no ManufacturingStandard type, and the variable registry is empty, so no version can be approved.
3. Every manufacturing value is NULL / UNVERIFIED: kerf, trim, cut versus finished size, groove, hole pitch, joinery, CNC post-processor, labels, wastage.
4. The construction standard's cut-size allowances are NULL / UNVERIFIED.

---

## 13. Drawing file model (unchanged from revision 2)

- **Format registry:** `output_file_format(code, content_type, extension, sort_order, sheet_scoped, kinds[])`. It is seeded with PDF (document-scoped) and SVG (sheet-scoped). **DXF and later formats are registry rows only.**
- **`drawing_snapshot_file`:**
  - Columns: `org_id`, `snapshot_id`, `sequence` ≥ 1, `format` (FK to the registry), `sheet_index` (NOT NULL iff sheet-scoped), `file_object_id`.
  - **PK `(snapshot_id, sequence)`**; UNIQUE `(snapshot_id, format, sheet_index) NULLS NOT DISTINCT`.
  - `sequence` is assigned deterministically by `(sort_order, sheet_index)`.
- **Manifest seal:** `drawing_snapshot.file_manifest_hash` = SHA-256 of the ordered `[{sequence, format, sheetIndex, checksum, byteSize, contentType}]`. A DEFERRABLE INITIALLY DEFERRED trigger requires the linked files to match exactly at commit.
- **Storage:** `FileService`, content-addressed org and project keys, insert-only `file_object` with a SHA-256 checksum. Memory and local providers only; no hosted bucket.
- **Encoding:** the PDF is stored as `latin1` bytes, SVG as UTF-8.
- **Manufacturing** later uses the identical shape.

---

## 14. Output permission matrix

| Output | Generate | Read | Issue / release |
|---|---|---|---|
| Validation run, APPROVAL | `design_version.author` or `output.generate.engineering` | project scope | — |
| Validation run, OUTPUT_GENERATION | (server) the output's generate action | project scope | — |
| BOM, BOQ | `output.generate.engineering` | `output.read.production` | — |
| Drawing | `output.generate.engineering` | `output.read.production`; issued: `output.read.issued` | `drawing.issue` |
| Pricing | `output.generate.commercial` | `output.read.cost` | — |
| Quotation | `output.generate.commercial` | `output.read.cost`; issued: `output.read.issued` | `quotation.issue` (also LOCKs the commercial versions used, §4.4) |
| Manufacturing (future) | `output.generate.engineering` | `output.read.production` | `manufacturing.release` |
| Files | the generating action | `file_read` / `client_can_read_file` | — |

**Orchestration never escalates.**

- Upstream generation runs as the caller, with the caller's own permissions.
- A Pricing or Quotation caller must hold `output.generate.engineering` to create missing BOM or BOQ snapshots, or `output.read.production` to use existing ones.
- COSTING holds both today. Anyone else gets `403 PERMISSION_DENIED` naming the missing upstream action.
- There is no SECURITY DEFINER generation path.

**Commercial reference reads** for the chosen versions use `reference.read`, as today.

---

## 15. Endpoint list (`/api/v1`)

**Generation** (server-orchestrated; `Idempotency-Key` on every POST):

| Method & path | Action | Body | Responses |
|---|---|---|---|
| `POST /design-versions/{id}/bom-snapshots` | `output.generate.engineering` | `{ purpose, sources? }` | 201 · 200 reused |
| `POST /design-versions/{id}/boq-snapshots` | `output.generate.engineering` | `{ purpose, sources? }` | 201 · 200 reused |
| `POST /design-versions/{id}/pricing-snapshots` | `output.generate.commercial` (+ upstream, §14) | `{ purpose, pricingStandardVersionId, sources? }` | 201 · 200 reused · 200 UNAVAILABLE |
| `POST /design-versions/{id}/quotation-snapshots` | `output.generate.commercial` (+ upstream) | `{ purpose, pricingStandardVersionId, quotationPolicyVersionId, sources? }` | 201 · 200 reused · 200 UNAVAILABLE |
| `POST /design-versions/{id}/drawing-snapshots` | `output.generate.engineering` | `{ purpose, drawingType, … }` (§12.5) | 201 · 200 reused · 422 DRAWING_REFUSED |
| manufacturing-document generation | — | — | **not created (OD-S6-1)** |

**Reads:**

| Method & path | Action |
|---|---|
| `GET /design-versions/{id}/outputs` | graph of snapshots and OUTPUT_GENERATION runs (no payloads), with staleness and edges, filtered by the caller's read actions |
| `GET /design-versions/{id}/{bom,boq,drawing}-snapshots` · `GET /{bom,boq,drawing}-snapshots/{id}` | `output.read.production` |
| `GET /design-versions/{id}/{pricing,quotation}-snapshots` · `GET /{pricing,quotation}-snapshots/{id}` | `output.read.cost` |
| `GET /{kind}-snapshots/{id}/staleness` | as the read |
| `GET /design-versions/{id}/validation-runs?purpose=` · `GET /validation-runs/{id}` | project scope. Existing list, plus the `purpose` filter and field. |
| `GET /drawing-snapshots/{id}/files` · `GET /files/{id}/url` | `output.read.production` or issued; RLS; signed URL valid 300 s, never persisted |

**Issue:**

| Method & path | Action |
|---|---|
| `POST /quotation-snapshots/{id}/issue` `{ reason }` · `GET …/issue` | `quotation.issue` |
| `POST /drawing-snapshots/{id}/issue` `{ reason }` · `GET …/issue` | `drawing.issue` |

**Changed existing endpoints:**

| Endpoint | Change |
|---|---|
| `POST /designs/{id}/versions` · `PATCH /design-versions/{id}` | `pins` has **9** fields; the commercial and manufacturing pins are removed from the schema, and sending them gives 400 |
| `POST /design-versions/{id}/validation-runs` | creates **APPROVAL** runs only |

**Deferred:** manufacturing release (`POST` / `GET …/manufacturing-release`), together with manufacturing documents.

**New problem codes:**

| Code | Status |
|---|---|
| `SOURCE_SNAPSHOT_INCOMPATIBLE` | 409 |
| `SOURCE_PURPOSE_INSUFFICIENT` | 409 |
| `COMMERCIAL_VERSION_NOT_FOUND` | 422 (unknown or foreign commercial version) |
| `DRAWING_REFUSED` | 422 |

The database-originated ones get LD025 onward.

---

## 16. Request and response schemas (Zod, strict)

```ts
const Purpose = z.enum(["PRELIMINARY", "FOR_REVIEW", "FOR_PRODUCTION"]);
const Base = z.strictObject({ purpose: Purpose.default("PRELIMINARY") });
BomGenerateRequest       = Base.extend({ sources: z.strictObject({}).optional() });
BoqGenerateRequest       = Base.extend({ sources: z.strictObject({ bomSnapshotId: Uuid.optional() }).optional() });
PricingGenerateRequest   = Base.extend({ pricingStandardVersionId: Uuid,
                             sources: z.strictObject({ bomSnapshotId: Uuid.optional(), boqSnapshotId: Uuid.optional() }).optional() });
QuotationGenerateRequest = Base.extend({ pricingStandardVersionId: Uuid, quotationPolicyVersionId: Uuid,
                             sources: z.strictObject({ boqSnapshotId: Uuid.optional(), pricingSnapshotId: Uuid.optional() }).optional() });
DrawingGenerateRequest   = z.discriminatedUnion("drawingType", [ /* 6 variants, §12.5; + drawingNumber, drawingRevision */ ]);
IssueRequest             = z.strictObject({ reason: Reason });
```

**A request can never carry:**

- quantities, prices, rates, tax or totals;
- hashes, engine fields, blocker counts or `createdAt`;
- designer or checker;
- anything that means "latest".

```ts
Engine = { name, version, build, fingerprint, closure: { packages: Record<string, Sha256>, externals: Record<string, string>, runtime }, seal: string | null };
SnapshotEnvelope = {
  id, kind, purpose, designVersionId, designVersionStatus, designVersionContentHash,
  input: { hash, revision },                                   // engineering
  engineeringPins: EngineeringPins,                            // 9
  commercial: { pricingStandardVersionId, quotationPolicyVersionId?, inputHash } | null,
  dependencyHashes, dependencySetHash,
  validationRun: { id, purpose: "OUTPUT_GENERATION", blockerCount, warningCount, engine: Engine },
  sources: { bomSnapshotId?, boqSnapshotId?, pricingSnapshotId? },
  engine: Engine,
  contentHash, blockerCount, warningCount, outputComplete, dataClassification: "PRODUCTION",
  qualifiesForIssue, qualifiesForRelease, issue?: { issuedBy, issuedAt, reason },
  staleness: { stale, reasons: ("ENGINEERING_INPUTS_CHANGED" | "DEPENDENCY_CONTENT_CHANGED" | "COMMERCIAL_CONTENT_CHANGED"
                                | "ENGINE_CHANGED" | "SOURCE_STALE")[],
               advisories: { designSuperseded, newerSurveyAvailable, newerDependencyVersions[], newerCommercialVersions[] } },
  createdBy, createdAt,
};
GenerateResponse<T> = { snapshot: T, reused: boolean, dependencies: SnapshotSummary[] };
Unavailable         = { status: "UNAVAILABLE", blockers: ValidationMessage[], snapshot: null, dependencies: SnapshotSummary[] };
Bom / Boq / Pricing / Quotation (+ revisionNumber) / Drawing (+ type, scope, wallId, objectId, cutXMm, number, revision,
  fileManifestHash, files[{ sequence, format, sheetIndex, fileId, contentType, byteSize, checksum }]) = SnapshotEnvelope & { payload };
ValidationRunResponse (existing) + purpose, dependencySetHash, engine: Engine;
```

**Payload schemas mirror the engine types.** Each is a Zod mirror of its `@lintel/types` type, used for three things:

1. response validation;
2. deserializing upstream payloads;
3. OpenAPI.

A compile-time equality assertion against the engine type fails the typecheck on drift.

**Encoding:** money is integer paise and dimensions are millimetres, both exactly as the engine emits them.

---

## 17. OpenAPI approach (unchanged)

1. **Source of truth:** the Zod schemas.
2. **Route metadata:** registered through explicit decorators.
3. **Build:** `pnpm api:openapi` produces **OpenAPI 3.1** using `z.toJSONSchema()`, with RFC 9457 problems whose `type` URNs come from `PROBLEM_CODES`.
4. **Drift check:** the committed `apps/api/openapi/openapi.json` is checked by a CI drift test.
5. **Timing:** generated when Step 7 implements the output modules. Deferred endpoints are absent.

---

## 18. Prerequisite matrix

| Capability | Existing | Missing (before API generation) | Production blocker |
|---|---|---|---|
| **Validation** | APPROVAL runs (endpoint, `record_validation_run`, build); `resolveRoom`; SUBMIT and APPROVE checks | `purpose`; OUTPUT_GENERATION rules (any status, no design mutation, natural identity); `engine_name`, `engine_fingerprint`, `engine_closure`; engineering-only `input_hash` (Correction 1); engine manifest (§6) | unapproved production standards, catalogs and Hettich data. Today's data produces engine BLOCKERs, so no production design can be approved |
| **BOM** | `generateRoomBom`, types, golden tests | `BOM_ENGINE_VERSION`; entry module and fingerprint; provenance columns (§8); natural identity; payload schema; API | the engineering data above; unresolved hardware makes the BOM incomplete |
| **BOQ** | `generateRoomBoq` (asserts the BOM fingerprint) | `BOQ_ENGINE_VERSION`; BOM-snapshot deserialization; source edge; API | approved product BOQ templates (engineering approvals) |
| **Pricing** | `priceCabinet` (gates, BigInt money), `verifyPriceSnapshot` | **`priceRoom`**; commercial version chosen at generation; `commercial_input_hash`; commercial dependency hashes; UNAVAILABLE handling; API | production rate card and pricing rules are DRAFT with all values NULL → UNAVAILABLE |
| **Quotation** | `priceQuotation` (policy gate, tax, rounding), `verifyQuotation` | **`QUOTATION_ENGINE_VERSION`**; **`quoteRoom`** (consumes Pricing, no re-pricing); unique revision; issue locking the commercial versions; API | production QuotationPolicy is NULL and needs FINANCE approval; validity and expiry not modelled |
| **Drawings** | drawing engine (6 functions, SVG/PDF, verify, staleness), ADR-0007/0008, golden tests | file model (§13); type and scope columns; storage wiring; metadata mapping; issue | FOR_PRODUCTION needs an APPROVED or LOCKED design and 0 BLOCKERs, which current data cannot give |
| **Manufacturing** | snapshot table, purpose rules, permissions and scopes (reserved) | **engine; ManufacturingStandard type and variable model;** generation-time standard selection; INSERT policy; file formats | no engine, empty registry, every value NULL → deferred |
| **Design version (Correction 1)** | 12 pins; `input_hash` over all | remove the 3 commercial and manufacturing pins; narrow `input_hash`, `maintain_input_revision`, approval, `lock_cascade`, provenance, API schemas, tests | — |

---

## 19. Changes the next step must make (described; no SQL or code in Step 6)

**Engines** (pure; no calculation change):

- `BOM_ENGINE_VERSION`, `BOQ_ENGINE_VERSION` and `QUOTATION_ENGINE_VERSION` constants;
- `priceRoom` and `quoteRoom`, with `priceQuotation` as their composition and golden output unchanged.

**Tooling:**

- `pnpm engines:manifest`, the closure fingerprint of §6;
- tests proving that the same closure gives the same fingerprint, and that a changed reached file or locked external version changes it, while docs, tests or unreached files do not.

**`@lintel/persistence`:**

- `designInputHash` over the 9 engineering pins;
- `DesignVersionPins` with 9 pins;
- `dependencyHash()` per pinned type;
- `commercialInputHash()`;
- snapshot record and row with the §8 fields;
- the natural-identity builder;
- validation-run purpose;
- payload schemas.

**Migration 0017:**

- **Output purpose registry (Clarification B):** FOR_REVIEW rows extended to `{IN_REVIEW, APPROVED, LOCKED, SUPERSEDED}`; the CHECK `output_purpose_rule_review_states` widened to match; `OUTPUT_PURPOSE_RULES` updated in step with the parity test.
- **Design version:**
  - drop `pricing_standard_version_id`, `quotation_policy_version_id` and `manufacturing_standard_version_id` from `design_version`, with their FKs;
  - update `maintain_input_revision`, the approval pin check, `lock_cascade` and `check_snapshot_provenance`.
- **Validation runs:**
  - `validation_run.purpose`, `dependency_set_hash`, `engine_name`, `engine_fingerprint` (replacing `engine_hash`) and `engine_closure`;
  - the OUTPUT_GENERATION partial unique index;
  - `record_validation_run(p_purpose, …)` with the §5 rules, plus the deferred "new run is referenced" constraint trigger;
  - SUBMIT and APPROVE restricted to APPROVAL runs.
- **Snapshots:**
  - the §8 columns: engine, validation link, dependency hashes, `commercial_input_hash`, counts, `output_complete`;
  - `engine_hash` → `engine_seal`;
  - source columns and the edge trigger;
  - natural-identity indexes and the quotation revision index;
  - drawing columns.
- **Files:** the `output_file_format` and `output_engine` registries; `drawing_snapshot_file` redefined with the deferred manifest trigger.
- **Quotation issue:** the LOCK of the commercial versions used.
- **Errors:** LD025 onward.
- **Checks:** up, down and up again; drift; rollback equivalence.

**API:**

- the Step 5 design-version schemas move to 9 pins;
- the validation-run response gains `purpose` and `engine`.

**Not in 0017:** the manufacturing INSERT policy and manufacturing file formats; they wait for manufacturing.

---

## 20. Remaining unresolved risks

| # | Risk | Status |
|---|---|---|
| R1 (revised) | **Commercial versions are chosen per request.** There is no stored "commercial context" (for example a project's agreed price list), so a client must name exact versions each time. | Acceptable and exact. A persisted, versioned commercial context that resolves to exact ids is a later product decision; it would never introduce "latest". |
| R2 | **The fingerprint closure relies on a static import graph.** Dynamic imports, `require` by computed name, or data files read at runtime would escape it. | Engines have none today. The manifest tool fails the build if the bundler reports a dynamic import or an unresolved module in an engine closure. Engine data files (for example catalog-engine `data/`) are imported modules, so they are covered. |
| R3 | **Runtime semantics** are covered only by the Node **major** version. The TypeScript compiler version is not hashed. | Acceptable: engines are integer and BigInt heavy. Revisit if a floating-point difference is ever observed. |
| R4 | **`@lintel/persistence` mappers are in every closure,** so a mapper change stales all outputs. | Intended: mappers decide the engine inputs. Only reached mapper files count, not the whole package. |
| R5 | **Deserializing upstream payloads** relies on a lossless JSON round-trip. | Zod payload schemas, content-hash verification, and golden round-trip tests in Step 7. |
| R6 | **All production commercial data is NULL, and engineering data is unapproved.** | FOR_PRODUCTION is impossible until real data is approved. Successful paths are testable only with test-only synthetic data. Nothing is invented. |
| R7 | **Removing the 3 pins from `design_version` changes Step 5 contracts:** API pin schemas and approval completeness. | A deliberate breaking change before any client exists. Covered by updated database and API tests. Development data only. |
| R8 | **`dependencyHash` must cover every child table of each pinned or chosen type.** | A database test enumerates every table with an FK to a version table and asserts coverage. |
| R9 | **Engine seals are `hash53`.** | SHA-256 `content_hash` is authoritative; the seal is kept for parity only. |
| R10 | **BL-1 and BL-2 remain open:** the hardware rule-set version is visible only through the catalog, and the Hettich status is invisible to the engine. | The pins and dependency hashes still record both exactly. |
| R11 | **Response size and storage:** large drawing and quotation payloads; memory and local storage only; rollback orphans. | Lists never include payloads; replay uses rehydration; hosted buckets wait for the Mumbai gate. |
| R12 | **No manufacturing engine or ManufacturingStandard model.** | Deferred (OD-S6-1). |
| R13 | **`M5-TECHNICAL-DESIGN.md` §6 and `M5-STEP4-API-PLAN.md` §8.1 are out of date:** they assume design-version commercial and manufacturing pins and a non-existent uniqueness rule. | Updated together with 0017. |

---

## 21. Implementation sequence (only after this revision is approved)

1. Engine constants, `priceRoom`, `quoteRoom` and the engine manifest (fingerprint), with unit, golden and fingerprint-stability tests.
2. `@lintel/persistence`: 9-pin design hash, dependency and commercial hashes, snapshot record and natural identity, validation purpose, payload schemas.
3. Migration 0017 and full database tests. Update the Step 5 API and tests for 9 pins and APPROVAL runs.
4. API outputs module, in the order BOM → BOQ → drawings (files) → pricing → quotation → issue, then the outputs graph and staleness. API database tests for every rule: orchestration, reuse, staleness, purposes, cross-tenant, permissions.
5. OpenAPI generator and artifact with a drift check.
6. Manufacturing: nothing until the engine and ManufacturingStandard exist.

**Stop point.** No implementation starts before this revision is reviewed.
