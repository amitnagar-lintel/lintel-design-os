import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_BASE_DRAWER — Design Studio Slice 2 (an all-drawer base cabinet, D2 "drawer bank"), Slice 2.1 (individual
 * drawer front-height editing). Reuses the exact same carcass (sides, bottom, back, top rails) as
 * KIT_BASE_STANDARD, replacing its shutter front with `drawerCount` drawers. Parameter defaults are a
 * plausible V1 reference cabinet, not a Lintel-approved value (see `docs/PRD` — production values must still
 * be pinned and approved through the reference-data workflow before any output can be issued).
 *
 * Slice 2.1: drawers are no longer forced to equal heights. `drawerHeight1`/`2`/`3` (`DH1`/`DH2`/`DH3`) are
 * explicit front heights for drawer positions 0, 1 and 2 (top to bottom, 0-based); the LAST drawer of the
 * bank (whichever position that is for the current `drawerCount`) always absorbs whatever height remains of
 * the internal opening — it has no parameter of its own, so "recalculate the dependent drawer, not the ones
 * the designer explicitly set" falls out of the formula shape rather than needing separate logic. This is
 * pure recipe DATA (new parameters + formulas selected by the existing per-instance `i` variable): no
 * `@lintel/rules-engine` or `@lintel/design-engine` code changed. See `INSET_DRAWER_HEIGHT_AT_0..3` /
 * `OVERLAY_DRAWER_HEIGHT_AT_0..3` below.
 */
