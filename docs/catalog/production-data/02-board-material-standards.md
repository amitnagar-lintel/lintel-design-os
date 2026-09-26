# 02 — Board / material standards

Data set: catalog `materials` and `finishes` (`packages/catalog-engine/src/data/materials.ts`).
Substrate, finish and edge band are kept separate (PRD §19).

## BOARD_BWP_18 (carcass default)
| Field | Unit | Value | Status |
|---|---|---|---|
| Substrate | — | BWP plywood | PRD-STATED, UNVERIFIED |
| Nominal thickness | mm | 18 | PRD-STATED, UNVERIFIED |
| Thickness tolerance | mm | NULL | NULL / UNVERIFIED |
| Sheet size (width × length) | mm | 1220 × 2440 | PRD-STATED, UNVERIFIED |
| Grain | yes/no | yes | PRD-STATED, UNVERIFIED |
| Density | kg/m³ | NULL | NULL / UNVERIFIED |
| Grade / standard reference | — | NULL | NULL / UNVERIFIED |
| Brand / supplier | — | NULL | NULL / UNVERIFIED |
| Approved by / date | — | NULL | NULL / UNVERIFIED |

## BOARD_HDHMR_18 (shutter default)
| Field | Unit | Value | Status |
|---|---|---|---|
| Substrate | — | HDHMR | PRD-STATED, UNVERIFIED |
| Nominal thickness | mm | 18 | PRD-STATED, UNVERIFIED |
| Thickness tolerance | mm | NULL | NULL / UNVERIFIED |
| Sheet size | mm | NULL | NULL / UNVERIFIED |
| Grain | yes/no | NULL | NULL / UNVERIFIED |
| Density | kg/m³ | NULL | NULL / UNVERIFIED |
| Grade / standard reference | — | NULL | NULL / UNVERIFIED |
| Brand / supplier | — | NULL | NULL / UNVERIFIED |
| Approved by / date | — | NULL | NULL / UNVERIFIED |

## BOARD_BACK_6 (back default)
| Field | Unit | Value | Status |
|---|---|---|---|
| Substrate | — | NULL | NULL / UNVERIFIED |
| Nominal thickness | mm | 6 | PRD-STATED, UNVERIFIED |
| Thickness tolerance | mm | NULL | NULL / UNVERIFIED |
| Sheet size | mm | NULL | NULL / UNVERIFIED |
| Grain | yes/no | NULL | NULL / UNVERIFIED |
| Density | kg/m³ | NULL | NULL / UNVERIFIED |
| Grade / standard reference | — | NULL | NULL / UNVERIFIED |
| Brand / supplier | — | NULL | NULL / UNVERIFIED |
| Approved by / date | — | NULL | NULL / UNVERIFIED |

Density is required for door-weight-based hardware rules; without it door weight is reported as unknown.

## Finishes — LAMINATE_WHITE (shutter default)
| Field | Unit | Value | Status |
|---|---|---|---|
| Type | — | Laminate | PRD-STATED, UNVERIFIED |
| Thickness | mm | 1 | PRD-STATED, UNVERIFIED |
| Surface / texture | — | NULL | NULL / UNVERIFIED |
| Brand / catalogue code | — | NULL | NULL / UNVERIFIED |
| Balancing laminate on inner face required | yes/no | NULL | NULL / UNVERIFIED |
| Approved by / date | — | NULL | NULL / UNVERIFIED |

## Carcass internal finish
| Field | Value | Status |
|---|---|---|
| Internal laminate on carcass panels (which panels, which faces) | NULL | NULL / UNVERIFIED — not modelled in M1/M2 |
