# Design Studio Slice 5 — special cabinets (design pass only, no implementation)

Status: **design research, not implemented**. This document is the design checkpoint requested before any
Slice 5 code is written. It does not modify `packages/cabinet-engine/src/library.ts`'s `PLANNED` entries for
`BASE_SINK`, `BASE_HOB`, `BASE_APPLIANCE`, `BASE_PULLOUT`, `TALL_OVEN_TOWER`, `TALL_MICROWAVE_TOWER`.

Companion regression note: before this design pass, a targeted Slice 2 (drawer bank) browser regression was
run against a live `pilot:demo` — 900mm cabinet, 3→4 drawers, save, forced server re-fetch, BOM diff. All of
it passed with no drawer-architecture change needed. One real gap was found and is recorded here rather than
silently worked around: **there is no per-drawer selection/height-override UI or engine parameter today** —
`Drawer.heightMm`/`Drawer.index` exist in `packages/cabinet-engine/src/model.ts`'s authoring-side domain model,
but `KITCHEN_BASE_DRAWER_V1` (`packages/catalog-engine/src/data/kit-base-drawer.ts`) has no per-drawer height
parameter; every drawer's height is always the recipe's own `DRAWER_ROW_HEIGHT` (an equal split). This is a
scope gap from Slice 2, not a defect, and is out of scope for this document; it is noted here so it is not
lost.

## 0. What already exists, precisely (no assumptions)

Every claim below was confirmed by reading the source, not inferred, because Slice 5's whole purpose is to
avoid inventing an engine capability that isn't there.

| Question | Answer | Where |
|---|---|---|
| Is there an `Appliance` type or catalog today? | No. `CatalogSnapshot` has exactly `products, recipes, materials, finishes, edgeBands, hardwareRuleSets` — no appliances array, no `Appliance` type anywhere in `@lintel/types`. | `packages/types/src/catalog-snapshot.ts:8-16` |
| Is "appliance" referenced *anywhere* in the schema? | Yes, as an inert placeholder only: `appliance_catalog_version_id` is a nullable FK column on `design_version`, every snapshot table, and `DependencyPin`. No engine reads it. `apps/db-tools/src/intake/spec.ts` explicitly documents it as "no appliance domain model exists yet." | `packages/persistence/src/provenance.ts:59`; `database/migrations/0006_rooms_designs.up.sql:74,94`; `docs/architecture/M5-TECHNICAL-DESIGN.md:213,375` |
| Can geometry represent a hole/notch in a panel? | No. `Box3` is one axis-aligned rectangular prism (min + size); every `CabinetComponent` is exactly one such box. There is no boolean/CSG geometry anywhere in `@lintel/geometry-engine`. | `packages/types/src/component.ts` (`Box3`); `packages/geometry-engine/src/index.ts` |
| Is `ComponentType` an open or closed set? | **Closed literal union**, PRD §16. Adding any new component type (a cutout surround, an appliance bay marker) is a type change in `@lintel/types`, exactly like Slice 2 adding `DRAWER_BOX_SIDE` etc. | `packages/types/src/component.ts:4-23` |
| Can a component be conditionally included? | Yes — `ComponentTemplate.when` is a boolean formula string; the engine skips the whole template when false. | `packages/types/src/product.ts:85`; `packages/design-engine/src/components.ts:82-89` |
| Is there a boolean parameter kind? | No — only `number, integer, enum, material, finish`. A boolean gate is expressed as an `enum` (exactly how `KITCHEN_BASE_DRAWER_V1` gates `DRAWER_FRONT_OVERLAY`/`_INSET` by `frontType`), referenced from a template's `when`. | `packages/types/src/product.ts:51-56` |
| Edge-band granularity | Per `(ComponentType × EdgeSide)`. `{}` for a component type means "explicitly no banding" (zero edges, no error); an **absent** component-type key means "not yet defined" (BLOCKER). | `packages/types/src/product.ts:144,146`; `packages/design-engine/src/components.ts:164-186` |
| BOM item shape | Closed union of exactly 5 `kind`s: `PANEL, BOARD, EDGE_BAND, FINISH, HARDWARE` — all derived from a `CabinetComponent` or a `HardwareRequirement`. No `kind` represents an appliance or a cutout as such. | `packages/types/src/bom.ts` |
| Drawing engine genericity | `elevation.ts`'s `layoutFrontView` is fully generic over any `componentType` string via `opts.exclude/labelTypes/chainTypes` — a new type renders with zero engine change, opts-only. `section.ts`'s `layoutSideSection` renders any component generically too, but has **hardcoded** `"SHUTTER" \|\| "DRAWER_FRONT"` literals for cut-plane defaulting and front/carcass classification — a genuinely new front-like type needs those literals extended. | `packages/drawing-engine/src/elevation.ts:33-87`; `packages/drawing-engine/src/section.ts:37,78,83` |
| Hardware category enum | Closed: `"HINGE" \| "MOUNTING_PLATE" \| "RUNNER"`. Widening it again touches the same multi-file surface Slice 2 touched (`@lintel/types`, `design-engine/hardware.ts`, `catalog-engine/validate.ts`, `hettich-engine`, `persistence`, `db-tools/schemas.ts`, generated OpenAPI/client). | `packages/types/src/hardware.ts:5` |

