# Production Data Architecture

Status: **APPROVED with the M5 technical design (decisions D1–D10)**, revision 3 (2026-09-26). This document describes structure only.
Every production value remains `NULL / UNVERIFIED` until it is supplied with a source and approved
(see [production-data intake](../catalog/production-data/README.md)).

## Rule 1: engineering and business standards stay separate

There is **no generic `Standard` table, type or configuration object.** Each standard has its own type, its own
tables, its own value registry and its own approver.

| Standard | Holds | Current code | Intake doc | Approving roles (default grants, M5 §9) |
|---|---|---|---|---|
| **ConstructionStandard** | Numeric construction values: the original 11 variables plus SHUTTER_BACK_GAP (12). Shutter *reduction* and shutter *back gap* stay distinct concepts | `ConstructionStandard.variables` | 01 | DESIGN_HEAD, PRODUCTION |
| **PlanningStandard** | Room planning values: MIN_WALL_CLEARANCE, MIN_CABINET_GAP, MAX_GAP_WITHOUT_FILLER, FILLER_THRESHOLD, MAX_RUN_LENGTH, SERVICE_VOID_REAR | `PlanningStandard` (M4) | 08 | DESIGN_HEAD, PRODUCTION |
| **EdgeBandStandard** | Which edges of which component types are banded, and with which edge band item | **Gap:** today it lives inside `ConstructionStandard.edgeRuleSets`. M5 commit 0 splits it out with no behaviour change (D5) | 03 | DESIGN_HEAD, PRODUCTION |
| **ManufacturingStandard** | Cut-size allowances, machining, nesting and labelling rules | **Gap:** no type yet; intake doc only | 06 | DESIGN_HEAD, PRODUCTION |
| **PricingStandard** | Pricing rules (manufacturing-cost formula, wastage, overhead, margin basis and %) and the rate card | `PricingRuleSet` + `RateCard` | 07 | FINANCE (authored by COSTING, who can never approve) |
| **Finance / QuotationPolicy** | Tax rates, category → rate mapping, tax policy, rounding and discount policy (`NONE` only) | `QuotationPolicy` (M4) | 07 | FINANCE (authored by COSTING, who can never approve) |

## Rule 2: materials and hardware are catalog domains, not standards

There is no `MaterialStandard` and no `HardwareStandard`. These are catalogs of items. Each catalog item has:

- versioning;
- status;
- source;
- approval state;
- typed technical attributes;
- compatibility and rules;
- pricing where applicable, carried as PricingStandard rate lines keyed to the item. This means a price change never forces a new technical version.

| Catalog domain | Items | Compatibility / rules | Current code |
|---|---|---|---|
| **Material** | Boards; edge band items belong to this domain | Board ↔ finish compatibility | `Material`, `EdgeBand` |
| **Finish** | Laminate, veneer, paint, acrylic, PU | Finish ↔ material | `Finish` |
| **Hardware** | Manufacturer-neutral hardware items and hardware selection rule sets | `HardwareRuleSet` (parameter → mounting, preferred manufacturer) | `HardwareRuleSet` |
| **Hettich** | Source-verified manufacturer datasets: articles, calculation rules, drilling patterns, licence status. Kept behind `ManufacturerAdapter` | Compatible articles, quantity bands | `@lintel/hettich-engine` |
| **Appliance** | Make/model, dimensions, cut-out requirements | Product ↔ appliance fit (future) | **None yet** |

Products and construction recipes are also catalog data and are versioned the same way.

Each catalog domain has its **own release**: an approved, immutable set of that domain's item versions. The releases are:

- material catalog release (boards and edge bands);
- finish catalog release;
- hardware catalog release;
- appliance catalog release;
- product catalog release (products and recipes).

For Hettich, the dataset version is itself the release. A DesignVersion pins one release per domain.
`@lintel/persistence` assembles the engine's `CatalogSnapshot` from those pinned releases. There is no cross-domain generic release.

## Rule 3: every production record keeps its identity envelope

Every versioned production record (standard version, catalog item version, catalog release, Hettich dataset version,
DesignVersion) carries these fields:

| Field | Meaning |
|---|---|
| `entityId` | Stable identity across versions |
| `versionId` | Identity of this exact, immutable version; this is what gets pinned |
| `versionNumber` | 1, 2, 3 … within the entity |
| `status` | `DRAFT`, `IN_REVIEW`, `APPROVED`, `LOCKED` or `SUPERSEDED` (`CHANGES_REQUIRED` is a decision, not a status) |
| `source` | Document, drawing, supplier sheet or official URL, plus a structured source reference |
| `dataClassification` | Always `PRODUCTION` when persisted; TEST_FIXTURE is never stored |
| `createdBy` / `createdAt` | Author and time |
| `approvedBy` / `approvedAt` | Approver (never the submitter; no override) and time |
| `effectiveFrom` | From when it is the effective version for new designs |
| `supersededBy` | The successor version, set when SUPERSEDED |
| `contentHash` | SHA-256 of the canonical content, computed server-side |

- An approved version is never mutated; any change creates a new version.
- A version pinned by a LOCKED DesignVersion or an issued output becomes LOCKED.
- Standards additionally keep **per-value** source and evidence, because a standard version is approved as a whole but
  each value in it can come from a different document.

## Rule 4: what never happens

- TEST_FIXTURE values are never persisted and never promoted to production.
- Benchmark values (such as those in `KIT_BASE_STANDARD_BENCHMARK_V1.md`) are never converted into production values.
- No value is inferred. A missing value stays `null` and the engine blocks on it.
- Legacy ops SQL catalog values enter only as DRAFT with `source = LEGACY-REFERENCE`, for human review (ADR-0002).
- Hettich article numbers, drilling coordinates, quantities and specifications come only from source-verified records.
