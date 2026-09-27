# Design Studio (Phases D1-D6) — a deliberate product-direction pivot

Status: Slice 1 (base cabinet, 1-2 shutters) implemented. Slices 2-7 (drawer bank, shelves/internals, corner,
sink/appliance/pull-out, wall/tall, cabinet runs) are not yet built; `packages/cabinet-engine/src/library.ts`
lists every planned cabinet family and the slice that adds it.

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
elevation, save it, and generate its BOM. This is the definition of "Slice 1 is usable"; the next slice (drawer
bank + drawer fronts) begins immediately once it holds.
