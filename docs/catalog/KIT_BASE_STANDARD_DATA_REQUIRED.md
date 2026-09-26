# KIT_BASE_STANDARD — production data required

**Status: BLOCKED for production.** Lintel construction standard `LINTEL_CONSTRUCTION_STANDARD` v0.2.0
is `DRAFT` and every value below is `NULL / UNVERIFIED`. The engine will not generate the affected
components, and production output, production pricing and approval stay blocked until each value is
provided, verified and approved in a new standard version with status `APPROVED`.

- Source of truth for the variable list: `KITCHEN_BASE_STANDARD_V1.constructionVariables`
  (`packages/catalog-engine/src/data/kit-base-standard.ts`). A test keeps this document in sync.
- Test-fixture values exist only in `TEST_FIXTURE_CONSTRUCTION_STANDARD` for automated tests. They are
  synthetic, deliberately not repeated here, and must not be used as candidates.
- Drawing types are the PRD §33 V1 set: Front Elevation, Internal Elevation, Side Section, Panel Schedule.
- Manufacturing outputs are the PRD Phase 7 set: cut list, edge-banding list, drilling / CNC program,
  board optimisation (nesting), panel labels, hardware pick list.
- Industry benchmark (comparison only, not a production source): [`KIT_BASE_STANDARD_BENCHMARK_V1.md`](KIT_BASE_STANDARD_BENCHMARK_V1.md).
- Named approvers are not yet assigned: **NULL / UNVERIFIED**. Roles are given below.

Symbols used in expressions: `W` width, `H` height, `D` depth, `T` carcass thickness, `TB` back thickness,
`N_SHUTTER` shutter count, `N_SHELF` shelf count, `T_FRONT` shutter board thickness, `i` instance index.

## Reconciliation: 11 construction values vs "10 undefined" reported for the reference cabinet

The M2 report stated "10 undefined construction values" for the production run. Both numbers are correct
and refer to different things:

- **11** = every construction variable declared by recipe `KITCHEN_BASE_STANDARD_V1`. All 11 are `NULL` in
  `LINTEL_CONSTRUCTION_STANDARD` and all 11 must be approved before the product family is production-ready.
- **10** = the variables the engine actually needed for the **reference cabinet** (PRD §42: overlay fronts).
  The engine reports only values that an *active* formula needs. `INSET_GAP` is used only by the
  `SHUTTER_INSET` template (`when: FRONT_INSET`), so it is not reported for an overlay cabinet. Switching the
  same cabinet to `frontType = INSET` makes `INSET_GAP` required and makes the three overlay-only values
  (`OVERLAY_EDGE_GAP`, `OVERLAY_TOP_GAP`, `OVERLAY_BOTTOM_GAP`) not required for that cabinet.

Classification of each field:

| # | Field | Classified as | Why | Required for overlay reference | Required for inset |
|---|---|---|---|---|---|
| 1 | BACK_GROOVE_DEPTH | Construction value — carcass joinery dimension | Sets back panel size/position and the groove machined into sides and bottom | Yes | Yes |
| 2 | BACK_REAR_OFFSET | Construction value — carcass joinery dimension | Positions the back, rear rail and shelves in depth | Yes | Yes |
| 3 | TOP_RAIL_WIDTH | Construction value — component dimension | Sizes both top support rails | Yes | Yes |
| 4 | SHELF_FRONT_SETBACK | Construction value — component dimension | Sizes the shelf depth; clearance rule for inset fronts | Yes | Yes |
| 5 | SHELF_SIDE_CLEARANCE | Construction value — fit tolerance | Sizes loose shelf width | Yes | Yes |
| 6 | OVERLAY_EDGE_GAP | Construction value — front reveal | Sizes/positions overlay fronts | Yes | No |
| 7 | OVERLAY_TOP_GAP | Construction value — front reveal | Sizes overlay front height | Yes | No |
| 8 | OVERLAY_BOTTOM_GAP | Construction value — front reveal | Sizes/positions overlay front height | Yes | No |
| 9 | FRONT_BETWEEN_GAP | Construction value — front reveal | Gap between adjacent fronts (overlay and inset) | Yes | Yes |
| 10 | INSET_GAP | Construction value — front reveal | Sizes/positions inset fronts only | **No** (inactive) | Yes |
| 11 | FRONT_FINISHED_FACES | Construction **specification** (count), not a dimension | Declared in the construction standard because it is a construction decision (balance/finish of both faces); it drives finish quantity, not geometry | Yes | Yes |

