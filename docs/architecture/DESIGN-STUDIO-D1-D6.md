# Design Studio (Phases D1-D6) — a deliberate product-direction pivot

Status: Slices 1-4 (base cabinet with 1-2 shutters; all-drawer base cabinet, 2/3/4 drawers; open-front base
cabinet with configurable loose shelves; L-corner cabinet pair) implemented. Slices 5-7
(sink/appliance/pull-out, wall/tall, cabinet runs) — and four of Slice 4's own five corner variants
(blind-corner, corner pull-out, corner drawer, corner sink) — are not yet built;
`packages/cabinet-engine/src/library.ts` lists every planned cabinet family and the slice that adds it.

## 1. Why this exists

After the V1 pilot workflow (`docs/architecture/M7-PILOT-UI.md`) was feature-frozen and staging deployment was
under way, the product direction changed: Lintel Design OS needed to be a real interior/cabinet design
environment, not a project/input/output shell with a single box-placement table. Deployment and
production-readiness work stopped; this pivot began instead. It is organised as explicit vertical slices, each
meant to be fully usable end to end before the next begins (Slice 1 → 2 → … → 7), not built all at once.

## 2. Deviation from the PRD's stated V1 scope

`docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md` §41 says: "Only implement: `KIT_BASE_STANDARD`... Do not implement
wardrobes before the base cabinet engine is proven." This pivot deliberately goes beyond that: the Cabinet
Library (`packages/cabinet-engine/src/library.ts`) names every cabinet family the product direction now calls
for — drawer banks, sink/hob/appliance/pull-out base cabinets, wall and tall cabinets, and five corner variants
— alongside the one already built. This is a conscious, scoped decision, not scope creep: every not-yet-built
family is listed as `PLANNED` with the exact slice that will add it, never presented as available, and never
given an invented product code, recipe or dimensions. Nothing is implemented ahead of its slice.

## 3. What Slice 1 changed

**`packages/cabinet-engine`** (Phase D1) is a new, pure package: the typed cabinet domain model
(`CabinetType`, `CabinetRecipe`, `CabinetInstance`, `CabinetFront`, `Shutter`, `Drawer`, `DrawerBank`,
`HardwareSet`, etc., `src/model.ts`) plus the Cabinet Library catalog (`src/library.ts`) and a two-way bridge to
the existing engine (`src/compile.ts`, `src/decode.ts`). No engine, persistence or API change was needed or
made: Slice 1's only cabinet type, `BASE_SHUTTER`, compiles to and decodes from the exact `KIT_BASE_STANDARD` /
`KITCHEN_BASE_STANDARD_V1` parameters `@lintel/design-engine` already resolves. A type reserved for a later
slice (`Drawer`, `Shelf`, `CornerConfiguration`, …) is refused at compile time (a thrown error) rather than
silently mis-mapped, until its slice lands.

**`apps/web`'s Design Studio screen** (Phase D6, `src/screens/DesignStudio.tsx`) replaces the old "Base
cabinets" table and "Preview" screens as the primary editing experience: a 3-pane layout (Cabinet Library ·
live 3D viewport with a plan/elevation/BOM bottom bar · Properties panel). It is still exactly a view over
`/api/v1` — every calculation comes from the API's engines, and Three.js (`src/screens/Viewport3D.tsx`) only
places and colours the boxes the API already resolved. The one new import allowance is
`@lintel/cabinet-engine` itself: `eslint.config.js`'s `apps/web` rule still forbids every other `@lintel/*`
package, engine, persistence and database code, with a single named exception for this one pure,
engine/persistence/react-free mapping package — reusing its typed model instead of duplicating the cabinet
domain model in the UI (CLAUDE.md, "Do not duplicate domain models in UI packages").

`apps/web/src/screens/Layout.tsx` and `Preview.tsx` are not deleted: their version-selection helpers
(`usablePins`, `pinnedProduct`) and drawing components (`Plan`, `Elevation`) are reused by the Design Studio
directly (now exported for that purpose), but neither screen is reachable from the main navigation any more.

## 4. Slice 1 acceptance test

