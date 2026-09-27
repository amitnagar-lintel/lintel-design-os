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
  planned("BASE_DRAWER_SHUTTER", "BASE", "Base cabinet — 1 drawer + shutter", "One drawer over a shutter.", 2),
  planned("BASE_DRAWER2_SHUTTER", "BASE", "Base cabinet — 2 drawers + shutter", "Two drawers over a shutter.", 2),
  planned("BASE_OPEN", "BASE", "Base cabinet — open", "Open-front base carcass (no door).", 3),
  planned("BASE_SINK", "BASE", "Sink cabinet", "Base cabinet with a sink cut-out.", 5),
  planned("BASE_HOB", "BASE", "Hob cabinet", "Base cabinet with a hob cut-out.", 5),
  planned("BASE_APPLIANCE", "BASE", "Appliance cabinet", "Base cabinet housing a built-in appliance.", 5),
  planned("BASE_PULLOUT", "BASE", "Pull-out cabinet", "Narrow base cabinet with an internal pull-out.", 5),
  planned("WALL_SHUTTER", "WALL", "Wall cabinet — 1 shutter", "Wall-mounted cabinet, single shutter.", 6),
  planned("WALL_2_SHUTTER", "WALL", "Wall cabinet — 2 shutters", "Wall-mounted cabinet, two shutters.", 6),
  planned("WALL_LIFT_UP", "WALL", "Wall cabinet — lift-up", "Wall-mounted cabinet with a lift-up front.", 6),
  planned("WALL_OPEN", "WALL", "Wall cabinet — open", "Open-front wall cabinet (no door).", 6),
  planned("TALL_SHUTTER", "TALL", "Tall cabinet — shutter", "Full-height cabinet, shutter front.", 6),
  planned("TALL_PANTRY", "TALL", "Pantry unit", "Full-height pantry cabinet with pull-out internals.", 6),
  planned("TALL_OVEN_TOWER", "TALL", "Oven tower", "Full-height cabinet housing a built-in oven.", 6),
  planned("TALL_MICROWAVE_TOWER", "TALL", "Microwave tower", "Full-height cabinet housing a built-in microwave.", 6),
  planned("TALL_UTILITY", "TALL", "Utility tower", "Full-height utility/appliance cabinet.", 6),
  planned("CORNER_L", "CORNER", "L-corner cabinet", "Two-leg corner base cabinet.", 4),
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