**The single most consequential fact above**: geometry is boxes only, and `ComponentType` is closed. Any design
that assumes free-form hole cutting in 3D is designing against a geometry engine that does not exist and would
require a genuinely new geometry primitive (see §3, Option A) — which is exactly the "temporary hack" this
document is asked to avoid.

## 1. Domain model

Four different real-world things are being lumped together in casual conversation as "special cabinets."
**They are not the same shape of problem** and must not share one domain type.

```text
SinkCabinet          — a construction-RECIPE variant (packages/catalog-engine).
                        No cutout belongs to the cabinet carcass itself.
HobCabinet            — a construction-RECIPE variant, PLUS a reference to an Appliance,
                        PLUS a CutoutFeature that belongs to the (not-yet-built) countertop/worktop object,
                        not to the cabinet.
ApplianceCabinet      — a construction-RECIPE variant whose internal component set leaves a
                        parametrically-sized void (via `when`-gated omission), PLUS a reference
                        to an Appliance occupying that void.
PullOutCabinet        — architecturally a sibling of the drawer bank (Slice 2), not a cutout
                        concept at all: carcass + front + internal frame/basket + runner hardware.
```

New shared vocabulary (`@lintel/cabinet-engine`, mirroring the existing reserved-type pattern in
`model.ts` — `Shelf`, `Divider`, `PullOut`, `ApplianceBay`, `CornerConfiguration` are already declared there,
reserved for exactly this slice):

```text
Appliance                       (independent of any cabinet — see §5)
├── applianceId
├── category               ("HOB" | "OVEN" | "MICROWAVE" | "DISHWASHER" | "REFRIGERATOR" | "SINK")
├── manufacturer
├── model
├── widthMm / heightMm / depthMm       (the physical unit)
├── installation: InstallationEnvelope (the opening/cavity the unit needs — see §6)
└── frontAlignment                    ("FLUSH" | "RECESSED" | "PROUD", null until known)

CutoutFeature                   (semantic — geometry is a DERIVED OUTPUT, never authored directly — see §3/§4)
├── cutoutId
├── target                 (what surface it belongs to: "COUNTERTOP" | "CABINET_TOP" | "CABINET_BACK" …)
├── shape                  ("RECTANGLE", the only shape any cabinet in this repository needs for V1)
├── widthMm / depthMm
├── position               ({ xMm, zMm } within the target surface's own local frame)
├── cornerRadiusMm          (null until a real value is sourced — never invented, per CLAUDE.md)
├── clearance: ClearanceRule[]        (see §6)
├── sourceApplianceId       (the Appliance this opening exists for, or null for a purely structural cutout)
└── edgeTreatment           (per `EdgeSide` of the opening — see §7; null until sourced, exactly like every
                              other edge-band value in this repository)

ApplianceBay                    (already reserved in model.ts:145-149 — widen its use, do not redesign it)
├── applianceBayId
├── applianceKind           (existing field)
└── cutout: { widthMm, heightMm, depthMm }   (existing field — the CLEARANCE-INCLUSIVE bay envelope,
                                              not the appliance's own raw dimensions)
```