A designer can, entirely through the browser (no JSON, database row, CLI command or code): create a design
version, add a base cabinet from the Cabinet Library, change its width/height/depth, change its front between
1 and 2 shutters and between overlay and inset, see the change reflected in the 3D viewport and the wall
elevation, save it, and generate its BOM. This is the definition of "Slice 1 is usable".

## 5. What Slice 2 changed

**`packages/cabinet-engine`**: `BASE_DRAWER_BANK` (`KIT_BASE_DRAWER` / `KITCHEN_BASE_DRAWER_V1`) moves from
`PLANNED` to a full `AVAILABLE` library entry, alongside `BASE_SHUTTER`. It compiles to and decodes from an
all-drawer carcass of 2, 3 or 4 equal-height drawers — a single-column row whose element is one `DrawerBank` of
stacked `Drawer`s, mirroring exactly how `BASE_SHUTTER` is a single-column row of `CabinetFront`.

The hardware model widened from a single hinge-shaped rule to a `HINGE`/`MOUNTING_PLATE` vs `RUNNER`
discriminated union (`application: "HINGED_DOOR" | "DRAWER"`), threaded through `@lintel/types`,
`@lintel/design-engine`, `@lintel/catalog-engine`, `@lintel/hettich-engine` and `@lintel/persistence` — a
drawer runner rule now validates, resolves and persists through the exact same paths a hinge rule already did,
rather than a parallel drawer-only code path.

