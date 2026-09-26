# Production data intake

Everything the engines need before any production output, production pricing or approval is possible.
**Nothing here is assumed.** Unknown values are written `NULL / UNVERIFIED` and stay that way until a
named person supplies them with a source and an approver signs them off.

## Status legend
| Status | Meaning |
|---|---|
| `NULL / UNVERIFIED` | No value yet. The engine blocks anything that depends on it. |
| `PRD-STATED, UNVERIFIED` | Value stated in the PRD but not yet confirmed by production/finance. |
| `LEGACY-REFERENCE, UNVERIFIED` | Seen in the legacy ops SQL catalog (reference only, ADR-0002). Not usable until verified. |
| `PROVIDED` | Value and source supplied, awaiting approval. |
| `APPROVED` | Approved; may be encoded in a new data version with status `APPROVED`. |

## Process
1. Provider fills the row: value, unit, source (document / drawing / supplier sheet / official URL), date.
2. Approver reviews and signs (name, date).
3. An engineer encodes the approved values as a **new version** of the relevant data set
   (`ConstructionStandard`, catalog, `HettichProductionDataset`, `RateCard`, `PricingRuleSet`) with status `APPROVED`.
4. Golden fixtures are regenerated and the diff is reviewed. Old versions remain for traceability.

Test-fixture values (`TEST_FIXTURE_*`) are synthetic, are never shown in these documents, and must never
be copied into production data.

## Documents
| # | Document | Covers |
|---|---|---|
| 01 | [construction-standards](01-construction-standards.md) | The 11 construction variables; recipe assumptions; approvals of product / recipe / hinge rule set |
| 02 | [board-material-standards](02-board-material-standards.md) | Boards, finishes |
| 03 | [edge-banding-standards](03-edge-banding-standards.md) | Edge-band materials; edge rules per component and side |
| 04 | [hardware-standards](04-hardware-standards.md) | Source-verified Hettich records, calculation rules, hinge mapping |
| 05 | [dimensional-limits](05-dimensional-limits.md) | Product limits |
| 06 | [manufacturing-standards](06-manufacturing-standards.md) | Cut-size, machining, nesting, labelling |
| 07 | [pricing-standards](07-pricing-standards.md) | Production rate card, pricing rules, quotation / tax policy |
| 08 | [planning-standards](08-planning-standards.md) | Room planning values (clearances, gaps, fillers, run length) and relationship overrides |

How these data sets are separated (standards vs catalog domains) and the record envelope every production record keeps: [PRODUCTION-DATA-ARCHITECTURE](../../architecture/PRODUCTION-DATA-ARCHITECTURE.md).