So the original production list is **11 fields**; the reference overlay cabinet blocks on **10** of them; an
inset cabinet blocks on **8** (`BACK_GROOVE_DEPTH`, `BACK_REAR_OFFSET`, `TOP_RAIL_WIDTH`,
`SHELF_FRONT_SETBACK`, `SHELF_SIDE_CLEARANCE`, `FRONT_BETWEEN_GAP`, `INSET_GAP`, `FRONT_FINISHED_FACES`).

**Update (recipe v1.1.0 / standard v0.2.0):** one **additional** construction parameter, `SHUTTER_BACK_GAP`,
was identified during benchmark research and added as a separate value (section A1 below). It is deliberately
**not** renumbered into the original 11. With it, the recipe declares **12** construction values; the overlay
reference cabinet blocks on **11** (the original 10 + `SHUTTER_BACK_GAP`); an inset cabinet still blocks on **8**
(`SHUTTER_BACK_GAP` applies to overlay shutters only). A test (`tests/docs-sync.test.ts`) asserts these counts
against the engine.

## Front-geometry terms (independent semantics)

Each term below is a distinct concept. None may be substituted for, derived from, or aliased to another.

| Term | Meaning | Used by `KITCHEN_BASE_STANDARD_V1`? |
|---|---|---|
| `OVERLAY_EDGE_GAP` | Reveal between an overlay front's outer side edge and the carcass outer side face (per side) | Yes — construction variable 6 |
| `OVERLAY_TOP_GAP` | Reveal between an overlay front's top edge and the carcass top | Yes — construction variable 7 |
| `OVERLAY_BOTTOM_GAP` | Reveal between an overlay front's bottom edge and the carcass bottom | Yes — construction variable 8 |
| `FRONT_BETWEEN_GAP` | Gap between the facing edges of two adjacent fronts | Yes — construction variable 9 |
| `INSET_GAP` | Clearance between an inset front and the carcass opening (per side) | Yes — construction variable 10 |
| `SHUTTER_BACK_GAP` | Gap between the back face of an overlay front and the carcass front face (depth direction) | Yes — additional construction value A1 |
| `SHUTTER_REDUCTION` | Amount by which a front is made smaller than a nominal front size, per side | **No.** The recipe sizes fronts from carcass dimensions and reveals, not from a nominal size minus a reduction. Industry sources publish reduction values (see the benchmark); they are **not** converted into any gap above. Adopting a reduction-based parameterisation would be a recipe change for Lintel to decide. |


---

### 1. `BACK_GROOVE_DEPTH`

| Item | Value |
|---|---|
| Field name | `BACK_GROOVE_DEPTH` — depth of the back-panel groove in the sides and bottom |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | `BACK.width` = `INTERNAL_WIDTH + 2*BACK_GROOVE_DEPTH`; `BACK.height` = `H - T + BACK_GROOVE_DEPTH`; `BACK.position.x` = `T - BACK_GROOVE_DEPTH`; `BACK.position.y` = `T - BACK_GROOVE_DEPTH`; rule `KBS_GROOVE_WITHIN_CARCASS` (`BACK_GROOVE_DEPTH < T`) |
| Affected components | BACK (size and position); SIDE_LEFT, SIDE_RIGHT, BOTTOM (receive the groove — machining not yet modelled) |
| Affected formulas | None of the named recipe formulas; the BACK template expressions above; rule `KBS_GROOVE_WITHIN_CARCASS` |
| Affected drawings | Side Section (groove and back position); Internal Elevation (back panel); Panel Schedule (back size) |
| Affected manufacturing outputs | Cut list (back); groove operation on sides and bottom (drilling / CNC program); board optimisation (6 mm back board); panel labels; BOM board area `BOARD_BACK_6` and therefore price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 2. `BACK_REAR_OFFSET`

