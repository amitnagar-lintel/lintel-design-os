# KIT_BASE_STANDARD — catalog notes

Product `KIT_BASE_STANDARD` v1.0.0 (DRAFT) · recipe `KITCHEN_BASE_STANDARD_V1` v1.0.0 (DRAFT) ·
source: `packages/catalog-engine/src/data/kit-base-standard.ts`.

## Parameters (PRD §41; defaults = PRD §42 reference cabinet)
| Key | Symbol | Default | Limits |
|---|---|---|---|
| width / height / depth | W / H / D | 600 / 720 / 560 mm | not configured (PRD silent) |
| carcassThickness | T | 18 mm | must equal carcass material thickness |
| backThickness | TB | 6 mm | must equal back material thickness |
| shelfCount | N_SHELF | 1 | ≥ 0 |
| shutterCount | N_SHUTTER | 2 | ≥ 1 |
| frontType | FRONT (flags FRONT_OVERLAY / FRONT_INSET) | OVERLAY | OVERLAY, INSET |
| material / backMaterial / shutterMaterial | T_CARCASS_MAT / T_BACK_MAT / T_FRONT (thickness) | BOARD_BWP_18 / BOARD_BACK_6 / BOARD_HDHMR_18 | catalog |
| finish | — | LAMINATE_WHITE | catalog |

> Detailed, per-value requirements: [`KIT_BASE_STANDARD_DATA_REQUIRED.md`](KIT_BASE_STANDARD_DATA_REQUIRED.md);
> intake templates: [`production-data/`](production-data/).

## Construction values Lintel production must define (LINTEL_CONSTRUCTION_STANDARD)
All are currently `null`. Until defined, dependent components are not generated (BLOCKER).

| Variable | Meaning | Needed for |
|---|---|---|
| BACK_GROOVE_DEPTH | Back-panel groove depth in sides and bottom | back |
| BACK_REAR_OFFSET | Carcass rear edge → back panel rear face | back, rear rail, shelf |
| TOP_RAIL_WIDTH | Front-to-back depth of each top rail | top rails |
| SHELF_FRONT_SETBACK | Shelf setback from carcass front | shelf |
| SHELF_SIDE_CLEARANCE | Total width clearance of a loose shelf | shelf |
| OVERLAY_EDGE_GAP | Overlay reveal at each outer side | overlay shutters |
| OVERLAY_TOP_GAP / OVERLAY_BOTTOM_GAP | Overlay reveals top / bottom | overlay shutters |
| FRONT_BETWEEN_GAP | Gap between adjacent shutters | shutters |
| INSET_GAP | Inset clearance to the opening | inset shutters |
| FRONT_FINISHED_FACES | Shutter faces receiving the finish (0–2) | finish BOM |

Also required: edge rules per component type (`edgeRuleSets.CARCASS_STANDARD`), material density
(for door weight) and grain for HDHMR / back board, and approval of product, recipe and hinge rule set.

## Recipe assumptions (for production review)
See `KITCHEN_BASE_STANDARD_V1.assumptions`: full-height sides, bottom and rails between sides, grooved back
to carcass top, rear rail in front of back, evenly spaced loose shelves, overlay vs inset front geometry,
height excludes legs/worktop, finished (not cut) sizes.