`CutoutFeature` and `Appliance` are **cabinet-engine / authoring-side domain concepts** (like `Shelf`,
`DrawerBank` already are) — they describe intent. They are not new `ComponentType`s and not new geometry
primitives by themselves; §3-§4 defines exactly how each one becomes real geometry, BOM, and edge-band data
where a real physical thing exists.

## 2. Object relationships

```text
DesignObject (BASE_CABINET, existing objectType — no new objectType needed for any of the four)
  └── resolved via a construction recipe (existing mechanism)
        └── components: CabinetComponent[]                (existing — solid boxes only)
        └── hardwareRequirements: HardwareRequirement[]    (existing)

Appliance                                    (NEW top-level reference-data entity, own catalog/version,
                                               exactly parallel to `material`/`finish`/`hardware_rule_set`
                                               today — NOT nested inside a product definition)
  └── referenced BY a DesignObject, the same way a DesignObject already references its exact
      product/recipe version (a new `applianceVersionId` pin on the object, analogous to
      `productVersionId` — NOT a new relationship type; `RelationshipType` in `packages/types/src/room.ts`
      stays untouched, this is an object-to-reference-data link like every other pin)

CutoutFeature (COUNTERTOP target)            (belongs to a FUTURE countertop/worktop DesignObject that
                                               does not exist yet in this repository — Slice 5 defines the
                                               vocabulary now so the countertop system, whenever built,
                                               does not have to invent its own competing one)

CutoutFeature (CABINET_TOP target, appliance bay case)
  └── realized as an ABSENCE of specific component templates (the tall cabinet's own TOP/shelf
      templates simply have `when: "NOT(bay_occupied)"` for the bay's height range) — never a boolean
      subtraction on an existing solid box.
```

No new `RelationshipType` is needed. The existing `CORNER`/`AGAINST_WALL`/`SAME_WALL_RUN` derived
relationships (`design-engine/room.ts`) already handle "this object sits next to that one"; an appliance
cabinet and a countertop cutout are linked by **reference (a pin), not a spatial relationship** — the same way
a `DesignObject` is already linked to its exact product version, not spatially inferred.

## 3. Cutout architecture — options compared

