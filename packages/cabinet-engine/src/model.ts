/**
 * Design Studio — Phase D1: the typed cabinet domain model.
 *
 * A cabinet is not a generic rectangular box: it is a composite of a carcass, a front system, internal
 * components, hardware and a finish, built by a construction recipe. This module gives every one of those
 * concepts its own type, so the Design Studio (and later slices) never carries a cabinet as an untyped bag of
 * parameters.
 *
 * What this module is: the AUTHORING-side model the Design Studio UI reads and edits. It does not replace or
 * duplicate the existing engine (`@lintel/types`, `@lintel/design-engine`, `@lintel/rules-engine`): a
 * `CabinetInstance` compiles down to the exact `DesignObject` parameters that engine already resolves
 * (`compile.ts`), and the engine's resolved output decodes back into a `CabinetInstance` view for the UI
 * (`decode.ts`). No engine code changes for Slice 1 (base cabinet, 1–2 shutters, `KIT_BASE_STANDARD`), Slice 2
 * (drawer bank, `KIT_BASE_DRAWER`) or Slice 3 (open front + shelves, `KIT_BASE_OPEN`): all three compile to
 * and decode from recipes that already resolve everything their own `CabinetFront` / internals need.
 *
 * `Shelf` (Slice 3, `KIT_BASE_OPEN` / `KITCHEN_BASE_OPEN_V1`) is wired end to end. What remains defined but not
 * yet wired to an engine (reserved for later vertical slices, D1 asks for the type even where the engine does
 * not produce it yet): `Divider`, `PullOut`, `ApplianceBay`, `CornerConfiguration`. Each says in its own doc
 * comment which slice implements it. A reserved type is never assembled into a `CabinetInstance` before its
 * slice lands — `library.ts` marks exactly which `CabinetType`s and front topologies are available today.
 */
import type { ComponentType, HingeMounting, Millimetres } from "@lintel/types";

// ---------------------------------------------------------------- cabinet family

export type CabinetCategory = "BASE" | "WALL" | "TALL" | "CORNER" | "FILLER";

/**
 * One entry of the Cabinet Library (Phase D6): a cabinet family the designer can place. `productCode` /
 * `recipeId` name the exact `@lintel/types` `ProductDefinition` / `ConstructionRecipe` this type compiles to —
 * every `CabinetType` must resolve to a real, engine-backed recipe; there is no cabinet family without one.
 */
export interface CabinetType {
  readonly cabinetTypeId: string;
  readonly category: CabinetCategory;
  readonly label: string;
  readonly description: string;
  readonly productCode: string;
  readonly recipeId: string;
  /** Front topologies this cabinet type accepts (`library.ts` lists which are available now). */
  readonly supportedFronts: readonly FrontTopology[];
}

/**
 * The shapes a `CabinetFront` may take for a given `CabinetType`, independent of exact widths: how many rows,
 * how many columns per row, and what each column may hold. The Design Studio's front-configuration control
 * offers only the topologies a cabinet type supports.
 */
export interface FrontTopology {
  readonly topologyId: string;
  readonly label: string;
  /** Top row first. */
  readonly rows: readonly { readonly columns: number; readonly element: FrontElementKind }[];
}

// ---------------------------------------------------------------- front system (Phase D3)

export type FrontElementKind = "SHUTTER" | "DRAWER";

export type OverlayMode = "OVERLAY" | "INSET";

/** A hinged door front. Reuses the engine's own `HingeMounting` (never a second definition of overlay/inset). */
export interface Shutter {
  readonly kind: "SHUTTER";
  readonly widthMm: Millimetres;
  readonly heightMm: Millimetres;
  readonly overlay: OverlayMode;
  readonly hinge: HingeConfiguration;
}

/**
 * One drawer front + box (Slice 2, `KIT_BASE_DRAWER` / `KITCHEN_BASE_DRAWER_V1`; per-drawer height editing,
 * Slice 2.1). `runner` stays `null` until an actual hardware resolution (the BOM, not the model preview)
 * names a selected article — like `Handle`, a per-drawer runner is never fabricated from geometry alone.
 *
 * `heightMm` is independently editable per drawer (Slice 2.1: `KITCHEN_BASE_DRAWER_V1`'s `drawerHeight1/2/3`
 * parameters) — EXCEPT the bank's last drawer (`index === bank.drawers.length - 1`, always the physically
 * bottom-most one): it has no parameter of its own and always absorbs whatever height remains of the internal
 * opening, so its `heightMm` is read-only (`compile.ts` never sends a parameter for it; sending one would be
 * silently ignored by the recipe). `boxHeightMm`/`gapBelowMm` are decode-only geometry facts (derived from the
 * resolved model, never authored): `boxHeightMm` is `null` only if the resolved model has no matching drawer
 * box (should not happen for `KIT_BASE_DRAWER`); `gapBelowMm` is `null` for the bank's last (bottom) drawer,
 * which has no drawer below it to gap against.
 */
