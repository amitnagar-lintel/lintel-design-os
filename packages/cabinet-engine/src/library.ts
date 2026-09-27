/**
 * Design Studio — Phase D2/D6: the Cabinet Library the left-hand panel lists.
 *
 * A `CabinetType` (`model.ts`) always resolves to a real, engine-backed recipe — there is no cabinet family
 * without one. That means a family this repository cannot build yet (a corner unit, a wall cabinet) cannot be
 * a `CabinetType` yet either. This module is where that distinction is made explicit: `CABINET_LIBRARY` lists
 * every family the Design Studio's product direction calls for (PRD-independent, Phase D2), each either
 * `AVAILABLE` (carries a real `CabinetType`) or `PLANNED` (named and categorised, but not selectable — the UI
 * shows it greyed out, labelled by the vertical slice that adds it). Nothing here is invented: a `PLANNED`
 * entry names no product code, recipe or dimensions, because none exist yet.
 */
import type { CabinetCategory, CabinetType, FrontTopology } from "./model.js";

export interface CabinetLibraryEntry {
  readonly cabinetTypeId: string;
  readonly category: CabinetCategory;
  readonly label: string;
  readonly description: string;
  readonly availability:
    | { readonly kind: "AVAILABLE"; readonly cabinetType: CabinetType }
    /**
     * Slice 4: a corner cabinet is authored as two ordinary `cabinetType` instances (`corner.ts`'s
     * `cornerPairPlacementDA`), never a single bent object — the geometry model has no way to express one
     * (see `model.ts`'s `CornerConfiguration` doc comment).
     */
    | { readonly kind: "AVAILABLE_CORNER_PAIR"; readonly cabinetType: CabinetType }
    | { readonly kind: "PLANNED"; readonly slice: number };
}

// ---------------------------------------------------------------- Slice 1: BASE_SHUTTER

const BASE_ONE_SHUTTER: FrontTopology = {
  topologyId: "BASE_1_SHUTTER",
  label: "1 shutter",
  rows: [{ columns: 1, element: "SHUTTER" }],
};

const BASE_TWO_SHUTTER: FrontTopology = {
  topologyId: "BASE_2_SHUTTER",
  label: "2 shutters",
  rows: [{ columns: 2, element: "SHUTTER" }],
};

/** `KIT_BASE_STANDARD` / `KITCHEN_BASE_STANDARD_V1` (Slice 1). */
export const BASE_SHUTTER_CABINET: CabinetType = {
  cabinetTypeId: "BASE_SHUTTER",
  category: "BASE",
  label: "Base cabinet — shutter",
  description: "Frameless base carcass with one or two hinged shutter fronts.",
  productCode: "KIT_BASE_STANDARD",
  recipeId: "KITCHEN_BASE_STANDARD_V1",
  supportedFronts: [BASE_ONE_SHUTTER, BASE_TWO_SHUTTER],
};

// ---------------------------------------------------------------- Slice 2: BASE_DRAWER_BANK

/**
 * A drawer bank's front is one column (a single stack), never a row-per-drawer: `columns: 1` because the
 * bank itself is one `FrontElement`, and drawer count is a property of the `DrawerBank` element the
 * Properties panel edits, not of the topology grid.
 */
const DRAWER_BANK_TOPOLOGY: FrontTopology = {
  topologyId: "DRAWER_BANK",
  label: "Drawer bank",
  rows: [{ columns: 1, element: "DRAWER" }],
};

/** `KIT_BASE_DRAWER` / `KITCHEN_BASE_DRAWER_V1` (Slice 2). */
export const BASE_DRAWER_BANK_CABINET: CabinetType = {
  cabinetTypeId: "BASE_DRAWER_BANK",
  category: "BASE",
  label: "Base cabinet — drawer bank",
  description: "All-drawer base cabinet (2/3/4 equal-height drawers).",
  productCode: "KIT_BASE_DRAWER",
  recipeId: "KITCHEN_BASE_DRAWER_V1",
  supportedFronts: [DRAWER_BANK_TOPOLOGY],
};

// ---------------------------------------------------------------- Slice 3: BASE_OPEN

/** An open-front cabinet has no door: zero rows, not a row of zero-width columns. */
const OPEN_NO_FRONT: FrontTopology = {
  topologyId: "OPEN_NO_FRONT",
  label: "Open (no door)",
  rows: [],
};

/** `KIT_BASE_OPEN` / `KITCHEN_BASE_OPEN_V1` (Slice 3). */
export const BASE_OPEN_CABINET: CabinetType = {
  cabinetTypeId: "BASE_OPEN",
  category: "BASE",
  label: "Base cabinet — open",
  description: "Open-front base carcass (no door), with configurable loose shelves.",
  productCode: "KIT_BASE_OPEN",
  recipeId: "KITCHEN_BASE_OPEN_V1",
  supportedFronts: [OPEN_NO_FRONT],
};

