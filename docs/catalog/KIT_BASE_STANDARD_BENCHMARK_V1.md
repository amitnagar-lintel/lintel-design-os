# KIT_BASE_STANDARD — Benchmark V1

> **INDUSTRY BENCHMARK - NOT LINTEL PRODUCTION STANDARD**
>
> Comparison only. This document does **not** change `LINTEL_CONSTRUCTION_STANDARD`, which stays
> `NULL / UNVERIFIED` for all 11 fields until Lintel approves values
> ([`KIT_BASE_STANDARD_DATA_REQUIRED.md`](KIT_BASE_STANDARD_DATA_REQUIRED.md)). No engine reads this file, and
> no value here may be copied into production data without Lintel approval.

## Sources

| Id | Source | URL | Source type |
|---|---|---|---|
| INF-1 | Infurnia Help Centre — "What is the Infurnia default construction for kitchen cabinets" | https://help.infurnia.com/en/articles/9662030-what-is-the-infurnia-default-construction-for-kitchen-cabinets | Software vendor product documentation (default construction of a design-to-manufacturing platform) |
| INF-2 | Infurnia Help Centre — "How to change the shutter back gap" | https://help.infurnia.com/en/articles/9669837-how-to-change-the-shutter-back-gap | Software vendor product documentation |
| INF-3 | Infurnia Help Centre — "How to modify your shutter reduction" | https://help.infurnia.com/en/articles/9669589-how-to-modify-your-shutter-reduction | Software vendor product documentation |
| IMOS | iMoS support documentation | https://support.imos3d.com/ | Software vendor product documentation — **architectural / configurability reference only** |

**Provenance (2026-09-26).** The Infurnia values below were verified against the pages above by Lintel
(project owner) and supplied for this document. They could not be re-fetched from the Lintel Design OS build
environment, whose network policy blocks `help.infurnia.com` and `support.imos3d.com`. Values are recorded exactly
as published; units are mm. Parameter names in quotation marks are as supplied by Lintel from the source
pages; they have not been re-checked verbatim in this environment.

**What these values are.** Infurnia publishes the *defaults of its software*; the same help centre documents how
users change them (INF-2, INF-3). They are therefore evidence of a common, configurable industry default, not a
manufacturing specification, and they say nothing about Lintel's own joinery.

**iMoS.** iMoS documentation demonstrates that groove construction, construction gaps, front gaps, offsets and
construction principles are configurable parameters. No numeric iMoS default is recorded here because none was
supplied from an explicit iMoS statement; iMoS is cited only as evidence that these fields are configurable.

### Terms
- **Directly stated** — the source states this number for a parameter whose meaning matches the Lintel field.
- **Stated, mapping interpreted** — the source states the number for a similarly named parameter; equating it with
  the Lintel field is an interpretation that Lintel production must confirm.
- **Not converted** — the source number is recorded with its own semantics; no conversion to the Lintel field is made.
- **NO VERIFIED PUBLIC BENCHMARK FOUND** — no source directly supports a number for the Lintel field; nothing is inferred.

## Summary

| # | Field | Benchmark value | Source | Confidence | Stated or inferred |
|---|---|---|---|---|---|
| 1 | BACK_GROOVE_DEPTH | 5 mm ("Grooving / back-panel extension") | INF-1 | MEDIUM | Stated, mapping interpreted |
| 2 | BACK_REAR_OFFSET | 20 mm ("Back-panel offset") | INF-1 | MEDIUM | Stated, mapping interpreted |
| 3 | TOP_RAIL_WIDTH | 100 mm ("Top rail depth") | INF-1 | MEDIUM | Directly stated |
| 4 | SHELF_FRONT_SETBACK | 20 mm ("Shelf reveal") | INF-1 | MEDIUM | Stated, mapping interpreted |
| 5 | SHELF_SIDE_CLEARANCE | -0.5 mm ("Adjustable Shelf extension value from sides") | INF-1 | MEDIUM | Not converted |
| 6 | OVERLAY_EDGE_GAP | 1 mm ("Shutter reduction", all four sides) | INF-1, INF-3 | MEDIUM | Stated, mapping interpreted |
| 7 | OVERLAY_TOP_GAP | 1 mm ("Shutter reduction", all four sides) | INF-1, INF-3 | MEDIUM | Stated, mapping interpreted |
| 8 | OVERLAY_BOTTOM_GAP | 1 mm ("Shutter reduction", all four sides) | INF-1, INF-3 | MEDIUM | Stated, mapping interpreted |
| 9 | FRONT_BETWEEN_GAP | NO VERIFIED PUBLIC BENCHMARK FOUND | — | — | — |
| 10 | INSET_GAP | NO VERIFIED PUBLIC BENCHMARK FOUND | — | — | — |
| 11 | FRONT_FINISHED_FACES | NO VERIFIED PUBLIC BENCHMARK FOUND | — | — | — |

Confidence is MEDIUM at best for every value: the source is explicit, but it is a software vendor's configurable
default rather than a hardware manufacturer's specification or a published standard.

---

### 1. `BACK_GROOVE_DEPTH`