**Option A — boolean geometry subtraction.**
Requires a genuinely new geometry primitive (CSG) that does not exist anywhere in `@lintel/geometry-engine`
today (confirmed §0: every component is one axis-aligned `Box3`). Every downstream consumer — BOM (`kind:
"PANEL"` assumes one rectangular board), edge-banding (`edgeLength` assumes one rectangle's four sides),
drawing (`projectBox` assumes a box) — would need a parallel non-rectangular code path. This is precisely the
"temporary geometry hack that becomes impossible to change later" the brief warns against: it invents a second
geometry kind that every engine must special-case forever. **Rejected.**

**Option B — parametric opening/cutout feature on a panel (semantic, geometry as output).**
The cutout is authored as data (`CutoutFeature`, §1) — a rectangle, a position, a clearance — attached to a
*target surface* (a countertop, a cabinet top). Nothing about the panel's own solid geometry changes: the panel
is still one rectangular `CabinetComponent`, drawn as a solid box in 3D/section exactly as today. The opening
is rendered as an **annotation** in 2D (a dashed rectangle + dimension callouts, plan and elevation) and, for a
future countertop system, potentially as an actual smaller decomposition when that system is built (see Option
C for when decomposition is the right call). This keeps every existing engine untouched for the common case and
adds one new, narrow, additive concept.

**Option C — panel decomposition into real, solid surround/surrounding components.**
Where a physical void genuinely must exist for something to sit in it (the appliance-bay case, not the
countertop-hole case), decompose the carcass into the components that are actually really there: e.g. a tall
cabinet's fixed shelf above and below the oven bay, its side panels running full height, and simply **no**
shelf/back panel across the bay's own height range. This is not a new mechanism — it is the *exact* mechanism
`ComponentTemplate.when` already provides (§0), used exactly the way `KITCHEN_BASE_DRAWER_V1` already uses it.
Every resulting component is a real, solid, edge-banded, BOM-visible board — nothing invented.

**Option D — hybrid.**
**This is the recommendation.** Use Option C wherever a cabinet's own carcass must structurally leave a void
(appliance bay: §1's `ApplianceBay`, already reserved for this). Use Option B wherever the opening belongs to a
*different* object than the cabinet carcass — a countertop hole for a sink or hob is not a hole in any cabinet
component at all; the cabinet underneath is an ordinary (if adapted) base cabinet, and the hole is purely a
countertop-system concern that Slice 5 does not have to solve, only name (§1's `CutoutFeature` with
`target: "COUNTERTOP"`). Never Option A.

| | 3D geometry | 2D drawings | BOM | Edge-band | Persistence | Later CNC | Manufacturability | Editable dims | Appliance-compatible |
|---|---|---|---|---|---|---|---|---|---|
| A (boolean) | New CSG engine, weeks of work | New non-box renderer everywhere | New `kind`, breaks existing panel assumption | Undefined — no rectangle to band | New non-rectangular schema | Actually *closer* to real CNC (routers cut holes), but only once A is fully built | High risk of geometrically-invalid output | Hard — re-run CSG | No inherent benefit — still needs a semantic model on top |
| B (parametric, opening as annotation) | Unchanged — real components still boxes | New: draw the opening as annotation | Unchanged for the cabinet; countertop's own future BOM item is separate | Cutout's own edges get their own `EdgeRule` per `ComponentType` (a new type, e.g. a countertop-cutout-surround type used only if physically decomposed) | One new small entity (`CutoutFeature`), additive | CNC needs real geometry eventually — B defers that to whichever system finally owns countertops | Zero risk to existing engines | Trivial — it's just numbers | Yes — `sourceApplianceId` is exactly the join point |
| C (decomposition) | Real components, reuses existing box model | Reuses existing generic rendering (`elevation.ts`, confirmed §0) fully automatically | Real `PANEL` items, no new `kind` needed | Real `ComponentType`s, real `EdgeRule`s, no ambiguity | No schema change (recipe data only) | Straightforwardly CNC-ready — it's ordinary panels | Zero risk — it's literally what Slice 1-4 already do | Change the gating parameter/formula, same as changing `N_SHELF` today | Bay size comes from `Appliance.installation`, a clean input |
| **D (hybrid, recommended)** | Unchanged | Both of the above, each where it belongs | Unchanged + real panels where real | Unchanged + real rules where real | One new small entity + ordinary recipe data | Deferred correctly to whichever system needs it, not forced early | Lowest risk | Trivial where B applies, ordinary where C applies | Yes, uniformly |

## 4. Recommended architecture (detail)

**A. Sink cabinet — recipe variant, no cutout on the cabinet.**
New recipe (e.g. `KITCHEN_BASE_SINK_V1`), reusing the exact carcass component set Slice 1 already has (sides,
bottom, back, front/back top rails), with:
- The **rear top rail may be reduced or omitted** (an existing `ComponentTemplate.when`-style choice, not a new
  mechanism) to leave plumbing/waste-trap clearance — a real, named construction assumption, documented in the
  recipe's own `assumptions` array exactly like `KITCHEN_BASE_DRAWER_V1` documents its own simplifications.
- An internal configuration parameter (`internalConfig: enum`, values e.g. `"OPEN" | "WASTE_BIN"`) gating an
  optional internal frame/tray component set — same `when`-gating mechanism as everything else in this repo.
- `CutoutFeature { target: "COUNTERTOP", sourceApplianceId: null }` is recorded against the **future countertop
  object**, referencing this cabinet's own position for placement purposes only — the cabinet carcass itself
  needs no new `ComponentType` and no BOM change beyond the recipe's own new components.
- Hardware: none beyond what a plain base cabinet already needs (no new `HardwareCategory`).

**B. Hob cabinet — recipe variant + Appliance + countertop CutoutFeature.**
New recipe (e.g. `KITCHEN_BASE_HOB_V1`):
- Likely omits or restricts the top area/shelf directly under the hob (ventilation, appliance body clearance)
  — again `when`-gated, not boolean-subtracted.
- References one `Appliance` (`category: "HOB"`) — the hob's own footprint/clearances come from the
  `Appliance`, never invented per-recipe.
- The actual worktop hole is, once again, a `CutoutFeature { target: "COUNTERTOP", sourceApplianceId: <hob> }`
  — conceptually owned by the countertop system, not the cabinet.
- Ventilation clearance is one `ClearanceRule` (§6) attached to the `Appliance`, checked by validation the same
  way `SERVICE_VOID_BELOW_MINIMUM` already checks a wall clearance today (`design-engine/room.ts:244`) — same
  BLOCKER/WARNING severity mechanism, new rule content only.

**C. Appliance cabinet (oven tower etc.) — Option C decomposition + Appliance reference.**
New recipe(s) (e.g. `TALL_OVEN_TOWER_V1`): a tall-cabinet carcass whose shelf/partition templates are
`when`-gated to leave a void exactly sized to `Appliance.installation` (§5/§6) plus the appliance's own
clearances. This *is* `ApplianceBay` (already reserved in `model.ts`) — no redesign, just implementation. The
appliance itself is never a `ComponentType`/`CabinetComponent` (it is not a board Lintel manufactures) — it is
referenced data, resolved and shown the same conceptual way a Hettich hinge article is resolved and shown
today (a reference, not a panel).

**D. Pull-out cabinet — reuse the drawer-bank architecture, not a cutout concept at all.**
Structurally: `carcass (existing) + front (existing Shutter or a dedicated pull-out front) + internal
frame/basket (new small ComponentType set, e.g. `PULLOUT_FRAME_SIDE`/`PULLOUT_TRAY`, generated with the exact
same `i`-indexed mechanism `DRAWER_BOX_SIDE` already uses) + RUNNER hardware (existing `HardwareCategory`,
zero new hardware-model work — Slice 2 already built `RUNNER`)`. This is the *cheapest* of the four to build:
it needs a new recipe and 2-3 new `ComponentType`s, and nothing else in §0's table changes state (edge-band,
BOM, drawing, hardware are all already generic).

## 5. Appliance model

```ts
interface Appliance {
  readonly applianceId: string;
  readonly category: "HOB" | "OVEN" | "MICROWAVE" | "DISHWASHER" | "REFRIGERATOR" | "SINK";
  readonly manufacturer: string;
  readonly model: string;
  readonly widthMm: Millimetres;
  readonly heightMm: Millimetres;
  readonly depthMm: Millimetres;
  readonly installation: InstallationEnvelope;   // see §6 — the opening the appliance needs, not its own size
  readonly ventilation: ClearanceRule[] | null;   // §6
  readonly frontAlignment: "FLUSH" | "RECESSED" | "PROUD" | null;   // null until sourced
}
```

This is deliberately **independent of any cabinet**, a first-class reference-data entity parallel to
`material`/`finish`/`hardware_rule_set` (own `appliance` + `appliance_catalog` intake types — the DB already has
placeholder columns for exactly this, §0). It is **not** nested in a `ProductDefinition`: a cabinet references
an appliance by id/version, the same way it references a material by catalog code, never by embedding appliance
data inline. This connects cleanly, later, to the already-reserved `appliance_catalog_version_id` pin and to a
manufacturer-adapter pattern exactly like `@lintel/hettich-engine`'s (an `ApplianceRecord` → `toEngineArticle`
style adapter would be a natural, but explicitly *not-this-slice*, follow-up).