// ---------------------------------------------------------------- Slice 5 step 1: BASE_PULLOUT

/** `KIT_BASE_PULLOUT` / `KITCHEN_BASE_PULLOUT_V1` (Slice 5 step 1). A shutter front, identical to
 * `BASE_SHUTTER_CABINET`'s own topologies — the pull-out frames are internal (`pulloutCount`, edited like
 * `BASE_OPEN`'s shelf count), never part of the front topology grid. */
export const BASE_PULLOUT_CABINET: CabinetType = {
  cabinetTypeId: "BASE_PULLOUT",
  category: "BASE",
  label: "Pull-out cabinet",
  description: "Narrow base cabinet with an internal bank of pull-out frames on runners.",
  productCode: "KIT_BASE_PULLOUT",
  recipeId: "KITCHEN_BASE_PULLOUT_V1",
  supportedFronts: [BASE_ONE_SHUTTER, BASE_TWO_SHUTTER],
};

// ---------------------------------------------------------------- Slice 5 step 4: BASE_SINK

/** `KIT_BASE_SINK` / `KITCHEN_BASE_SINK_V1` (Slice 5 step 4). A shutter front, identical to
 * `BASE_SHUTTER_CABINET`'s own topologies — the optional waste-bin tray is internal (`internalConfig`,
 * decoded as a `PullOut { kind: "WASTE_BIN" }`, already reserved in `model.ts`), never part of the front
 * topology grid. The countertop's own future sink cutout (Slice 5 step 6) is not this cabinet's concern. */
export const BASE_SINK_CABINET: CabinetType = {
  cabinetTypeId: "BASE_SINK",
  category: "BASE",
  label: "Sink cabinet",
  description: "Base cabinet with no rear top rail (plumbing clearance) and an optional internal waste-bin tray.",
  productCode: "KIT_BASE_SINK",
  recipeId: "KITCHEN_BASE_SINK_V1",
  supportedFronts: [BASE_ONE_SHUTTER, BASE_TWO_SHUTTER],
};

// ---------------------------------------------------------------- Slice 5 step 5: BASE_HOB

/** `KIT_BASE_HOB` / `KITCHEN_BASE_HOB_V1` (Slice 5 step 5). A shutter front, identical to
 * `BASE_SHUTTER_CABINET`'s own topologies — the referenced hob `Appliance` is never part of the front topology
 * grid or the internals; it reaches the Properties panel and the BOM the same generic way `TALL_OVEN_TOWER`'s
 * own oven reference already does. The countertop's own future hob cutout (Slice 5 step 6) is not this
 * cabinet's concern. */
export const BASE_HOB_CABINET: CabinetType = {
  cabinetTypeId: "BASE_HOB",
  category: "BASE",
  label: "Hob cabinet",
  description: "Base cabinet with no top rails (hob-body and ventilation clearance), referencing one hob appliance.",
  productCode: "KIT_BASE_HOB",
  recipeId: "KITCHEN_BASE_HOB_V1",
  supportedFronts: [BASE_ONE_SHUTTER, BASE_TWO_SHUTTER],
};

// ---------------------------------------------------------------- Slice 5 step 3: TALL_OVEN_TOWER

/** `KIT_TALL_OVEN` / `KITCHEN_TALL_OVEN_V1` (Slice 5 step 3). Front-less like `BASE_OPEN_CABINET`: no front
 * this slice — the appliance bay sits behind whatever front a later slice adds (design doc §4C/§6). */
export const TALL_OVEN_TOWER_CABINET: CabinetType = {
  cabinetTypeId: "TALL_OVEN_TOWER",
  category: "TALL",
  label: "Oven tower",
  description: "Full-height cabinet housing a built-in oven, with configurable loose shelves above the bay.",
  productCode: "KIT_TALL_OVEN",
  recipeId: "KITCHEN_TALL_OVEN_V1",
  supportedFronts: [OPEN_NO_FRONT],
};

// ---------------------------------------------------------------- planned families (D2), by the slice that adds them

function planned(cabinetTypeId: string, category: CabinetCategory, label: string, description: string, slice: number): CabinetLibraryEntry {
  return { cabinetTypeId, category, label, description, availability: { kind: "PLANNED", slice } };
}