Every deliberate simplification for this slice (drawer box always positioned as if inset regardless of the
front's overlay/inset choice; box sides/back/bottom reuse the carcass/back material roles; no separate
structural drawer-box front panel — the visible front is the box's own front wall) is documented in
`KITCHEN_BASE_DRAWER_V1`'s own `assumptions` array in `packages/catalog-engine/src/data/kit-base-drawer.ts`, not
repeated here.

## 6. Slice 2 acceptance test

A designer can, entirely through the browser: add a drawer-bank cabinet from the Cabinet Library, see a
"Drawer count" property (2/3/4) in place of the shutter cabinet's "Front" control, change its drawer count and
width, see the change reflected in the 3D viewport and the wall elevation (stacked drawer fronts, top to
bottom), save it, and generate a BOM whose resolved hardware includes drawer runners. This is the definition of
"Slice 2 is usable".

## 7. What Slice 3 changed

**`packages/catalog-engine`**: a new `KIT_BASE_OPEN` product and `KITCHEN_BASE_OPEN_V1` recipe — the exact same
carcass and loose-shelf mechanism as `KITCHEN_BASE_STANDARD_V1` (sides, bottom, back, top rails, evenly spaced
`SHELF` components; no new construction-variable codes, since all five it needs were already registered for
the shutter recipe), with the shutter front dropped entirely: no door, no hinge, no front board or finish.
`hardwareRuleSetId` names a rule set with zero rules (`OPEN_STANDARD`) — a database `hardware_rule_set` has
never required at least one `hardware_rule`, so this needed no schema change, and unlike Slice 2 (nullable
mounting columns, new construction-variable rows, widened `hettich_article`/`hettich_calculation_rule` CHECK
constraints) **Slice 3 shipped no new migration at all**.

**`packages/cabinet-engine`**: `Shelf` (D4, previously reserved) is wired end to end for `BASE_OPEN` — decoded
from `SHELF` components into `CabinetInstance.internals`, compiled back into a `shelfCount` parameter. It is
deliberately *not* also wired for `BASE_SHUTTER`, even though `KITCHEN_BASE_STANDARD_V1` has always produced
`SHELF` components (via its own `shelfCount` parameter, never exposed as a Properties control since Slice 1):
`decode.ts`'s shelf decoding is gated on `productCode === "KIT_BASE_OPEN"`, not "does this object have SHELF
components", because a shutter cabinet's `compile.ts` path still refuses any `internals` — decoding shelves
there too would make a shutter cabinet's own save recompile a `shelfCount` Slice 1 never intended to carry.
Widening shutter-cabinet shelf editing to match is a scope decision for a later slice, not implied by this one.

A resolved `BASE_OPEN` object shows a nonzero `ERROR` count (`STANDARD_UNKNOWN_VARIABLE`, one per
construction-standard variable this recipe doesn't declare) because the rehearsal construction standard is one
shared bag covering the union of every recipe's variables (`validateStandard()` requires an exact declared-set
match per recipe, not a superset-tolerant one) — exactly the same characteristic Slice 2's drawer cabinet
already showed at a smaller scale (2 unknown variables there vs. 10 here, since `BASE_OPEN` declares far fewer
of the union's variables than a drawer or shutter cabinet does). It is `ERROR` severity but never `BLOCKER`:
`canApprove` stays `true` and BOM generation is unaffected.

## 8. Slice 3 acceptance test

A designer can, entirely through the browser: add an open-front cabinet from the Cabinet Library, see a "Shelf
count" property in place of a "Front"/"Drawer count" control (and no "Overlay" control at all — there is no
door), change its shelf count and width, see the change reflected in the 3D viewport and the wall elevation (an
open carcass with evenly spaced shelf lines, no door), save it, and generate a BOM that includes `SHELF` panels
and no hinge or runner hardware. This is the definition of "Slice 3 is usable".

## 9. What Slice 4 changed

**The architectural question Slice 4 exists to answer** (`model.ts`'s `CornerConfiguration` doc comment): is an
L-corner cabinet one composite object, or two coordinated `CabinetInstance`s? `@lintel/geometry-engine` supports
only axis-aligned boxes with one `rotationY` per whole object (confirmed by direct inspection of
`design-engine/room.ts` and `geometry-engine/room.ts`: every component of an object is placed through that one
`Transform`, and rotation about X/Z is refused outright) — an L-shaped carcass cannot be one object's component
set under this geometry model. Slice 4 therefore authors a corner cabinet as **two ordinary
`CabinetInstance`s** (ordinary `BASE_SHUTTER` cabinets, reusing `KIT_BASE_STANDARD`/`KITCHEN_BASE_STANDARD_V1`
exactly as Slice 1 built them — no new catalog-engine product, recipe or database migration), positioned so
their footprints meet exactly at a room corner without overlap. This reuses the engine's own `CORNER`
relationship (`design-engine/room.ts`'s `CORNERS` loop), already derived — read-only, informational — for any
two objects near a room corner since before this slice existed; recognising a corner pair needed no engine
change, only correct placement from the authoring side.

`packages/cabinet-engine/src/corner.ts`'s `cornerPairPlacementDA` is the placement math: the return leg sits
against wall D (`rotationY: 90`) with its footprint hugging the D-A room corner, and the front leg sits against
wall A (`rotationY: 0`) starting exactly where the return leg's depth ends — touching (`planDistance` between
the two envelopes is 0), never overlapping, so `OBJECT_COLLISION` (a BLOCKER) never fires. Both legs must use
`overlay: "INSET"`: an overlay front sits `SHUTTER_BACK_GAP` proud of its own carcass depth, which — for any
real construction-standard value — is enough to make the return leg's shutter collide with the front leg's
side panel; an inset front never projects past the carcass depth it was measured against, so the fix holds
regardless of what that gap value turns out to be.

**V1 scope: only the room's D-A corner.** `packages/cabinet-engine/src/library.ts` gains one new
`CabinetLibraryEntry` availability kind, `AVAILABLE_CORNER_PAIR` (a `cabinetType` used twice, not a new
`CabinetType`), for exactly one entry, `CORNER_L`. Generalising to the other three room corners (A-B, B-C, C-D)
is a straightforward, real follow-up using the same `wallFrame` axes (`@lintel/geometry-engine`) — not
implemented here because only this one geometry has been verified end to end; the other four corner variants
(blind-corner, corner pull-out, corner drawer, corner sink) remain `PLANNED`, exactly as Slice 2 left two
drawer/shutter variants `PLANNED` alongside its own one shipped type.

## 10. Slice 4 acceptance test

A designer can, entirely through the browser: click "+ Add pair" on the L-corner Cabinet Library entry and get
two ordinary base cabinets placed at the room's D-A corner in one action, see both in the 3D viewport and the
Plan view meeting at the corner with **0 BLOCKER** (no `OBJECT_COLLISION`), and generate a BOM for the design
with 0 BLOCKER. This is the definition of "Slice 4 is usable"; the next slice (sink/hob/appliance/pull-out base
cabinets) begins immediately once it holds.