**Every field stays `null`/`TEST_FIXTURE` until Lintel supplies real values** — the same discipline already
applied to construction/edge-band/pricing standards throughout this repository. No real appliance dimensions are
invented in this document or in any Slice 5 implementation; only synthetic `TEST_FIXTURE` values are used for
development, exactly like `TEST_FIXTURE_HETTICH_DATASET` today.

## 6. Clearance model

A generic rule, reusable across zones:

```ts
interface ClearanceRule {
  readonly ruleId: string;
  readonly zone: "INSTALLATION" | "VENTILATION" | "STRUCTURAL_EXCLUSION";
  readonly axis: "TOP" | "BOTTOM" | "LEFT" | "RIGHT" | "FRONT" | "BACK";
  readonly minMm: Millimetres | null;     // null = not yet sourced (never invented)
  readonly maxMm: Millimetres | null;     // null = no upper bound
}

interface InstallationEnvelope {
  readonly widthMm: Millimetres;    // opening width, already clearance-inclusive
  readonly heightMm: Millimetres;
  readonly depthMm: Millimetres;
  readonly clearances: readonly ClearanceRule[];
}
```

This feeds every consumer the brief names, through mechanisms that **already exist** and need content, not new
plumbing:
- **Validation**: a new rule class alongside the existing `SERVICE_VOID_BELOW_MINIMUM`-style checks
  (`design-engine/room.ts`), same BLOCKER/WARNING severities, same `roomMsg`/message-array mechanism.