| Item | Value |
|---|---|
| Field name | `BACK_REAR_OFFSET` — distance from the carcass rear edge to the back panel's rear face |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formula `SHELF_DEPTH` = `D - BACK_REAR_OFFSET - TB - SHELF_FRONT_SETBACK`; `BACK.position.z` = `BACK_REAR_OFFSET`; `TOP_SUPPORT_BACK.position.z` = `BACK_REAR_OFFSET + TB`; `SHELF.position.z` = `BACK_REAR_OFFSET + TB` |
| Affected components | BACK (position); TOP_SUPPORT_BACK (position); SHELF (depth and position); SIDE_LEFT, SIDE_RIGHT, BOTTOM (groove position — machining not yet modelled) |
| Affected formulas | `SHELF_DEPTH` |
| Affected drawings | Side Section; Panel Schedule (shelf depth) |
| Affected manufacturing outputs | Cut list (shelf); groove position on sides and bottom (drilling / CNC program); rear rail fixing position (drilling / CNC program); board optimisation; panel labels; BOM board area and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 3. `TOP_RAIL_WIDTH`

| Item | Value |
|---|---|
| Field name | `TOP_RAIL_WIDTH` — front-to-back depth of each top support rail |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | `TOP_SUPPORT_FRONT.height` = `TOP_RAIL_WIDTH`; `TOP_SUPPORT_FRONT.position.z` = `D - TOP_RAIL_WIDTH`; `TOP_SUPPORT_BACK.height` = `TOP_RAIL_WIDTH` |
| Affected components | TOP_SUPPORT_FRONT; TOP_SUPPORT_BACK |
| Affected formulas | None of the named recipe formulas; the two rail template expressions above |
| Affected drawings | Side Section; Panel Schedule; Front Elevation (front rail visible above inset shutters) |
| Affected manufacturing outputs | Cut list (rails); board optimisation; rail fixing drilling (drilling / CNC program); panel labels; BOM board area and price, and the manufacturing-cost measure `BOARD_AREA_M2` |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 4. `SHELF_FRONT_SETBACK`

| Item | Value |
|---|---|
| Field name | `SHELF_FRONT_SETBACK` — setback of the shelf front edge from the carcass front |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formula `SHELF_DEPTH` → `SHELF.height`; rule `KBS_INSET_SHELF_CLEARS_SHUTTER` (`SHELF_FRONT_SETBACK >= T_FRONT` when inset with shelves) |
| Affected components | SHELF |
| Affected formulas | `SHELF_DEPTH`; rule `KBS_INSET_SHELF_CLEARS_SHUTTER` |
| Affected drawings | Side Section; Panel Schedule |
| Affected manufacturing outputs | Cut list (shelf); board optimisation; panel labels; BOM board area and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 5. `SHELF_SIDE_CLEARANCE`

| Item | Value |
|---|---|
| Field name | `SHELF_SIDE_CLEARANCE` — total width clearance of a loose shelf between the sides |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | `SHELF.width` = `INTERNAL_WIDTH - SHELF_SIDE_CLEARANCE`; `SHELF.position.x` = `T + SHELF_SIDE_CLEARANCE / 2` |
| Affected components | SHELF |
| Affected formulas | None of the named recipe formulas; the SHELF template expressions above |
| Affected drawings | Internal Elevation; Panel Schedule |
| Affected manufacturing outputs | Cut list (shelf); edge-banding list (shelf front edge length); board optimisation; panel labels; BOM board and edge-band quantities and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 6. `OVERLAY_EDGE_GAP`

