# @lintel/persistence

A pure persistence adapter (M5 step 2). It has **no database client**: the repositories in the API (step 4) call these functions.

| Module | Responsibility |
|---|---|
| `envelope.ts` | Version identity envelope (entityId, versionId, versionNumber, status, source, created/submitted/approved/locked/superseded, effectiveFrom, contentHash) and its invariants. Also maps persisted statuses to engine statuses |
| `lifecycle.ts` | `DRAFT → IN_REVIEW → APPROVED → LOCKED → SUPERSEDED`. `REQUEST_CHANGES` returns a version to DRAFT (D2). Approver ≠ submitter with no override (D8), the reviewed content hash must match, content is editable only in DRAFT, and design-version approval preconditions are checked |
| `mappers/*` | Row ↔ engine conversion for standards (Construction, Planning, EdgeBand), PricingStandard, QuotationPolicy, catalog items, products, recipes, hardware rule sets, Hettich datasets, rooms, design versions (with pins), objects and overrides. NULL stays NULL |
| `fixture-guard.ts` | TEST_FIXTURE data can never become rows or snapshots |
| `catalog-assembly.ts` | Builds the engine `CatalogSnapshot` from the pinned per-domain releases |
| `provenance.ts` | Snapshot provenance (every standard, catalog release, Hettich dataset and engine version), SHA-256-sealed snapshot records |

Rules:

- Engines never import this package, and this package never imports a database client, NestJS or a cloud SDK (enforced by ESLint).
- Nothing here calculates geometry, BOM, BOQ, price or drawings.