- **3D / 2D**: the envelope directly sizes the `when`-gated void (Option C) or the annotated opening
  (Option B) — no separate clearance-specific rendering path.
- **BOM/BOQ**: clearance itself is never a BOM line (it is not a manufactured thing); it only constrains the
  dimensions of real components that *are* BOM lines.

## 7. Edge-band implications

Confirmed mechanism (§0): edge-banding is per `(ComponentType × EdgeSide)`, and `{}` (defined-but-empty) differs
from absent (undefined → BLOCKER). Implications per option:

- **Option C components** (appliance-bay shelves, pull-out frame pieces) are ordinary new `ComponentType`s: each
  needs its own `EdgeRule` entry in whatever `EdgeRuleSet` its recipe's `edgeRuleSetId` names — exactly the
  precedent Slice 2 set with `DRAWER_CARCASS_STANDARD` (a recipe's edge rule set must be fully self-contained,
  `packages/catalog-engine/src/validate.ts`'s `STANDARD_UNKNOWN_COMPONENT_TYPE` check already enforces this).
- **Option B openings** (a countertop hole) may, when the countertop system is eventually built, decompose into
  real surround components (front strip, side strips) with their own newly-*exposed* edges from having been cut
  — those get ordinary new `ComponentType` + `EdgeRule` entries too, at that time. Until the countertop system
  exists, there is no real edge to band, so nothing is invented now.
- **A cutout's edge treatment lives on `CutoutFeature.edgeTreatment`** (§1) as a forward-compatible field, `null`
  until the countertop system is built and can supply real per-side values — never guessed now.

## 8. BOM/BOQ implications

Per the brief's own breakdown, using only mechanisms that already exist (§0 confirms BOM has exactly 5 `kind`s
and no appliance/cutout kind):

- **Sink**: cabinet's own `PANEL`/`EDGE_BAND`/`FINISH` items (unchanged mechanism) + any new internal
  configuration's real components, same way. No new BOM `kind`.
- **Hob**: cabinet's own components (unchanged mechanism) + **one new `HardwareBomItem`-shaped `kind`
  addition is NOT proposed** — an appliance is not hardware. A hob line item needs a **6th BOM `kind`,
  `"APPLIANCE"`**, carrying `applianceId`, `manufacturer`, `model` — deliberately narrow, additive, and the one
  place this document proposes touching `packages/types/src/bom.ts`'s closed union. This is a real, scoped
  engine change (not a hack) that must happen for *any* of the four cabinets to show their appliance in a BOM,
  so it belongs to Slice 5's actual implementation, not deferred.
- **Appliance (oven tower)**: cabinet's own real Option-C components (unchanged mechanism) + one `"APPLIANCE"`
  BOM item for the oven itself.
- **Pull-out**: cabinet's own components (unchanged mechanism, new `ComponentType`s per §4D) + `HardwareBomItem`
  for the runner pair (already-existing mechanism, zero change — Slice 2 built this).
- **BOQ** (a client-facing quantity/description view, kept separate from BOM per this repo's own stated
  principle) needs the same one addition: a BOQ line description generator for the `"APPLIANCE"` kind,
  mirroring how it already handles `PANEL`/`HARDWARE` today.

## 9. Drawing implications

- **Plan**: `Plan` (`apps/web/src/screens/Preview.tsx`) already draws every object generically from its
  envelope — a hob/sink cabinet needs no plan-view change to be visible. Making it *identifiable* as a hob/sink
  (not just an unlabelled box) is a small, additive label/icon keyed off `cabinetType.cabinetTypeId`, not an
  engine change.