| Item | Value |
|---|---|
| Field name | `OVERLAY_EDGE_GAP` — overlay front reveal at each outer side edge |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formula `OVERLAY_SHUTTER_WIDTH` = `(W - 2*OVERLAY_EDGE_GAP - (N_SHUTTER - 1)*FRONT_BETWEEN_GAP) / N_SHUTTER`; `SHUTTER_OVERLAY.position.x` = `OVERLAY_EDGE_GAP + i*(OVERLAY_SHUTTER_WIDTH + FRONT_BETWEEN_GAP)` |
| Affected components | SHUTTER (overlay fronts); hinge requirements via fitting situation `doorWidth` |
| Affected formulas | `OVERLAY_SHUTTER_WIDTH` |
| Affected drawings | Front Elevation; Panel Schedule |
| Affected manufacturing outputs | Cut list (shutters); edge-banding list (shutter top/bottom edges); finish (laminate) quantity; hinge drilling positions (drilling / CNC program, once modelled); board optimisation (shutter board); panel labels; hardware pick list (hinge compatibility); BOM and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 7. `OVERLAY_TOP_GAP`

| Item | Value |
|---|---|
| Field name | `OVERLAY_TOP_GAP` — overlay front reveal at the top |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formula `OVERLAY_SHUTTER_HEIGHT` = `H - OVERLAY_TOP_GAP - OVERLAY_BOTTOM_GAP` → `SHUTTER_OVERLAY.height` |
| Affected components | SHUTTER (overlay fronts); hinge requirements via fitting situation `doorHeight` (drives the hinge quantity rule) |
| Affected formulas | `OVERLAY_SHUTTER_HEIGHT` |
| Affected drawings | Front Elevation; Panel Schedule |
| Affected manufacturing outputs | Cut list (shutters); edge-banding list (shutter left/right edges); finish quantity; hinge quantity and positions (hardware pick list, drilling / CNC program); board optimisation; panel labels; BOM and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 8. `OVERLAY_BOTTOM_GAP`

| Item | Value |
|---|---|
| Field name | `OVERLAY_BOTTOM_GAP` — overlay front reveal at the bottom |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formula `OVERLAY_SHUTTER_HEIGHT` = `H - OVERLAY_TOP_GAP - OVERLAY_BOTTOM_GAP`; `SHUTTER_OVERLAY.position.y` = `OVERLAY_BOTTOM_GAP` |
| Affected components | SHUTTER (overlay fronts); hinge requirements via fitting situation `doorHeight` |
| Affected formulas | `OVERLAY_SHUTTER_HEIGHT` |
| Affected drawings | Front Elevation; Panel Schedule |
| Affected manufacturing outputs | Cut list (shutters); edge-banding list (shutter left/right edges); finish quantity; hinge quantity and positions (hardware pick list, drilling / CNC program); board optimisation; panel labels; BOM and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 9. `FRONT_BETWEEN_GAP`

| Item | Value |
|---|---|
| Field name | `FRONT_BETWEEN_GAP` — gap between adjacent shutters |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formulas `OVERLAY_SHUTTER_WIDTH` and `INSET_SHUTTER_WIDTH`; `SHUTTER_OVERLAY.position.x`; `SHUTTER_INSET.position.x` |
| Affected components | SHUTTER (overlay and inset fronts); hinge requirements via fitting situation `doorWidth` |
| Affected formulas | `OVERLAY_SHUTTER_WIDTH`; `INSET_SHUTTER_WIDTH` |
| Affected drawings | Front Elevation; Panel Schedule |
| Affected manufacturing outputs | Cut list (shutters); edge-banding list; finish quantity; hinge drilling positions (drilling / CNC program, once modelled); board optimisation; panel labels; hardware pick list; BOM and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 10. `INSET_GAP`

| Item | Value |
|---|---|
| Field name | `INSET_GAP` — clearance between an inset front and the carcass opening on each side |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | Formulas `INSET_SHUTTER_WIDTH` and `INSET_SHUTTER_HEIGHT` = `INTERNAL_HEIGHT - 2*INSET_GAP`; `SHUTTER_INSET.position.x` = `T + INSET_GAP + i*(INSET_SHUTTER_WIDTH + FRONT_BETWEEN_GAP)`; `SHUTTER_INSET.position.y` = `T + INSET_GAP` (used only when `frontType` = INSET) |
| Affected components | SHUTTER (inset fronts); hinge requirements via fitting situation `doorWidth` / `doorHeight` |
| Affected formulas | `INSET_SHUTTER_WIDTH`; `INSET_SHUTTER_HEIGHT` |
| Affected drawings | Front Elevation; Panel Schedule |
| Affected manufacturing outputs | Cut list (shutters); edge-banding list; finish quantity; hinge quantity and positions (hardware pick list, drilling / CNC program); board optimisation; panel labels; BOM and price |
| Who provides / approves | Provide: Lintel production engineering (modular factory). Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |

