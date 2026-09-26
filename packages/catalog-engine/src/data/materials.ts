import type { EdgeBand, Finish, Material } from "@lintel/types";

/**
 * Board substrates. Only values stated in the PRD or the existing Lintel catalog are
 * filled in; everything else is `null` until verified (CLAUDE.md: do not invent).
 */
export const MATERIALS: readonly Material[] = [
  {
    materialId: "BOARD_BWP_18",
    category: "BOARD",
    name: "18 mm BWP board",
    substrate: "BWP plywood",
    thickness: 18,
    sheetSize: { width: 1220, height: 2440 },
    grain: true,
    densityKgPerM3: null,
    status: "DRAFT",
    source: "PRD v1 §19",
  },
  {
    materialId: "BOARD_HDHMR_18",
    category: "BOARD",
    name: "18 mm HDHMR board",
    substrate: "HDHMR",
    thickness: 18,
    sheetSize: null,
    grain: null,
    densityKgPerM3: null,
    status: "DRAFT",
    source: "PRD v1 §22 (BOM example: 18mm HDHMR shutter)",
  },
  {
    materialId: "BOARD_BACK_6",
    category: "BOARD",
    name: "6 mm back panel board",
    substrate: null,
    thickness: 6,
    sheetSize: null,
    grain: null,
    densityKgPerM3: null,
    status: "DRAFT",
    source: "PRD v1 §42 (Back: 6 mm); substrate not specified",
  },
];

export const FINISHES: readonly Finish[] = [
  {
    finishId: "LAMINATE_WHITE",
    type: "LAMINATE",
    name: "White laminate",
    thickness: 1,
    status: "DRAFT",
    source: "PRD v1 §19",
  },
];

export const EDGE_BANDS: readonly EdgeBand[] = [
  {
    edgeBandId: "EDGE_ABS_2MM",
    name: "ABS edge band 2 mm",
    material: "ABS",
    thickness: 2,
    width: null,
    status: "DRAFT",
    source: "PRD v1 §20 (thickness 2), §22 (ABS edge band); legacy SQL catalog edge_band_2mm",
  },
  {
    edgeBandId: "EDGE_ABS_0_8MM",
    name: "ABS edge band 0.8 mm",
    material: "ABS",
    thickness: 0.8,
    width: null,
    status: "DRAFT",
    source: "Legacy SQL catalog edge_band_08 (reference only)",
  },
];