export interface Drawer {
  readonly kind: "DRAWER";
  readonly widthMm: Millimetres;
  readonly heightMm: Millimetres;
  readonly frontThicknessMm: Millimetres;
  /** Top to bottom position within its `DrawerBank`, 0-based. */
  readonly index: number;
  readonly runner: RunnerConfiguration | null;
  /** The resolved `DRAWER_FRONT` component's id — lets the UI correlate a 3D/elevation click back to this drawer. */
  readonly componentId: string;
  /** The matching drawer box's own height (Slice 2.1), or `null` if the resolved model has no matching box. */
  readonly boxHeightMm: Millimetres | null;
  /** Vertical gap to the next drawer down, or `null` for the bank's bottom (last) drawer. */
  readonly gapBelowMm: Millimetres | null;
}

/**
 * A vertical stack of drawers occupying one front column (Slice 2; independently-sized per drawer, Slice 2.1).
 * Every drawer in a bank shares one overlay mode: `KIT_BASE_DRAWER`'s `frontType` parameter applies to the
 * whole bank, not per drawer.
 */
export interface DrawerBank {
  readonly kind: "DRAWER_BANK";
  readonly widthMm: Millimetres;
  readonly overlay: OverlayMode;
  readonly drawers: readonly Drawer[];
}

export type FrontElement = Shutter | DrawerBank;

/** One horizontal band of the front, divided into one or more side-by-side columns. */
export interface FrontColumn {
  readonly columnId: string;
  readonly widthMm: Millimetres;
  readonly element: FrontElement;
}

export interface FrontRow {
  readonly rowId: string;
  readonly heightMm: Millimetres;
  readonly columns: readonly FrontColumn[];
}

/**
 * The whole front of a cabinet: rows top to bottom, each split into columns left to right. Two side-by-side
 * shutters is one row of two columns; a bank of three stacked drawers is one row of one column whose
 * element is a `DrawerBank` of three `Drawer`s (a bare `Drawer` is never a column's element on its own); "1
 * drawer + 2 shutters" is a one-column drawer-bank row over a two-shutter row (Phase D3 examples).
 */
export interface CabinetFront {
  readonly rows: readonly FrontRow[];
}

// ---------------------------------------------------------------- internals (Phase D4)

/**
 * A loose shelf inside the carcass (Slice 3, `KIT_BASE_OPEN` / `KITCHEN_BASE_OPEN_V1`; also produced —
 * though not yet exposed as an editable Properties control — by `KITCHEN_BASE_STANDARD_V1`'s own
 * `shelfCount` parameter). `heightFromBottomMm` stays `null` until a resolved model decodes it: the recipe
 * always spaces shelves evenly, so `fixed` is `true` for every decoded shelf — there is no per-shelf position
 * control this slice.
 */
export interface Shelf {
  readonly shelfId: string;
  readonly fixed: boolean;
  readonly heightFromBottomMm: Millimetres | null;
}

/** **Reserved for Slice 3.** A vertical partition inside the carcass. */
export interface Divider {
  readonly dividerId: string;
  readonly positionMm: Millimetres;
}

/** **Reserved for Slice 5.** A pull-out internal (basket, wire tray) behind a front. */
export interface PullOut {
  readonly pullOutId: string;
  readonly kind: "WIRE_BASKET" | "TRAY" | "WASTE_BIN";
}

/** **Reserved for Slice 5.** A cut-out for a built-in appliance (hob, oven, sink). */
export interface ApplianceBay {
  readonly applianceBayId: string;
  readonly applianceKind: "SINK" | "HOB" | "OVEN" | "MICROWAVE";
  readonly cutout: { readonly widthMm: Millimetres; readonly heightMm: Millimetres; readonly depthMm: Millimetres };
}

export type InternalComponent = Shelf | Divider | PullOut | ApplianceBay;