### 11. `FRONT_FINISHED_FACES`

| Item | Value |
|---|---|
| Field name | `FRONT_FINISHED_FACES` — number of shutter faces that receive the front finish (0, 1 or 2) |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | count (faces) |
| Where used | `SHUTTER_OVERLAY.finish.faces`; `SHUTTER_INSET.finish.faces` → component `finishedFaces` → BOM `FINISH` area → pricing finish cost and finish wastage |
| Affected components | SHUTTER (overlay and inset fronts) |
| Affected formulas | None of the named recipe formulas; the shutter `finish.faces` expressions above |
| Affected drawings | Panel Schedule (finish specification); Front Elevation (finish notes) |
| Affected manufacturing outputs | Finish / laminate pressing list; board optimisation of laminate sheets; panel labels; BOM finish area and price |
| Who provides / approves | Provide: Lintel production engineering with design (finish specification). Approve: Lintel design lead and production lead (named approvers NULL / UNVERIFIED) |

---

## Additional construction parameters (identified during benchmark research)

Not part of the original 11-field list. Added because benchmark research (Infurnia treats "shutter back gap" as a
separate, configurable construction parameter) showed the recipe did not represent it. Values here are Lintel
production values and remain `NULL / UNVERIFIED`; the industry benchmark is recorded only in
[`KIT_BASE_STANDARD_BENCHMARK_V1.md`](KIT_BASE_STANDARD_BENCHMARK_V1.md).

### A1. `SHUTTER_BACK_GAP`

| Item | Value |
|---|---|
| Field name | `SHUTTER_BACK_GAP` — gap between the back face of an overlay shutter and the carcass front face |
| Current status | NULL / UNVERIFIED (standard DRAFT) |
| Current value | NULL |
| Unit | mm |
| Where used | `SHUTTER_OVERLAY.position.z` = `D + SHUTTER_BACK_GAP` (overlay fronts only; inset fronts have no back gap) |
| Affected components | SHUTTER (overlay fronts — depth position); cabinet envelope depth |
| Affected formulas | None of the named recipe formulas; the overlay shutter position expression above |
| Affected drawings | Side Section (front offset from carcass); Front Elevation unaffected (depth direction) |
| Affected manufacturing outputs | Hinge selection / mounting-plate choice and hinge drilling (hardware pick list, drilling / CNC program, once modelled); installation / assembly instructions |
| Who provides / approves | Provide: Lintel production engineering (modular factory), with the chosen hinge system. Approve: Lintel production lead and design lead (named approvers NULL / UNVERIFIED) |
| Classification | Construction value — front mounting dimension. Additional parameter, not one of the original 11 |

## Other production data required (not construction variables)

Tracked individually in [`production-data/`](production-data/):

- Edge-banding rules per component type and side — [`03-edge-banding-standards.md`](production-data/03-edge-banding-standards.md)
- Board / material and finish properties — [`02-board-material-standards.md`](production-data/02-board-material-standards.md)
- Verified Hettich records and calculation rules — [`04-hardware-standards.md`](production-data/04-hardware-standards.md)
- Dimensional limits — [`05-dimensional-limits.md`](production-data/05-dimensional-limits.md)
- Manufacturing standards — [`06-manufacturing-standards.md`](production-data/06-manufacturing-standards.md)
- Production rate card, pricing rules and quotation / tax policy — [`07-pricing-standards.md`](production-data/07-pricing-standards.md)
- Room planning standard (clearances, gaps, fillers, run length) — [`08-planning-standards.md`](production-data/08-planning-standards.md)
- Approval of product `KIT_BASE_STANDARD`, recipe `KITCHEN_BASE_STANDARD_V1` (including its listed
  assumptions) and hardware rule set `HINGE_STANDARD` — [`01-construction-standards.md`](production-data/01-construction-standards.md)