export const CABINET_LIBRARY: readonly CabinetLibraryEntry[] = [
  {
    cabinetTypeId: BASE_SHUTTER_CABINET.cabinetTypeId,
    category: BASE_SHUTTER_CABINET.category,
    label: BASE_SHUTTER_CABINET.label,
    description: BASE_SHUTTER_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: BASE_SHUTTER_CABINET },
  },
  {
    cabinetTypeId: BASE_DRAWER_BANK_CABINET.cabinetTypeId,
    category: BASE_DRAWER_BANK_CABINET.category,
    label: BASE_DRAWER_BANK_CABINET.label,
    description: BASE_DRAWER_BANK_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: BASE_DRAWER_BANK_CABINET },
  },
  {
    cabinetTypeId: BASE_OPEN_CABINET.cabinetTypeId,
    category: BASE_OPEN_CABINET.category,
    label: BASE_OPEN_CABINET.label,
    description: BASE_OPEN_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: BASE_OPEN_CABINET },
  },
  planned("BASE_DRAWER_SHUTTER", "BASE", "Base cabinet — 1 drawer + shutter", "One drawer over a shutter.", 2),
  planned("BASE_DRAWER2_SHUTTER", "BASE", "Base cabinet — 2 drawers + shutter", "Two drawers over a shutter.", 2),
  {
    cabinetTypeId: BASE_SINK_CABINET.cabinetTypeId,
    category: BASE_SINK_CABINET.category,
    label: BASE_SINK_CABINET.label,
    description: BASE_SINK_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: BASE_SINK_CABINET },
  },
  {
    cabinetTypeId: BASE_HOB_CABINET.cabinetTypeId,
    category: BASE_HOB_CABINET.category,
    label: BASE_HOB_CABINET.label,
    description: BASE_HOB_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: BASE_HOB_CABINET },
  },
  planned("BASE_APPLIANCE", "BASE", "Appliance cabinet", "Base cabinet housing a built-in appliance.", 5),
  {
    cabinetTypeId: BASE_PULLOUT_CABINET.cabinetTypeId,
    category: BASE_PULLOUT_CABINET.category,
    label: BASE_PULLOUT_CABINET.label,
    description: BASE_PULLOUT_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: BASE_PULLOUT_CABINET },
  },
  planned("WALL_SHUTTER", "WALL", "Wall cabinet — 1 shutter", "Wall-mounted cabinet, single shutter.", 6),
  planned("WALL_2_SHUTTER", "WALL", "Wall cabinet — 2 shutters", "Wall-mounted cabinet, two shutters.", 6),
  planned("WALL_LIFT_UP", "WALL", "Wall cabinet — lift-up", "Wall-mounted cabinet with a lift-up front.", 6),
  planned("WALL_OPEN", "WALL", "Wall cabinet — open", "Open-front wall cabinet (no door).", 6),
  planned("TALL_SHUTTER", "TALL", "Tall cabinet — shutter", "Full-height cabinet, shutter front.", 6),
  planned("TALL_PANTRY", "TALL", "Pantry unit", "Full-height pantry cabinet with pull-out internals.", 6),
  {
    cabinetTypeId: TALL_OVEN_TOWER_CABINET.cabinetTypeId,
    category: TALL_OVEN_TOWER_CABINET.category,
    label: TALL_OVEN_TOWER_CABINET.label,
    description: TALL_OVEN_TOWER_CABINET.description,
    availability: { kind: "AVAILABLE", cabinetType: TALL_OVEN_TOWER_CABINET },
  },
  planned("TALL_MICROWAVE_TOWER", "TALL", "Microwave tower", "Full-height cabinet housing a built-in microwave.", 6),
  planned("TALL_UTILITY", "TALL", "Utility tower", "Full-height utility/appliance cabinet.", 6),
  {
    cabinetTypeId: "CORNER_L",
    category: "CORNER",
    label: "L-corner cabinet",
    description: "Two ordinary base cabinets, one per wall, meeting at the room's D-A corner without overlap.",
    availability: { kind: "AVAILABLE_CORNER_PAIR", cabinetType: BASE_SHUTTER_CABINET },
  },
  planned("CORNER_BLIND", "CORNER", "Blind-corner cabinet", "Corner base cabinet with a blind (unreachable) leg.", 4),
  planned("CORNER_PULLOUT", "CORNER", "Corner pull-out cabinet", "Corner base cabinet with a rotating/pull-out internal.", 4),
  planned("CORNER_DRAWER", "CORNER", "Corner drawer cabinet", "Corner base cabinet with corner drawer boxes.", 4),
  planned("CORNER_SINK", "CORNER", "Corner sink cabinet", "Corner base cabinet with a sink cut-out.", 4),
];

/** The one `CabinetType` a `productCode` resolves to today, for `decode.ts` to attach to a resolved object. */
export function findAvailableCabinetType(productCode: string): CabinetType | undefined {
  for (const entry of CABINET_LIBRARY) {
    if (entry.availability.kind === "AVAILABLE" && entry.availability.cabinetType.productCode === productCode) return entry.availability.cabinetType;
  }
  return undefined;
}