export const KIT_BASE_DRAWER: ProductDefinition = {
  productId: "KIT_BASE_DRAWER",
  version: "1.1.0",
  status: "DRAFT",
  name: "Kitchen base cabinet — drawer bank",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "KITCHEN_BASE_DRAWER_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 600, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "number", key: "carcassThickness", symbol: "T", label: "Carcass thickness", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "backThickness", symbol: "TB", label: "Back thickness", unit: "MM", default: 6, min: null, max: null },
    { kind: "integer", key: "drawerCount", symbol: "N_DRAWER", label: "Drawer count", default: 3, min: 2, max: 4, allowed: [2, 3, 4] },
    { kind: "enum", key: "frontType", symbol: "FRONT", label: "Front type", values: ["OVERLAY", "INSET"], default: "OVERLAY" },
    { kind: "number", key: "drawerHeight1", symbol: "DH1", label: "Drawer 1 front height", unit: "MM", default: 210, min: null, max: null },
    { kind: "number", key: "drawerHeight2", symbol: "DH2", label: "Drawer 2 front height", unit: "MM", default: 210, min: null, max: null },
    { kind: "number", key: "drawerHeight3", symbol: "DH3", label: "Drawer 3 front height", unit: "MM", default: 210, min: null, max: null },
    { kind: "material", key: "material", symbol: "T_CARCASS_MAT", label: "Carcass material", default: "BOARD_BWP_18" },
    { kind: "material", key: "backMaterial", symbol: "T_BACK_MAT", label: "Back material", default: "BOARD_BACK_6" },
    { kind: "material", key: "frontMaterial", symbol: "T_FRONT", label: "Drawer front material", default: "BOARD_HDHMR_18" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Drawer front finish", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KBD_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KBD_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KBD_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_BASE_DRAWER-{width}",
    descriptionTemplate: "{width} Drawer Base Cabinet",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * KITCHEN_BASE_DRAWER_V1 recipe. The carcass (sides, bottom, back, top rails) is identical to
 * KITCHEN_BASE_STANDARD_V1. `drawerCount` drawer fronts replace the shutters, each with its own box (two
 * sides, a back, a bottom) using the same `i`-indexed mechanism SHELF already uses.
 *
 * Assumptions (explicit, PRD §14):
 * - The drawer box always sits at "inset" positioning (INTERNAL_WIDTH/INTERNAL_HEIGHT-based), regardless of
 *   `frontType`: only the visible DRAWER_FRONT panel changes between overlay and inset, exactly as
 *   KITCHEN_BASE_STANDARD_V1's shelves are frontType-independent.
 * - Drawer box sides and back reuse the carcass material/thickness (MaterialRole CARCASS); the drawer
 *   bottom reuses the back panel's thin board (MaterialRole BACK) — no separate "drawer box" material role
 *   exists yet. A later slice may add one if real construction data calls for a distinct board.
 * - There is no separate structural drawer-box front (DRAWER_BOX_FRONT): the visible DRAWER_FRONT panel is
 *   the box's own front wall, as in many economy drawer systems.
 * - `SHUTTER_BACK_GAP` (an existing KITCHEN_BASE_STANDARD_V1 variable) is reused for the drawer front's own
 *   overlay projection gap: the same "a front floats this far proud of the carcass" concept applies to any
 *   front type, shutter or drawer.
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 * - Slice 2.1: `DH1`/`DH2`/`DH3` are the front heights of drawer positions 0/1/2 (top to bottom). The bank's
 *   LAST position (index `N_DRAWER - 1`) always takes whatever height remains of the internal opening once
 *   every other position's height and every required `FRONT_BETWEEN_GAP` is subtracted — it is never read
 *   from a parameter, so there is nothing to keep in sync when `drawerCount` changes. The drawer box (always
 *   inset-positioned) uses the exact same per-position heights as the inset front does, so 3D geometry, the
 *   drawer box and the visible front never disagree about where a drawer sits.
 */
export const KITCHEN_BASE_DRAWER_V1: ConstructionRecipe = {
  recipeId: "KITCHEN_BASE_DRAWER_V1",
  version: "1.1.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "Frameless base carcass: two full-height sides, bottom between sides, front and back top support rails, grooved back, a bank of independently-sized drawers.",
  assumptions: [
    "Sides run full cabinet height; bottom and top rails sit between the sides.",
    "Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top of the carcass.",
    "Rear top rail sits directly in front of the back panel.",
    "Drawer boxes are positioned as if inset (independent of frontType); only the visible drawer front varies with overlay/inset.",
    "Drawer box sides and back use the carcass material; the drawer bottom uses the back panel's board. No dedicated drawer-box material role exists yet.",
    "There is no separate structural drawer-box front panel: the visible drawer front is the box's own front wall.",
    "Drawer positions 0 and 1 (and 2, for a 4-drawer bank) take their front height from DH1/DH2/DH3; the bank's last position always absorbs the remaining opening height, so it has no parameter of its own and no constraint is ever double-specified.",
    "Cabinet height excludes legs/plinth and worktop (none modelled in V1).",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
  ],
  constructionVariables: [
    { key: "BACK_GROOVE_DEPTH", description: "Depth of the back-panel groove in sides and bottom", unit: "MM" },
    { key: "BACK_REAR_OFFSET", description: "Distance from carcass rear edge to the back panel's rear face", unit: "MM" },
    { key: "TOP_RAIL_WIDTH", description: "Depth (front-to-back) of each top support rail", unit: "MM" },
    { key: "OVERLAY_EDGE_GAP", description: "Overlay front reveal at each outer side edge", unit: "MM" },
    { key: "OVERLAY_TOP_GAP", description: "Overlay front reveal at the top", unit: "MM" },
    { key: "OVERLAY_BOTTOM_GAP", description: "Overlay front reveal at the bottom", unit: "MM" },
    { key: "FRONT_BETWEEN_GAP", description: "Gap between adjacent drawer fronts", unit: "MM" },
    { key: "INSET_GAP", description: "Inset front clearance to the opening on each side", unit: "MM" },
    { key: "FRONT_FINISHED_FACES", description: "Number of drawer front faces receiving the front finish", unit: "COUNT" },
    { key: "SHUTTER_BACK_GAP", description: "Gap between the back face of an overlay front and the carcass front face (shared with shutter fronts)", unit: "MM" },
    { key: "DRAWER_BOX_SIDE_CLEARANCE", description: "Total width clearance of the drawer box between the internal sides (runner mechanism clearance)", unit: "MM" },
    { key: "DRAWER_BOX_HEIGHT_GAP", description: "Vertical clearance between a drawer's front height and its own box height", unit: "MM" },
    { key: "DRAWER_BOX_FRONT_SETBACK", description: "Drawer box front-wall setback from the carcass front face", unit: "MM" },
  ],
  formulas: [
    { formulaId: "INTERNAL_WIDTH", expression: "W - 2*T", variables: ["T", "W"], unit: "MM" },
    { formulaId: "INTERNAL_HEIGHT", expression: "H - 2*T", variables: ["H", "T"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_FRONT_WIDTH", expression: "W - 2*OVERLAY_EDGE_GAP", variables: ["OVERLAY_EDGE_GAP", "W"], unit: "MM" },
    { formulaId: "INSET_DRAWER_FRONT_WIDTH", expression: "INTERNAL_WIDTH - 2*INSET_GAP", variables: ["INSET_GAP", "INTERNAL_WIDTH"], unit: "MM" },
    { formulaId: "DRAWER_BOX_DEPTH", expression: "D - BACK_REAR_OFFSET - TB - DRAWER_BOX_FRONT_SETBACK", variables: ["BACK_REAR_OFFSET", "D", "DRAWER_BOX_FRONT_SETBACK", "TB"], unit: "MM" },
    { formulaId: "DRAWER_BOX_WIDTH", expression: "INTERNAL_WIDTH - DRAWER_BOX_SIDE_CLEARANCE - 2*T", variables: ["DRAWER_BOX_SIDE_CLEARANCE", "INTERNAL_WIDTH", "T"], unit: "MM" },

    // ---- inset-space per-position heights (also used by the drawer box, always, regardless of frontType) ----
    { formulaId: "INSET_DRAWER_TOTAL_SPACE", expression: "INTERNAL_HEIGHT - 2*INSET_GAP - (N_DRAWER - 1)*FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "INSET_GAP", "INTERNAL_HEIGHT", "N_DRAWER"], unit: "MM" },
    {
      formulaId: "INSET_DRAWER_REMAINDER_HEIGHT",
      expression: "IF(N_DRAWER == 2, INSET_DRAWER_TOTAL_SPACE - DH1, IF(N_DRAWER == 3, INSET_DRAWER_TOTAL_SPACE - DH1 - DH2, INSET_DRAWER_TOTAL_SPACE - DH1 - DH2 - DH3))",
      variables: ["DH1", "DH2", "DH3", "INSET_DRAWER_TOTAL_SPACE", "N_DRAWER"],
      unit: "MM",
    },
    // AT_k is indexed bottom-up (k=0 is the carcass's physically lowest drawer position, matching the
    // per-instance `i` that already accumulates position.y upward from the bottom, unchanged since Slice 2).
    // decode.ts numbers drawers top-down (index 0 = topmost, matching the acceptance test's "Drawer 1"), so
    // the TOP position (k = N_DRAWER - 1) is DH1, and the BOTTOM position (k = 0) always absorbs the
    // remainder — never a parameter of its own, regardless of drawerCount.
    { formulaId: "INSET_DRAWER_HEIGHT_AT_0", expression: "INSET_DRAWER_REMAINDER_HEIGHT", variables: ["INSET_DRAWER_REMAINDER_HEIGHT"], unit: "MM" },
    { formulaId: "INSET_DRAWER_HEIGHT_AT_1", expression: "IF(N_DRAWER == 2, DH1, IF(N_DRAWER == 3, DH2, DH3))", variables: ["DH1", "DH2", "DH3", "N_DRAWER"], unit: "MM" },
    { formulaId: "INSET_DRAWER_HEIGHT_AT_2", expression: "IF(N_DRAWER == 3, DH1, DH2)", variables: ["DH1", "DH2", "N_DRAWER"], unit: "MM" },
    { formulaId: "INSET_DRAWER_HEIGHT_AT_3", expression: "DH1", variables: ["DH1"], unit: "MM" },
    { formulaId: "INSET_DRAWER_Y_OFFSET_AT_0", expression: "0", variables: [], unit: "MM" },
    { formulaId: "INSET_DRAWER_Y_OFFSET_AT_1", expression: "INSET_DRAWER_HEIGHT_AT_0 + FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "INSET_DRAWER_HEIGHT_AT_0"], unit: "MM" },
    { formulaId: "INSET_DRAWER_Y_OFFSET_AT_2", expression: "INSET_DRAWER_Y_OFFSET_AT_1 + INSET_DRAWER_HEIGHT_AT_1 + FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "INSET_DRAWER_HEIGHT_AT_1", "INSET_DRAWER_Y_OFFSET_AT_1"], unit: "MM" },
    { formulaId: "INSET_DRAWER_Y_OFFSET_AT_3", expression: "INSET_DRAWER_Y_OFFSET_AT_2 + INSET_DRAWER_HEIGHT_AT_2 + FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "INSET_DRAWER_HEIGHT_AT_2", "INSET_DRAWER_Y_OFFSET_AT_2"], unit: "MM" },

    { formulaId: "DRAWER_BOX_HEIGHT_AT_0", expression: "INSET_DRAWER_HEIGHT_AT_0 - DRAWER_BOX_HEIGHT_GAP", variables: ["DRAWER_BOX_HEIGHT_GAP", "INSET_DRAWER_HEIGHT_AT_0"], unit: "MM" },
    { formulaId: "DRAWER_BOX_HEIGHT_AT_1", expression: "INSET_DRAWER_HEIGHT_AT_1 - DRAWER_BOX_HEIGHT_GAP", variables: ["DRAWER_BOX_HEIGHT_GAP", "INSET_DRAWER_HEIGHT_AT_1"], unit: "MM" },
    { formulaId: "DRAWER_BOX_HEIGHT_AT_2", expression: "INSET_DRAWER_HEIGHT_AT_2 - DRAWER_BOX_HEIGHT_GAP", variables: ["DRAWER_BOX_HEIGHT_GAP", "INSET_DRAWER_HEIGHT_AT_2"], unit: "MM" },
    { formulaId: "DRAWER_BOX_HEIGHT_AT_3", expression: "INSET_DRAWER_HEIGHT_AT_3 - DRAWER_BOX_HEIGHT_GAP", variables: ["DRAWER_BOX_HEIGHT_GAP", "INSET_DRAWER_HEIGHT_AT_3"], unit: "MM" },

    // ---- overlay-space per-position heights (the visible front only, when frontType = OVERLAY) ----
    { formulaId: "OVERLAY_DRAWER_TOTAL_SPACE", expression: "H - OVERLAY_TOP_GAP - OVERLAY_BOTTOM_GAP - (N_DRAWER - 1)*FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "H", "N_DRAWER", "OVERLAY_BOTTOM_GAP", "OVERLAY_TOP_GAP"], unit: "MM" },
    {
      formulaId: "OVERLAY_DRAWER_REMAINDER_HEIGHT",
      expression: "IF(N_DRAWER == 2, OVERLAY_DRAWER_TOTAL_SPACE - DH1, IF(N_DRAWER == 3, OVERLAY_DRAWER_TOTAL_SPACE - DH1 - DH2, OVERLAY_DRAWER_TOTAL_SPACE - DH1 - DH2 - DH3))",
      variables: ["DH1", "DH2", "DH3", "N_DRAWER", "OVERLAY_DRAWER_TOTAL_SPACE"],
      unit: "MM",
    },
    // Same bottom-up k / top-down decode convention as the inset set above.
    { formulaId: "OVERLAY_DRAWER_HEIGHT_AT_0", expression: "OVERLAY_DRAWER_REMAINDER_HEIGHT", variables: ["OVERLAY_DRAWER_REMAINDER_HEIGHT"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_HEIGHT_AT_1", expression: "IF(N_DRAWER == 2, DH1, IF(N_DRAWER == 3, DH2, DH3))", variables: ["DH1", "DH2", "DH3", "N_DRAWER"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_HEIGHT_AT_2", expression: "IF(N_DRAWER == 3, DH1, DH2)", variables: ["DH1", "DH2", "N_DRAWER"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_HEIGHT_AT_3", expression: "DH1", variables: ["DH1"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_Y_OFFSET_AT_0", expression: "0", variables: [], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_Y_OFFSET_AT_1", expression: "OVERLAY_DRAWER_HEIGHT_AT_0 + FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "OVERLAY_DRAWER_HEIGHT_AT_0"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_Y_OFFSET_AT_2", expression: "OVERLAY_DRAWER_Y_OFFSET_AT_1 + OVERLAY_DRAWER_HEIGHT_AT_1 + FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "OVERLAY_DRAWER_HEIGHT_AT_1", "OVERLAY_DRAWER_Y_OFFSET_AT_1"], unit: "MM" },
    { formulaId: "OVERLAY_DRAWER_Y_OFFSET_AT_3", expression: "OVERLAY_DRAWER_Y_OFFSET_AT_2 + OVERLAY_DRAWER_HEIGHT_AT_2 + FRONT_BETWEEN_GAP", variables: ["FRONT_BETWEEN_GAP", "OVERLAY_DRAWER_HEIGHT_AT_2", "OVERLAY_DRAWER_Y_OFFSET_AT_2"], unit: "MM" },
  ],
  components: [
    {
      templateId: "SIDE_LEFT", componentType: "SIDE_LEFT", idSuffix: "SL", instanceSuffix: null, when: null, count: "1",
      plane: "YZ", width: "D", height: "H", thickness: "T", position: { x: "0", y: "0", z: "0" },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "SIDE_RIGHT", componentType: "SIDE_RIGHT", idSuffix: "SR", instanceSuffix: null, when: null, count: "1",
      plane: "YZ", width: "D", height: "H", thickness: "T", position: { x: "W - T", y: "0", z: "0" },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "BOTTOM", componentType: "BOTTOM", idSuffix: "BOT", instanceSuffix: null, when: null, count: "1",
      plane: "XZ", width: "INTERNAL_WIDTH", height: "D", thickness: "T", position: { x: "T", y: "0", z: "0" },
      materialRole: "CARCASS", finish: null, grainDirection: "WIDTH",
    },
    {
      templateId: "TOP_SUPPORT_FRONT", componentType: "TOP_SUPPORT_FRONT", idSuffix: "TSF", instanceSuffix: null, when: null, count: "1",
      plane: "XZ", width: "INTERNAL_WIDTH", height: "TOP_RAIL_WIDTH", thickness: "T", position: { x: "T", y: "H - T", z: "D - TOP_RAIL_WIDTH" },
      materialRole: "CARCASS", finish: null, grainDirection: "WIDTH",
    },
    {
      templateId: "TOP_SUPPORT_BACK", componentType: "TOP_SUPPORT_BACK", idSuffix: "TSB", instanceSuffix: null, when: null, count: "1",
      plane: "XZ", width: "INTERNAL_WIDTH", height: "TOP_RAIL_WIDTH", thickness: "T", position: { x: "T", y: "H - T", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "WIDTH",
    },
    {
      templateId: "BACK", componentType: "BACK", idSuffix: "BCK", instanceSuffix: null, when: null, count: "1",
      plane: "XY", width: "INTERNAL_WIDTH + 2*BACK_GROOVE_DEPTH", height: "H - T + BACK_GROOVE_DEPTH", thickness: "TB",
      position: { x: "T - BACK_GROOVE_DEPTH", y: "T - BACK_GROOVE_DEPTH", z: "BACK_REAR_OFFSET" },
      materialRole: "BACK", finish: null, grainDirection: "NONE",
    },
    {
      templateId: "DRAWER_FRONT_OVERLAY", componentType: "DRAWER_FRONT", idSuffix: "DRF", instanceSuffix: "INDEX", when: "FRONT_OVERLAY", count: "N_DRAWER",
      plane: "XY",
      width: "OVERLAY_DRAWER_FRONT_WIDTH",
      height: "IF(i == 0, OVERLAY_DRAWER_HEIGHT_AT_0, IF(i == 1, OVERLAY_DRAWER_HEIGHT_AT_1, IF(i == 2, OVERLAY_DRAWER_HEIGHT_AT_2, OVERLAY_DRAWER_HEIGHT_AT_3)))",
      thickness: "T_FRONT",
      position: {
        x: "OVERLAY_EDGE_GAP",
        y: "OVERLAY_BOTTOM_GAP + IF(i == 0, OVERLAY_DRAWER_Y_OFFSET_AT_0, IF(i == 1, OVERLAY_DRAWER_Y_OFFSET_AT_1, IF(i == 2, OVERLAY_DRAWER_Y_OFFSET_AT_2, OVERLAY_DRAWER_Y_OFFSET_AT_3)))",
        z: "D + SHUTTER_BACK_GAP",
      },
      materialRole: "FRONT", finish: { role: "FRONT_FINISH", faces: "FRONT_FINISHED_FACES" }, grainDirection: "WIDTH",
    },
    {
      templateId: "DRAWER_FRONT_INSET", componentType: "DRAWER_FRONT", idSuffix: "DRF", instanceSuffix: "INDEX", when: "FRONT_INSET", count: "N_DRAWER",
      plane: "XY",
      width: "INSET_DRAWER_FRONT_WIDTH",
      height: "IF(i == 0, INSET_DRAWER_HEIGHT_AT_0, IF(i == 1, INSET_DRAWER_HEIGHT_AT_1, IF(i == 2, INSET_DRAWER_HEIGHT_AT_2, INSET_DRAWER_HEIGHT_AT_3)))",
      thickness: "T_FRONT",
      position: {
        x: "T + INSET_GAP",
        y: "T + INSET_GAP + IF(i == 0, INSET_DRAWER_Y_OFFSET_AT_0, IF(i == 1, INSET_DRAWER_Y_OFFSET_AT_1, IF(i == 2, INSET_DRAWER_Y_OFFSET_AT_2, INSET_DRAWER_Y_OFFSET_AT_3)))",
        z: "D - T_FRONT",
      },
      materialRole: "FRONT", finish: { role: "FRONT_FINISH", faces: "FRONT_FINISHED_FACES" }, grainDirection: "WIDTH",
    },
    {
      templateId: "DRAWER_BOX_SIDE_LEFT", componentType: "DRAWER_BOX_SIDE", idSuffix: "DBL", instanceSuffix: "INDEX", when: null, count: "N_DRAWER",
      plane: "YZ", width: "DRAWER_BOX_DEPTH",
      height: "IF(i == 0, DRAWER_BOX_HEIGHT_AT_0, IF(i == 1, DRAWER_BOX_HEIGHT_AT_1, IF(i == 2, DRAWER_BOX_HEIGHT_AT_2, DRAWER_BOX_HEIGHT_AT_3)))",
      thickness: "T",
      position: {
        x: "T + DRAWER_BOX_SIDE_CLEARANCE / 2",
        y: "T + INSET_GAP + IF(i == 0, INSET_DRAWER_Y_OFFSET_AT_0, IF(i == 1, INSET_DRAWER_Y_OFFSET_AT_1, IF(i == 2, INSET_DRAWER_Y_OFFSET_AT_2, INSET_DRAWER_Y_OFFSET_AT_3)))",
        z: "BACK_REAR_OFFSET + TB",
      },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "DRAWER_BOX_SIDE_RIGHT", componentType: "DRAWER_BOX_SIDE", idSuffix: "DBR", instanceSuffix: "INDEX", when: null, count: "N_DRAWER",
      plane: "YZ", width: "DRAWER_BOX_DEPTH",
      height: "IF(i == 0, DRAWER_BOX_HEIGHT_AT_0, IF(i == 1, DRAWER_BOX_HEIGHT_AT_1, IF(i == 2, DRAWER_BOX_HEIGHT_AT_2, DRAWER_BOX_HEIGHT_AT_3)))",
      thickness: "T",
      position: {
        x: "W - T - DRAWER_BOX_SIDE_CLEARANCE / 2 - T",
        y: "T + INSET_GAP + IF(i == 0, INSET_DRAWER_Y_OFFSET_AT_0, IF(i == 1, INSET_DRAWER_Y_OFFSET_AT_1, IF(i == 2, INSET_DRAWER_Y_OFFSET_AT_2, INSET_DRAWER_Y_OFFSET_AT_3)))",
        z: "BACK_REAR_OFFSET + TB",
      },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "DRAWER_BOX_BACK", componentType: "DRAWER_BOX_BACK", idSuffix: "DBB", instanceSuffix: "INDEX", when: null, count: "N_DRAWER",
      plane: "XY", width: "DRAWER_BOX_WIDTH",
      height: "IF(i == 0, DRAWER_BOX_HEIGHT_AT_0, IF(i == 1, DRAWER_BOX_HEIGHT_AT_1, IF(i == 2, DRAWER_BOX_HEIGHT_AT_2, DRAWER_BOX_HEIGHT_AT_3)))",
      thickness: "T",
      position: {
        x: "T + DRAWER_BOX_SIDE_CLEARANCE / 2 + T",
        y: "T + INSET_GAP + IF(i == 0, INSET_DRAWER_Y_OFFSET_AT_0, IF(i == 1, INSET_DRAWER_Y_OFFSET_AT_1, IF(i == 2, INSET_DRAWER_Y_OFFSET_AT_2, INSET_DRAWER_Y_OFFSET_AT_3)))",
        z: "BACK_REAR_OFFSET + TB",
      },
      materialRole: "CARCASS", finish: null, grainDirection: "WIDTH",
    },
    {
      templateId: "DRAWER_BOTTOM", componentType: "DRAWER_BOTTOM", idSuffix: "DBM", instanceSuffix: "INDEX", when: null, count: "N_DRAWER",
      plane: "XZ", width: "DRAWER_BOX_WIDTH", height: "DRAWER_BOX_DEPTH", thickness: "TB",
      position: {
        x: "T + DRAWER_BOX_SIDE_CLEARANCE / 2 + T",
        y: "T + INSET_GAP + IF(i == 0, INSET_DRAWER_Y_OFFSET_AT_0, IF(i == 1, INSET_DRAWER_Y_OFFSET_AT_1, IF(i == 2, INSET_DRAWER_Y_OFFSET_AT_2, INSET_DRAWER_Y_OFFSET_AT_3)))",
        z: "BACK_REAR_OFFSET + TB",
      },
      materialRole: "BACK", finish: null, grainDirection: "WIDTH",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "backMaterial", FRONT: "frontMaterial" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [
    {
      ruleId: "KBD_CARCASS_THICKNESS_MATCHES_MATERIAL",
      description: "Carcass thickness parameter must equal the carcass board thickness",
      assert: "T == T_CARCASS_MAT",
      severity: "BLOCKER",
      message: "Carcass thickness {T} mm does not match carcass material thickness {T_CARCASS_MAT} mm",
    },
    {
      ruleId: "KBD_BACK_THICKNESS_MATCHES_MATERIAL",
      description: "Back thickness parameter must equal the back board thickness",
      assert: "TB == T_BACK_MAT",
      severity: "BLOCKER",
      message: "Back thickness {TB} mm does not match back material thickness {T_BACK_MAT} mm",
    },
    {
      ruleId: "KBD_WIDTH_EXCEEDS_SIDES",
      description: "Width must leave an internal opening",
      assert: "W > 2*T",
      severity: "BLOCKER",
      message: "Width {W} mm leaves no internal width with {T} mm sides",
    },
    {
      ruleId: "KBD_HEIGHT_EXCEEDS_CARCASS",
      description: "Height must leave an internal opening",
      assert: "H > 2*T",
      severity: "BLOCKER",
      message: "Height {H} mm leaves no internal height with {T} mm bottom and rails",
    },
    {
      ruleId: "KBD_GROOVE_WITHIN_CARCASS",
      description: "Back groove must be shallower than the carcass board",
      assert: "BACK_GROOVE_DEPTH < T",
      severity: "BLOCKER",
      message: "Back groove depth {BACK_GROOVE_DEPTH} mm must be less than carcass thickness {T} mm",
    },
    {
      ruleId: "KBD_DRAWER_HEIGHT_PARAMS_POSITIVE",
      description: "Every explicit drawer-height parameter must itself be positive",
      assert: "AND(DH1 > 0, DH2 > 0, DH3 > 0)",
      severity: "BLOCKER",
      message: "Drawer heights must be positive (got DH1={DH1}, DH2={DH2}, DH3={DH3})",
    },
    {
      ruleId: "KBD_DRAWER_BOX_HEIGHT_POSITIVE",
      description: "Every drawer box (including whichever position absorbs the remaining opening height) must have a positive height",
      assert: "MIN(DRAWER_BOX_HEIGHT_AT_0, DRAWER_BOX_HEIGHT_AT_1, DRAWER_BOX_HEIGHT_AT_2, DRAWER_BOX_HEIGHT_AT_3) > 0",
      severity: "BLOCKER",
      message: "At least one drawer box would have non-positive height; reduce an explicit drawer height, increase cabinet height, reduce drawer count, or reduce DRAWER_BOX_HEIGHT_GAP",
    },
    {
      ruleId: "KBD_DRAWER_BOX_WIDTH_POSITIVE",
      description: "The drawer box must have a positive width",
      assert: "DRAWER_BOX_WIDTH > 0",
      severity: "BLOCKER",
      message: "Drawer box width {DRAWER_BOX_WIDTH} mm is not positive; reduce DRAWER_BOX_SIDE_CLEARANCE or increase cabinet width",
    },
  ],
  edgeRuleSetId: "DRAWER_CARCASS_STANDARD",
  hardwareRuleSetId: "DRAWER_STANDARD",
};

/** PRD §28. Every drawer box side gets a runner pair; article selection is by nominal length only (no invented Hettich specs). */
export const DRAWER_STANDARD: HardwareRuleSet = {
  ruleSetId: "DRAWER_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [
    { ruleId: "RUNNER_DRAWER_BOX", componentType: "DRAWER_BOX_SIDE", category: "RUNNER", application: "DRAWER", preferredManufacturer: "HETTICH" },
  ],
};