- **Wall elevation / cabinet elevation**: confirmed generic (`elevation.ts`, §0) — a new component type renders
  automatically; to be *labelled* (like `SHUTTER`/`DRAWER_FRONT` are today) it is simply added to
  `layoutElevation`'s `labelTypes`/`chainTypes` arrays — a one-line, additive change per new type, not a
  redesign.
- **Cabinet section**: confirmed **not** fully opts-driven (§0) — `section.ts`'s hardcoded `"SHUTTER" ||
  "DRAWER_FRONT"` literals for cut-plane defaulting and front/carcass classification need extending for any new
  front-like type (an appliance-bay front, a pull-out front). This is a real, scoped, small change flagged
  honestly rather than assumed away.
- **Internal elevation**: reuses the same `layoutFrontView` with fronts excluded (already generic) — no change.
- **Countertop/worktop drawing**: does not exist in this repository today. `CutoutFeature` is defined now
  (§1/§3 Option B) specifically so that whenever a countertop system is built, it has a ready-made vocabulary
  for "here is a hole, here is why" instead of inventing one under time pressure.

## 10. UI implications

Per the brief's own proposed grouping — implemented as **library/category data only**, never a
per-appliance-type bespoke workflow (the existing `CabinetLibraryPanel`/`PropertiesPanel` dispatch-by-
`productCode` pattern from Slices 1-4 already generalizes to N types with zero new UI *mechanism*, only new
`case`s):

```text
BASE
  Standard (Slice 1)      Drawer (Slice 2)      Open (Slice 3)
  Sink (Slice 5)           Hob (Slice 5)          Pull-Out (Slice 5)
TALL
  Oven tower (Slice 5)     Microwave tower (Slice 5)     [Pantry/Utility remain PLANNED]
CORNER
  L-corner (Slice 4)       [Blind/Pull-out/Drawer/Sink corners remain PLANNED]