| Item | Value |
|---|---|
| Field | `BACK_GROOVE_DEPTH` — depth of the back-panel groove in sides and bottom (mm) |
| Benchmark value | 5 mm |
| Source | INF-1 — "Grooving / back-panel extension: 5 mm" |
| Source URL | https://help.infurnia.com/en/articles/9662030-what-is-the-infurnia-default-construction-for-kitchen-cabinets |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | Infurnia default kitchen carcass with a grooved 6 mm back (INF-1 also states a 6 mm back-panel core, matching PRD §42). In the Lintel recipe the back extends into each groove by `BACK_GROOVE_DEPTH`, so "back-panel extension" and groove depth coincide only if the groove is cut exactly to the extension depth. Configurable in Infurnia; configurable per iMoS. |
| Stated or inferred | Stated, mapping interpreted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 2. `BACK_REAR_OFFSET`

| Item | Value |
|---|---|
| Field | `BACK_REAR_OFFSET` — carcass rear edge to the back panel's **rear face** (mm) |
| Benchmark value | 20 mm |
| Source | INF-1 — "Back-panel offset: 20 mm" |
| Source URL | https://help.infurnia.com/en/articles/9662030-what-is-the-infurnia-default-construction-for-kitchen-cabinets |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | The reference face of Infurnia's offset (rear face, front face or groove edge of the back panel) is not recorded here; it must be confirmed before comparing with the Lintel field, which is measured to the rear face. Configurable in Infurnia; configurable per iMoS. |
| Stated or inferred | Stated, mapping interpreted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 3. `TOP_RAIL_WIDTH`

| Item | Value |
|---|---|
| Field | `TOP_RAIL_WIDTH` — front-to-back depth of each top support rail (mm) |
| Benchmark value | 100 mm |
| Source | INF-1 — "Top rail depth: 100 mm"; also "Back/sink rail depth: 100 mm" |
| Source URL | https://help.infurnia.com/en/articles/9662030-what-is-the-infurnia-default-construction-for-kitchen-cabinets |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | Base unit with top rails instead of a full top. Infurnia publishes the same 100 mm default for the top rail and the back/sink rail; the Lintel recipe currently uses one variable for both rails. Configurable in Infurnia. |
| Stated or inferred | Directly stated |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 4. `SHELF_FRONT_SETBACK`

| Item | Value |
|---|---|
| Field | `SHELF_FRONT_SETBACK` — shelf front edge setback from the carcass front (mm) |
| Benchmark value | 20 mm |
| Source | INF-1 — "Shelf reveal: 20 mm" |
| Source URL | https://help.infurnia.com/en/articles/9662030-what-is-the-infurnia-default-construction-for-kitchen-cabinets |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | "Shelf reveal" is read as the front setback of the shelf; confirm that Infurnia measures it from the carcass front edge (not from the shutter). Configurable in Infurnia. |
| Stated or inferred | Stated, mapping interpreted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 5. `SHELF_SIDE_CLEARANCE`

| Item | Value |
|---|---|
| Field | `SHELF_SIDE_CLEARANCE` — **total** width clearance of a loose shelf between the sides (mm) |
| Benchmark value | -0.5 mm — Infurnia "Adjustable Shelf extension value from sides" (source semantics preserved; not converted) |
| Source | INF-1 — "Adjustable shelf extension from sides: -0.5 mm" |
| Source URL | https://help.infurnia.com/en/articles/9662030-what-is-the-infurnia-default-construction-for-kitchen-cabinets |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | Infurnia expresses this as a (negative) *extension* of the shelf from the sides, with its own sign convention; the Lintel field is a positive *total* clearance. Whether the value is per side or total, and how its sign maps, is **not** established here. This document deliberately does not convert it into a Lintel clearance value. Configurable in Infurnia. |
| Stated or inferred | Not converted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 6. `OVERLAY_EDGE_GAP`

| Item | Value |
|---|---|
| Field | `OVERLAY_EDGE_GAP` — overlay front reveal at each outer side edge (mm) |
| Benchmark value | 1 mm |
| Source | INF-1 — "Shutter reduction on all four sides: 1 mm"; INF-3 — shutter reduction default 1 mm on all four sides |
| Source URL | https://help.infurnia.com/en/articles/9669589-how-to-modify-your-shutter-reduction |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | Infurnia reduces the shutter by 1 mm on each side from its nominal (full overlay) size. Equating the per-side reduction with the outer edge reveal assumes the nominal shutter size equals the carcass outer width. Configurable in Infurnia (INF-3). |
| Stated or inferred | Stated, mapping interpreted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 7. `OVERLAY_TOP_GAP`

| Item | Value |
|---|---|
| Field | `OVERLAY_TOP_GAP` — overlay front reveal at the top (mm) |
| Benchmark value | 1 mm |
| Source | INF-1 — "Shutter reduction on all four sides: 1 mm"; INF-3 |
| Source URL | https://help.infurnia.com/en/articles/9669589-how-to-modify-your-shutter-reduction |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | As for field 6: per-side shutter reduction read as the top reveal, assuming the nominal shutter height equals the carcass height. Configurable in Infurnia (INF-3). |
| Stated or inferred | Stated, mapping interpreted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 8. `OVERLAY_BOTTOM_GAP`

