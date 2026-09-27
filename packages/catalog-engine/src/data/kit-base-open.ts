import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_BASE_OPEN — Design Studio Slice 3 (an open-front base cabinet, D2 "open"). Reuses the exact same
 * carcass and loose-shelf mechanism as KIT_BASE_STANDARD, dropping the shutter front entirely: there is no
 * door, no hinge, no front board or finish. Parameter defaults are a plausible V1 reference cabinet, not a
 * Lintel-approved value (see `docs/PRD` — production values must still be pinned and approved through the
 * reference-data workflow before any output can be issued).
 */
export const KIT_BASE_OPEN: ProductDefinition = {
  productId: "KIT_BASE_OPEN",
  version: "1.0.0",
  status: "DRAFT",
  name: "Kitchen base cabinet — open",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "KITCHEN_BASE_OPEN_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 600, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "number", key: "carcassThickness", symbol: "T", label: "Carcass thickness", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "backThickness", symbol: "TB", label: "Back thickness", unit: "MM", default: 6, min: null, max: null },
    { kind: "integer", key: "shelfCount", symbol: "N_SHELF", label: "Shelf count", default: 2, min: 0, max: null, allowed: null },
    { kind: "material", key: "material", symbol: "T_CARCASS_MAT", label: "Carcass material", default: "BOARD_BWP_18" },
    { kind: "material", key: "backMaterial", symbol: "T_BACK_MAT", label: "Back material", default: "BOARD_BACK_6" },
    // Required by MaterialRole/FinishRole (every role must map to a real parameter of the matching kind,
    // packages/catalog-engine/src/validate.ts), but never applied: this recipe generates no FRONT-role
    // component, so neither parameter is ever read by the engine.
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Finish (unused: open front has no door)", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KBO_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KBO_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KBO_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_BASE_OPEN-{width}",
    descriptionTemplate: "{width} Open Base Cabinet",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * KITCHEN_BASE_OPEN_V1 recipe. The carcass and shelf mechanism (sides, bottom, back, top rails, evenly
 * spaced loose shelves) are identical to KITCHEN_BASE_STANDARD_V1's own — copied here, not shared by
 * reference, because a recipe's components/formulas/constructionVariables must stand alone (no cross-recipe
 * dependency exists in this engine). No front, no hinge: `hardwareRuleSetId` names a rule set with zero
 * rules, and `edgeRuleSetId` names a rule set with no FRONT-facing component types.
 *
 * Assumptions (explicit, PRD §14):
 * - Shelves are loose, spaced evenly in the internal height, exactly as in KITCHEN_BASE_STANDARD_V1 (no
 *   inset-shutter clearance rule applies here: there is no shutter to clear).
 * - Cabinet height excludes legs/plinth and worktop (none modelled in V1).
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const KITCHEN_BASE_OPEN_V1: ConstructionRecipe = {
  recipeId: "KITCHEN_BASE_OPEN_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "Frameless base carcass: two full-height sides, bottom between sides, front and back top support rails, grooved back, loose shelves, open front (no door).",
  assumptions: [
    "Sides run full cabinet height; bottom and top rails sit between the sides.",
    "Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top of the carcass.",
    "Rear top rail sits directly in front of the back panel.",
    "Shelves are loose, spaced evenly in the internal height, and sit in front of the back panel.",
    "There is no front of any kind: no shutter, no drawer, no hinge, no separate front material or finish.",
    "Cabinet height excludes legs/plinth and worktop (none modelled in V1).",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
  ],
  constructionVariables: [
    { key: "BACK_GROOVE_DEPTH", description: "Depth of the back-panel groove in sides and bottom", unit: "MM" },
    { key: "BACK_REAR_OFFSET", description: "Distance from carcass rear edge to the back panel's rear face", unit: "MM" },
    { key: "TOP_RAIL_WIDTH", description: "Depth (front-to-back) of each top support rail", unit: "MM" },
    { key: "SHELF_FRONT_SETBACK", description: "Shelf front edge setback from carcass front", unit: "MM" },
    { key: "SHELF_SIDE_CLEARANCE", description: "Total width clearance of a loose shelf between sides", unit: "MM" },
  ],
  formulas: [
    { formulaId: "INTERNAL_WIDTH", expression: "W - 2*T", variables: ["W", "T"], unit: "MM" },
    { formulaId: "INTERNAL_HEIGHT", expression: "H - 2*T", variables: ["H", "T"], unit: "MM" },
    { formulaId: "SHELF_DEPTH", expression: "D - BACK_REAR_OFFSET - TB - SHELF_FRONT_SETBACK", variables: ["D", "BACK_REAR_OFFSET", "TB", "SHELF_FRONT_SETBACK"], unit: "MM" },
    { formulaId: "SHELF_PITCH", expression: "(INTERNAL_HEIGHT - N_SHELF*T) / (N_SHELF + 1)", variables: ["INTERNAL_HEIGHT", "N_SHELF", "T"], unit: "MM" },
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
      templateId: "SHELF", componentType: "SHELF", idSuffix: "SHF", instanceSuffix: "INDEX", when: null, count: "N_SHELF",
      plane: "XZ", width: "INTERNAL_WIDTH - SHELF_SIDE_CLEARANCE", height: "SHELF_DEPTH", thickness: "T",
      position: { x: "T + SHELF_SIDE_CLEARANCE / 2", y: "T + (i + 1)*SHELF_PITCH + i*T", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "WIDTH",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "backMaterial", FRONT: "material" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [
    {
      ruleId: "KBO_CARCASS_THICKNESS_MATCHES_MATERIAL",
      description: "Carcass thickness parameter must equal the carcass board thickness",
      assert: "T == T_CARCASS_MAT",
      severity: "BLOCKER",
      message: "Carcass thickness {T} mm does not match carcass material thickness {T_CARCASS_MAT} mm",
    },
    {
      ruleId: "KBO_BACK_THICKNESS_MATCHES_MATERIAL",
      description: "Back thickness parameter must equal the back board thickness",
      assert: "TB == T_BACK_MAT",
      severity: "BLOCKER",
      message: "Back thickness {TB} mm does not match back material thickness {T_BACK_MAT} mm",
    },
    {
      ruleId: "KBO_WIDTH_EXCEEDS_SIDES",
      description: "Width must leave an internal opening",
      assert: "W > 2*T",
      severity: "BLOCKER",
      message: "Width {W} mm leaves no internal width with {T} mm sides",
    },
    {
      ruleId: "KBO_HEIGHT_EXCEEDS_CARCASS",
      description: "Height must leave an internal opening",
      assert: "H > 2*T",
      severity: "BLOCKER",
      message: "Height {H} mm leaves no internal height with {T} mm bottom and rails",
    },
    {
      ruleId: "KBO_GROOVE_WITHIN_CARCASS",
      description: "Back groove must be shallower than the carcass board",
      assert: "BACK_GROOVE_DEPTH < T",
      severity: "BLOCKER",
      message: "Back groove depth {BACK_GROOVE_DEPTH} mm must be less than carcass thickness {T} mm",
    },
  ],
  edgeRuleSetId: "OPEN_CARCASS_STANDARD",
  hardwareRuleSetId: "OPEN_STANDARD",
};

/** An open front has no door and no hinge: zero rules is the correct, complete hardware rule set. */
export const OPEN_STANDARD: HardwareRuleSet = {
  ruleSetId: "OPEN_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [],
};