// ---------------------------------------------------------------- corner (Phase D2/D7 — reserved)

/**
 * **Reserved for Slice 4.** A corner cabinet is not a single rectangular carcass under the current
 * geometry model (`@lintel/geometry-engine` supports only axis-aligned boxes with quarter-turn placement); this
 * type records the corner strategy so Slice 4 can decide, deliberately, whether an L-corner is one composite
 * object or two coordinated `CabinetInstance`s under the room's existing `CORNER` relationship.
 */
export interface CornerConfiguration {
  readonly kind: "L_CORNER" | "BLIND_CORNER" | "CORNER_PULLOUT" | "CORNER_DRAWER" | "CORNER_SINK";
  readonly returnLegWidthMm: Millimetres;
}

// ---------------------------------------------------------------- hardware (Phase D5)

/** Reuses the engine's own mounting vocabulary; never a second "overlay/inset" enum. */
export interface HingeConfiguration {
  readonly mounting: HingeMounting;
  /** From the resolved hardware, once known; null while only predicted from `overlay`. */
  readonly openingAngle: number | null;
}

/** **Reserved for Slice 2**: AvanTech-style runner selection (PRD §28). No rule resolves this yet. */
export interface RunnerConfiguration {
  readonly systemHeightMm: Millimetres;
  readonly nominalLengthMm: Millimetres;
  readonly loadClass: string | null;
  readonly pushToOpen: boolean;
}

/** A handle the designer chose. Slice 1 leaves this unset (`null`): no handle catalog exists yet. */
export interface Handle {
  readonly handleId: string;
  readonly label: string;
}

/**
 * The hardware attached to one cabinet's front, as the *rule* determines it (D5: "do not make the designer
 * manually select arbitrary hardware whenever a rule can determine it"). `hinges`/`runners` are read from the
 * resolved model or a generated BOM, never invented by the UI; `handle` is the one hardware choice actually
 * left to the designer, and stays `null` until a handle catalog exists.
 */
export interface HardwareSet {
  readonly hinges: readonly HingeConfiguration[];
  readonly runners: readonly RunnerConfiguration[];
  readonly handle: Handle | null;
}

// ---------------------------------------------------------------- finish (Phase D3/D5)

/** One material/finish choice, by the exact catalog codes the engine resolves (never invented in the UI). */
export interface FinishAssignment {
  readonly carcassMaterialId: string;
  readonly backMaterialId: string;
  readonly frontMaterialId: string;
  readonly frontFinishId: string;
}

// ---------------------------------------------------------------- recipe binding

/**
 * The engine-backed recipe a `CabinetType` compiles to. This is a thin, typed reference to the existing
 * `@lintel/types` `ProductDefinition` / `ConstructionRecipe` (identified by code and exact catalog version),
 * never a re-statement of their fields: the recipe's formulas, rules and component templates stay the single
 * source of truth for geometry.
 */
export interface CabinetRecipe {
  readonly recipeId: string;
  readonly productCode: string;
  readonly productVersionId: string;
  /** Which `ComponentType`s this recipe can produce, for the decoder to classify components by front vs carcass. */
  readonly frontComponentTypes: readonly ComponentType[];
}

// ---------------------------------------------------------------- the placed cabinet

/**
 * A cabinet the designer has configured and placed: the authoring-side counterpart of a `DesignObject`
 * (`@lintel/types`), but typed by construction concept instead of a flat parameter bag. `compile.ts` turns
 * this into the `DesignObject`-shaped request the API already accepts; `decode.ts` builds one back from the
 * API's resolved model, so the Design Studio always edits and displays the same shape.
 */
export interface CabinetInstance {
  readonly instanceId: string;
  /** Empty for a cabinet not yet saved to a design version. */
  readonly objectCode: string;
  readonly lineageId: string | null;
  readonly cabinetType: CabinetType;
  readonly recipe: CabinetRecipe;
  readonly position: { readonly xMm: Millimetres; readonly yMm: Millimetres; readonly zMm: Millimetres };
  readonly rotationY: 0 | 90 | 180 | 270;
  readonly dimensions: { readonly widthMm: Millimetres; readonly heightMm: Millimetres; readonly depthMm: Millimetres };
  readonly front: CabinetFront;
  readonly internals: readonly InternalComponent[];
  readonly corner: CornerConfiguration | null;
  readonly finish: FinishAssignment;
  readonly hardware: HardwareSet;
}