```

A designer drags/clicks any of these into the room and configures it through the **same** `PropertiesPanel`
model already established: width/height/depth (existing), plus whichever of "Drawer count" / "Shelf count" /
a new "Appliance" select / a new "Internal configuration" select applies — dispatched by `productCode`,
precisely as `isDrawer`/`isOpen` already dispatch today (`apps/web/src/screens/DesignStudio.tsx`). No separate
screen, no separate save flow, no per-appliance bespoke component tree.

## 11. Migration implications

Unlike Slices 2-4 (Slice 2 needed one migration; Slices 3-4 needed none), Slice 5 **will** need real schema
work, because it introduces a genuinely new reference-data family, not just new recipe data:

- A new `appliance` + `appliance_catalog` intake type pair, following the exact established pattern (own
  entity/version tables via `install_version_envelope`, own author/approve action permissions) — the DB schema
  literally already reserves the *catalog version pin* columns (§0); it does not yet have the `appliance`/
  `appliance_version`/`appliance_catalog`/`appliance_catalog_version` tables themselves, which this slice must
  add, mirroring migration `0004_catalogs.up.sql`'s existing `material`/`finish`/`hardware_rule_set` pattern
  exactly.
- `ComponentType` widened (`@lintel/types`) for whatever new component types §4 introduces (appliance-bay
  shelves, pull-out frame pieces) — a type-only change, but one that (per Slice 2's own precedent) cascades
  into `apps/db-tools/src/intake/schemas.ts`'s Zod mirror and its `SCHEMAS_MATCH_DOMAIN_TYPES` drift guard.
- `BOMItem`'s `kind` union widened by exactly one member, `"APPLIANCE"` (§8) — persistence mappers, OpenAPI,
  and the generated web client all regenerate from this, same mechanical cascade Slice 2's `HardwareCategory`
  widening already went through.
- No change to `RelationshipType`, no change to the geometry engine, no change to `objectType` (`BASE_CABINET`
  remains the only value — an appliance cabinet is still a base/tall cabinet object, not a new object kind).

## 12. Future CNC implications

Because Option C (decomposition into real, solid, rectangular components) is the load-bearing mechanism for
every case that needs a real physical void, **every component this slice produces is already CNC-shaped** —
ordinary rectangular boards with ordinary edge-band data, exactly like every component Slices 1-4 already
produce. Nothing about Slice 5 introduces a shape a router/CNC line cannot already cut. The one deferred piece
(a countertop hole, Option B) is explicitly *not* solved here, and explicitly not faked as solved — when a
countertop/worktop manufacturing path is eventually built, `CutoutFeature`'s existing fields (`shape, widthMm,
depthMm, position, cornerRadiusMm, edgeTreatment`) are already the right shape of input for a router toolpath,
without this slice having guessed at toolpath detail it has no authority to invent.

## 13. Risks

1. **Scope bleed into a real countertop system.** Sink/hob cabinets *feel* like they need a worktop cutout now;
   the discipline of §4A/§4B (the cutout belongs to a future countertop object, not this cabinet) must hold, or
   Slice 5 quietly grows into "Slice 5 + an unplanned countertop feature."
2. **`section.ts`'s literals** (§0/§9) are the one place genuine drawing-engine code (not just opts) must
   change — likely to be underestimated relative to `elevation.ts`'s fully generic path.
3. **The one-time `BOMItem.kind` widening** (§8) is the one real, closed-union break in this design, exactly
   analogous to Slice 2's `HardwareCategory` widening — it must be planned as its own small, first PR of the
   slice (schema/type change alone, fully tested), before any recipe work lands on top of it, so it doesn't
   get tangled with four cabinets' worth of recipe changes in one commit.
4. **Appliance data provenance.** It is tempting to seed a "just this once" real oven dimension from a
   manufacturer spec sheet found online. CLAUDE.md and this repository's whole discipline forbid it — every
   appliance value must go through the same intake/approval path as materials/finishes, `TEST_FIXTURE` only
   until Lintel or a real manufacturer feed supplies it.
5. **Four cabinets in one slice is a lot.** §4D (pull-out) is materially cheaper than §4A-C. Splitting Slice 5
   into narrower checkpoints (e.g. 5a: `BOMItem` widening + pull-out; 5b: sink; 5c: hob + appliance model; 5d:
   oven tower) would keep each PR reviewable, consistent with every prior slice's own "smallest coherent
   change" discipline — a sequencing recommendation, not a requirement of this document.

## 14. Canonical acceptance test (design-level, not yet run)

One kitchen, entirely through the same `PropertiesPanel`/library mechanism already proven for Slices 1-4:

```text
Wall A: Standard base (Slice 1) — Sink base (Slice 5) — Hob base (Slice 5) — 3-drawer base (Slice 2)
Wall D: L-corner pair (Slice 4) — Oven tower (Slice 5)
Somewhere: a pull-out cabinet (Slice 5)
```

The architecture in §4 represents every one of these with:
- the **same** `objectType` (`BASE_CABINET`/tall variant, no new object kind),
- the **same** compile/decode dispatch pattern (`productCode` switch, exactly as `compile.ts`/`decode.ts`
  already do for four types),
- the **same** Properties panel mechanism (dispatch by `productCode`, new fields only),
- **no** per-cabinet-type special-case database table — appliances get one new reference-data family (§11),
  shared by every cabinet that needs one, not a bespoke table per cabinet type,
- **zero** boolean/CSG geometry anywhere.

Passing this test (once implemented) is "Slice 5 is usable," matching the acceptance-test discipline already
established in §4/§6/§8/§10 of `docs/architecture/DESIGN-STUDIO-D1-D6.md`.

## Recommendation summary

Adopt **Option D (hybrid)**: Option C (real decomposed components, via the existing `ComponentTemplate.when`
mechanism) for anything that needs a genuine structural void in a cabinet carcass (appliance bays, pull-out
frames), and Option B (a semantic, geometry-deferred `CutoutFeature`) for anything that is really a countertop
concern (sink/hob worktop holes) — never Option A (boolean subtraction), which would require a new geometry
primitive this repository does not have and should not build for this. Introduce `Appliance` as an independent,
versioned reference-data family (not nested in a product), widen `BOMItem.kind` by exactly one member
(`"APPLIANCE"`) as its own first, isolated change, and sequence the four cabinet types cheapest-to-hardest
(pull-out → sink → hob/appliance-model → oven tower) rather than one large PR.

**No implementation code has been written for Slice 5. This document is the design checkpoint the user asked
for; further work waits for explicit sign-off on the architecture above.**
