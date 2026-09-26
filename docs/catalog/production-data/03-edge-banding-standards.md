# 03 — Edge-banding standards

Data sets: catalog `edgeBands`; `LINTEL_CONSTRUCTION_STANDARD.edgeRuleSets.CARCASS_STANDARD`
(currently empty — every component reports `EDGE_RULES_UNDEFINED`).

## Edge-band materials
| Edge band | Field | Unit | Value | Status |
|---|---|---|---|---|
| EDGE_ABS_2MM | Material | — | ABS | PRD-STATED, UNVERIFIED |
| EDGE_ABS_2MM | Thickness | mm | 2 | PRD-STATED, UNVERIFIED |
| EDGE_ABS_2MM | Width | mm | NULL | NULL / UNVERIFIED |
| EDGE_ABS_2MM | Colour / match to finish | — | NULL | NULL / UNVERIFIED |
| EDGE_ABS_2MM | Brand / supplier | — | NULL | NULL / UNVERIFIED |
| EDGE_ABS_0_8MM | Material | — | ABS | LEGACY-REFERENCE, UNVERIFIED |
| EDGE_ABS_0_8MM | Thickness | mm | 0.8 | LEGACY-REFERENCE, UNVERIFIED |
| EDGE_ABS_0_8MM | Width | mm | NULL | NULL / UNVERIFIED |
| EDGE_ABS_0_8MM | Colour / match to finish | — | NULL | NULL / UNVERIFIED |
| EDGE_ABS_0_8MM | Brand / supplier | — | NULL | NULL / UNVERIFIED |

## Edge rules per component and side (`CARCASS_STANDARD`)
Edge sides are named by installed orientation. Each cell: edge-band id, `NONE`, or `NULL / UNVERIFIED`.

| Component | Side | Edge band | Status |
|---|---|---|---|
| SIDE_LEFT | FRONT | NULL | NULL / UNVERIFIED |
| SIDE_LEFT | BACK | NULL | NULL / UNVERIFIED |
| SIDE_LEFT | TOP | NULL | NULL / UNVERIFIED |
| SIDE_LEFT | BOTTOM | NULL | NULL / UNVERIFIED |
| SIDE_RIGHT | FRONT | NULL | NULL / UNVERIFIED |
| SIDE_RIGHT | BACK | NULL | NULL / UNVERIFIED |
| SIDE_RIGHT | TOP | NULL | NULL / UNVERIFIED |
| SIDE_RIGHT | BOTTOM | NULL | NULL / UNVERIFIED |
| BOTTOM | FRONT | NULL | NULL / UNVERIFIED |
| BOTTOM | BACK | NULL | NULL / UNVERIFIED |
| BOTTOM | LEFT | NULL | NULL / UNVERIFIED |
| BOTTOM | RIGHT | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_FRONT | FRONT | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_FRONT | BACK | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_FRONT | LEFT | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_FRONT | RIGHT | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_BACK | FRONT | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_BACK | BACK | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_BACK | LEFT | NULL | NULL / UNVERIFIED |
| TOP_SUPPORT_BACK | RIGHT | NULL | NULL / UNVERIFIED |
| BACK | TOP | NULL | NULL / UNVERIFIED |
| BACK | BOTTOM | NULL | NULL / UNVERIFIED |
| BACK | LEFT | NULL | NULL / UNVERIFIED |
| BACK | RIGHT | NULL | NULL / UNVERIFIED |
| SHELF | FRONT | NULL | NULL / UNVERIFIED |
| SHELF | BACK | NULL | NULL / UNVERIFIED |
| SHELF | LEFT | NULL | NULL / UNVERIFIED |
| SHELF | RIGHT | NULL | NULL / UNVERIFIED |
| SHUTTER | TOP | NULL | NULL / UNVERIFIED |
| SHUTTER | BOTTOM | NULL | NULL / UNVERIFIED |
| SHUTTER | LEFT | NULL | NULL / UNVERIFIED |
| SHUTTER | RIGHT | NULL | NULL / UNVERIFIED |

## Edge-banding process data
| Field | Unit | Value | Status |
|---|---|---|---|
| Pre-milling allowance per banded edge | mm | NULL | NULL / UNVERIFIED |
| Length overhang / trim allowance per edge | mm | NULL | NULL / UNVERIFIED |
| Whether cut size is reduced by band thickness | yes/no | NULL | NULL / UNVERIFIED |
| Adhesive type | — | NULL | NULL / UNVERIFIED |
