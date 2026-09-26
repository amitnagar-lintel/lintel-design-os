# Production Data Architecture

Status: **PROPOSED with the M5 technical design** (2026-09-26). This document describes structure only.
Every production value remains `NULL / UNVERIFIED` until it is supplied with a source and approved
(see [production-data intake](../catalog/production-data/README.md)).

## Rule 1: engineering and business standards stay separate

There is **no generic `Standard` table, type or configuration object.** Each standard has its own type, its own
tables, its own value registry and its own approver.

| Standard | Holds | Current code | Intake doc | Approver role |
|---|---|---|---|---|
| **ConstructionStandard** | Numeric construction values: the original 11 variables plus SHUTTER_BACK_GAP (12). Shutter *reduction* and shutter *back gap* stay distinct concepts | `ConstructionStandard.variables` | 01 | TECHNICAL_APPROVER |
| **PlanningStandard** | Room planning values: MIN_WALL_CLEARANCE, MIN_CABINET_GAP, MAX_GAP_WITHOUT_FILLER, FILLER_THRESHOLD, MAX_RUN_LENGTH, SERVICE_VOID_REAR | `PlanningStandard` (M4) | 08 | TECHNICAL_APPROVER |
| **EdgeBandStandard** | Which edges of which component types are banded, and with which edge band item | **Gap:** today it lives inside `ConstructionStandard.edgeRuleSets`. M5 commit 0 splits it out with no behaviour change | 03 | TECHNICAL_APPROVER |
| **ManufacturingStandard** | Cut-size allowances, machining, nesting and labelling rules | **Gap:** no type yet; intake doc only | 06 | TECHNICAL_APPROVER |
| **PricingStandard** | Pricing rules (manufacturing-cost formula, wastage, overhead, margin basis and %) and the rate card | `PricingRuleSet` + `RateCard` | 07 | FINANCE_APPROVER |
| **Finance / QuotationPolicy** | Tax rates, category → rate mapping, tax policy, rounding and discount policy (`NONE` only) | `QuotationPolicy` (M4) | 07 | FINANCE_APPROVER |

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

Products and construction recipes are also catalog data. They are versioned the same way and grouped with the
catalog items into an approved, immutable **catalog release**, which becomes the engine's `CatalogSnapshot`.

## Rule 3: every production record keeps its envelope

Every production record carries these fields:

| Field | Meaning |
|---|---|
| `version` | Monotonic version number within its own header (plus an optional label) |
| `status` | `DRAFT`, `IN_REVIEW`, `APPROVED`, `LOCKED` or `SUPERSEDED` |
| `source` | Document, drawing, supplier sheet or official URL, plus structured source reference |
| `approvedBy` | The approving user (never the submitter) |
| `approvedAt` | Approval timestamp |
| `effectiveFrom` | From when it is the effective version for new designs |
| `supersededBy` | The successor version, set when SUPERSEDED |

Standards additionally keep **per-value** source and evidence, because a standard version is approved as a whole but
each value in it can come from a different document.

## Rule 4: what never happens

- TEST_FIXTURE values are never persisted and never promoted to production.
- Benchmark values (such as those in `KIT_BASE_STANDARD_BENCHMARK_V1.md`) are never converted into production values.
- No value is inferred. A missing value stays `null` and the engine blocks on it.
- Legacy ops SQL catalog values enter only as DRAFT with `source = LEGACY-REFERENCE`, for human review (ADR-0002).
- Hettich article numbers, drilling coordinates, quantities and specifications come only from source-verified records.
