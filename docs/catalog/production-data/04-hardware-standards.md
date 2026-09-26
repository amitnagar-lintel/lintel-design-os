# 04 — Hardware standards (Hettich)

Data set: `HETTICH_PRODUCTION_DATASET` (`packages/hettich-engine/src/datasets.ts`) — currently **empty**.
Schema: `HettichProductionRecord`; validator: `validateProductionRecord`.

## Rules
- Capture **only** from official Hettich sources (Hettich eShop, Hettich CAD, Technical Assistant,
  downloads/media library, Hettich Plan documentation — PRD §25). The validator accepts only `https`
  URLs on `hettich.com` (or a subdomain).
- **Never** type or infer article numbers, drilling coordinates, hinge quantities or technical
  specifications from memory. A record with any `NULL / UNVERIFIED` field is excluded by the engine and
  reported as a BLOCKER.
- PRODUCTION records are kept separate from TEST_FIXTURE articles. `FIXTURE-*` numbers are rejected in a
  PRODUCTION dataset; the fixture dataset (`HETTICH_TEST_FIXTURE_DATASET`) is classification `TEST_FIXTURE`
  and always blocks production.
- Do not embed licensed CAD binaries unless the licence permits it; store references (CLAUDE.md).
- Lead only: the ops database holds a `kg_03_hettich_nkba_ingest_01` batch (Sensys 8645i hinge,
  Quadro V6 runners). It is **not** a source for this dataset until each fact is re-captured from the
  official source with URL, date and licence.

## Record template (one per article — copy for each)
| Field | Required content | Value | Status |
|---|---|---|---|
| recordId | Internal id | NULL | NULL / UNVERIFIED |
| articleNumber | Exact Hettich article number | NULL | NULL / UNVERIFIED |
| productFamily / series | e.g. family and series as named by Hettich | NULL | NULL / UNVERIFIED |
| category | HINGE / MOUNTING_PLATE / … | NULL | NULL / UNVERIFIED |
| description | Official description | NULL | NULL / UNVERIFIED |
| exactApplication | Application text + application (HINGED_DOOR) + mounting (FULL_OVERLAY / HALF_OVERLAY / INSET) | NULL | NULL / UNVERIFIED |
| dimensions | Every published dimension with unit | NULL | NULL / UNVERIFIED |
| compatibility | Door thickness range, opening angle, required companion articles (e.g. mounting plates), notes | NULL | NULL / UNVERIFIED |
| drilling | Pattern id; each hole: face, datum, x, y, diameter, depth; drilling source reference | NULL | NULL / UNVERIFIED |
| installation | Installation guide source reference; notes | NULL | NULL / UNVERIFIED |
| adjustment | Adjustment ranges (e.g. side / height / depth) with units | NULL | NULL / UNVERIFIED |
| accessories | Optional accessories (`[]` = explicitly none) | NULL | NULL / UNVERIFIED |
| cadReference | CAD asset id, formats, official URL | NULL | NULL / UNVERIFIED |
| source.url | Official source URL (https, hettich.com) | NULL | NULL / UNVERIFIED |
| source.sourceDate | ISO date the source was consulted/published | NULL | NULL / UNVERIFIED |
| source.documentTitle / documentVersion | Title and version of the source | NULL | NULL / UNVERIFIED |
| licence.status / usageNotes | OFFICIAL_PUBLIC / AUTHORISED (RESTRICTED or UNKNOWN is rejected) | NULL | NULL / UNVERIFIED |
| verification | Verified by (name) and date | NULL | NULL / UNVERIFIED |
| preferenceRank | Lintel preference when several articles are compatible | NULL | NULL / UNVERIFIED |

## Calculation rules (hinge quantity etc.)
| Field | Required content | Value | Status |
|---|---|---|---|
| ruleId / family / category | Which article family the rule applies to | NULL | NULL / UNVERIFIED |
| bands | Ordered conditions over DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS, DOOR_WEIGHT → quantity, exactly as published | NULL | NULL / UNVERIFIED |
| source | Official URL + ISO date + document | NULL | NULL / UNVERIFIED |
| verification | Verified by (name) and date | NULL | NULL / UNVERIFIED |

## Lintel hardware selections
| Field | Value | Status |
|---|---|---|
| Hinge family / series to use for KIT_BASE_STANDARD (Lintel choice) | NULL | NULL / UNVERIFIED |
| Mounting mapping OVERLAY → FULL_OVERLAY (draft in `HINGE_STANDARD`) | FULL_OVERLAY | DRAFT, UNVERIFIED |
| Mounting mapping INSET → INSET (draft in `HINGE_STANDARD`) | INSET | DRAFT, UNVERIFIED |
| Required opening angle | NULL | NULL / UNVERIFIED |
| Soft-close / push-to-open requirement | NULL | NULL / UNVERIFIED |
| Shelf supports (pins) article | NULL | NULL / UNVERIFIED — not modelled |
| Legs / plinth hardware | NULL | NULL / UNVERIFIED — not modelled |
| Carcass connectors / screws | NULL | NULL / UNVERIFIED — not modelled |
