# 01 — Construction standards

Data set: `LINTEL_CONSTRUCTION_STANDARD` (currently v0.2.0, `DRAFT`).
Full per-value detail (usage, components, formulas, drawings, manufacturing outputs):
[`../KIT_BASE_STANDARD_DATA_REQUIRED.md`](../KIT_BASE_STANDARD_DATA_REQUIRED.md).

## Construction variables
| # | Field | Unit | Value | Status | Source | Provided by | Approved by / date |
|---|---|---|---|---|---|---|---|
| 1 | BACK_GROOVE_DEPTH | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 2 | BACK_REAR_OFFSET | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 3 | TOP_RAIL_WIDTH | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 4 | SHELF_FRONT_SETBACK | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 5 | SHELF_SIDE_CLEARANCE | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 6 | OVERLAY_EDGE_GAP | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 7 | OVERLAY_TOP_GAP | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 8 | OVERLAY_BOTTOM_GAP | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 9 | FRONT_BETWEEN_GAP | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 10 | INSET_GAP | mm | NULL | NULL / UNVERIFIED | — | — | — |
| 11 | FRONT_FINISHED_FACES | count | NULL | NULL / UNVERIFIED | — | — | — |

Additional construction parameter identified during benchmark research (not part of the original 11):

| # | Field | Unit | Value | Status | Source | Provided by | Approved by / date |
|---|---|---|---|---|---|---|---|
| A1 | SHUTTER_BACK_GAP | mm | NULL | NULL / UNVERIFIED | — | — | — |

## Recipe assumptions requiring confirmation (`KITCHEN_BASE_STANDARD_V1`)
Each is a construction method the draft recipe encodes; production must confirm or reject it individually.

| # | Assumption | Status | Confirmed by / date |
|---|---|---|---|
| A1 | Sides run full cabinet height; bottom and top rails sit between the sides | NULL / UNVERIFIED | — |
| A2 | Back panel is housed in grooves in both sides and the bottom, and runs to the top of the carcass | NULL / UNVERIFIED | — |
| A3 | Rear top rail sits directly in front of the back panel | NULL / UNVERIFIED | — |
| A4 | Shelves are loose, spaced evenly in the internal height, and sit in front of the back panel | NULL / UNVERIFIED | — |
| A5 | Overlay shutters cover the carcass front face, held SHUTTER_BACK_GAP in front of it; inset shutters sit inside the opening below the top rails (no back gap) | NULL / UNVERIFIED | — |
| A6 | Cabinet height excludes legs/plinth and worktop | NULL / UNVERIFIED | — |
| A7 | Panel dimensions are finished sizes; cut-size allowances belong to manufacturing | NULL / UNVERIFIED | — |

## Data-set approvals
| Data set | Current version / status | Required status | Approved by / date |
|---|---|---|---|
| Product `KIT_BASE_STANDARD` | 1.0.0 / DRAFT | APPROVED | NULL / UNVERIFIED |
| Recipe `KITCHEN_BASE_STANDARD_V1` | 1.1.0 / DRAFT | APPROVED | NULL / UNVERIFIED |
| Hardware rule set `HINGE_STANDARD` | 1.0.0 / DRAFT | APPROVED | NULL / UNVERIFIED |
| Construction standard `LINTEL_CONSTRUCTION_STANDARD` | 0.2.0 / DRAFT | APPROVED | NULL / UNVERIFIED |