| Item | Value |
|---|---|
| Field | `OVERLAY_BOTTOM_GAP` — overlay front reveal at the bottom (mm) |
| Benchmark value | 1 mm |
| Source | INF-1 — "Shutter reduction on all four sides: 1 mm"; INF-3 |
| Source URL | https://help.infurnia.com/en/articles/9669589-how-to-modify-your-shutter-reduction |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | As for field 6. INF-1 also states a 100 mm skirting height; the skirting sits below the carcass and is not part of this reveal (the Lintel V1 cabinet height excludes legs/plinth). Configurable in Infurnia (INF-3). |
| Stated or inferred | Stated, mapping interpreted |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 9. `FRONT_BETWEEN_GAP`

| Item | Value |
|---|---|
| Field | `FRONT_BETWEEN_GAP` — gap between adjacent shutters (mm) |
| Benchmark value | NO VERIFIED PUBLIC BENCHMARK FOUND |
| Source | — |
| Source URL | — |
| Source type | — |
| Confidence | — |
| Applicability | Source fact (INF-1, INF-3): each shutter is reduced by 1 mm on all four sides. A between-shutter gap would have to be **derived** from that (e.g. by adding the reductions of two neighbouring shutters), which is inference, so no value is recorded. iMoS documents front gaps as configurable, with no numeric default recorded. |
| Stated or inferred | — |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 10. `INSET_GAP`

| Item | Value |
|---|---|
| Field | `INSET_GAP` — inset front clearance to the opening on each side (mm) |
| Benchmark value | NO VERIFIED PUBLIC BENCHMARK FOUND |
| Source | — |
| Source URL | — |
| Source type | — |
| Confidence | — |
| Applicability | The supplied Infurnia defaults describe shutter reduction without distinguishing inset fronts; no inset clearance is stated. iMoS documents front gaps as configurable, with no numeric default recorded. |
| Stated or inferred | — |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

### 11. `FRONT_FINISHED_FACES`

| Item | Value |
|---|---|
| Field | `FRONT_FINISHED_FACES` — number of shutter faces that receive the front finish (count 0–2) |
| Benchmark value | NO VERIFIED PUBLIC BENCHMARK FOUND |
| Source | — |
| Source URL | — |
| Source type | — |
| Confidence | — |
| Applicability | Source fact: Infurnia documents an internal and an external front finish. Interpretation (not adopted): that could correspond to 2 finished faces, but a separately specified internal finish may be a different material (e.g. a balancing laminate) from the external decorative finish, whereas the Lintel field counts faces receiving the **front finish**. The mapping is not established, so no count is recorded. |
| Stated or inferred | — |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

---

## Additional construction parameters (identified during benchmark research)

Not part of the original 11-field list; see `KIT_BASE_STANDARD_DATA_REQUIRED.md` section A1.

### A1. `SHUTTER_BACK_GAP`

| Item | Value |
|---|---|
| Field | `SHUTTER_BACK_GAP` — gap between the back face of an overlay shutter and the carcass front face (mm) |
| Benchmark value | 2 mm |
| Source | INF-2 — "Shutter back gap" default: 2 mm |
| Source URL | https://help.infurnia.com/en/articles/9669837-how-to-change-the-shutter-back-gap |
| Source type | Software vendor product documentation |
| Confidence | MEDIUM |
| Applicability | Infurnia treats shutter back gap as its own configurable construction parameter, separate from shutter reduction and from the front reveals; the Lintel field has the same meaning (depth-direction gap between shutter and carcass front). Configurable in Infurnia (INF-2). Applies to overlay fronts in the Lintel recipe. |
| Stated or inferred | Directly stated |
| Lintel production value | NULL / UNVERIFIED (unchanged) |

## Shutter reduction (source fact, not a Lintel field)

INF-1 / INF-3 publish a **shutter reduction** of 1 mm on all four sides. Shutter reduction is a distinct concept
(front made smaller than a nominal size) and is **not** used by the Lintel recipe. It is recorded here as a
source fact only. It is not converted into `SHUTTER_BACK_GAP`, `FRONT_BETWEEN_GAP`, `INSET_GAP`, or any Lintel
production value. (Fields 6–8 above are preserved exactly as approved; their "Stated, mapping interpreted"
status records that equating reduction with a reveal is an interpretation, not a conversion.)

---

## Other benchmark facts not mapped to a Lintel field

Recorded for completeness from INF-1 / INF-2. None of these changes Lintel data.

| Source fact | Value | Source | Relevance |
|---|---|---|---|
| Back-panel core | 6 mm | INF-1 | Matches PRD §42 back thickness (6 mm). |
| Base unit default | 720 × 560 mm | INF-1 | Matches PRD §42 reference height and depth. |
| Back/sink rail depth | 100 mm | INF-1 | See field 3. |
| Skirting height | 100 mm | INF-1 | Plinth/skirting is not modelled in Lintel V1. |
| Shutter back gap (default) | 2 mm | INF-2 | Now mapped: see additional parameter A1 `SHUTTER_BACK_GAP` (recipe v1.1.0). |
