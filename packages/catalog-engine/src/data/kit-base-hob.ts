import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_BASE_HOB — Design Studio Slice 5 step 5 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md`
 * §4B): "recipe variant + Appliance + countertop CutoutFeature." The worktop hole and the hob's own ventilation
 * clearance are the countertop system's concern (Slice 5 step 6, not started here) and the appliance's own
 * `ClearanceRule`s (not yet checked by validation this slice — see the recipe's own assumptions below); this
 * recipe only carries the one real carcass difference a hob cabinet needs (no top rails, for hob-body and
 * wiring clearance) plus the appliance reference itself.
 *
 * The referenced `Appliance` is never a `ComponentType`/`CabinetComponent` — it is resolved and shown as
 * reference data (`resolveParameters`'s `"appliance"` kind, already built for `KIT_TALL_OVEN` in Slice 5 step 3)
 * and reaches the BOM as an `"APPLIANCE"` line through the exact same generic mechanism, unchanged here.
 *
 * Parameter defaults are a plausible V1 reference cabinet, not a Lintel-approved value (see `docs/PRD` —
 * production values must still be pinned and approved through the reference-data workflow before any output
 * can be issued).
 */
export const KIT_BASE_HOB: ProductDefinition = {
  productId: "KIT_BASE_HOB",
  version: "1.0.0",
  status: "DRAFT",
  name: "Kitchen base cabinet — hob",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "KITCHEN_BASE_HOB_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 600, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "number", key: "carcassThickness", symbol: "T", label: "Carcass thickness", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "backThickness", symbol: "TB", label: "Back thickness", unit: "MM", default: 6, min: null, max: null },
    { kind: "integer", key: "shutterCount", symbol: "N_SHUTTER", label: "Shutter count", default: 2, min: 1, max: 2, allowed: [1, 2] },
    { kind: "enum", key: "frontType", symbol: "FRONT", label: "Front type", values: ["OVERLAY", "INSET"], default: "OVERLAY" },
    { kind: "appliance", key: "hob", symbol: "HOB", label: "Hob", default: "HOB_REFERENCE_60CM" },
    { kind: "material", key: "material", symbol: "T_CARCASS_MAT", label: "Carcass material", default: "BOARD_BWP_18" },
    { kind: "material", key: "backMaterial", symbol: "T_BACK_MAT", label: "Back material", default: "BOARD_BACK_6" },
    { kind: "material", key: "shutterMaterial", symbol: "T_FRONT", label: "Shutter material", default: "BOARD_HDHMR_18" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Shutter finish", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KBH_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KBH_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KBH_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_BASE_HOB-{width}",
    descriptionTemplate: "{width} Hob Base Cabinet",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * KITCHEN_BASE_HOB_V1 recipe. The carcass and shutter front are identical to KITCHEN_BASE_STANDARD_V1's own,
 * minus BOTH top support rails (permanently omitted, not `when`-gated: a hob cabinet never has either one).
 * The hob's own worktop cutout, and its ventilation clearance, are the countertop system's future concern
 * (Slice 5 step 6) — this recipe's own components are unaffected by them (design doc §4B).
 *
 * Assumptions (explicit, PRD §14):
 * - Sides run full cabinet height; bottom sits between the sides. There is no front or rear top support rail:
 *   the hob body (control box, gas/electrical connections) and its ventilation need the whole top open. This
 *   is a permanent construction decision for this recipe, not a per-instance option.
 * - Overlay/inset shutter positioning is identical to KITCHEN_BASE_STANDARD_V1's own.
 * - The referenced hob `Appliance`'s own installation envelope and ventilation clearances are not yet checked
 *   by validation (no `ClearanceRule` evaluation exists in this engine yet) — a later slice's concern, not
 *   invented here.
 * - Cabinet height excludes legs/plinth and worktop (none modelled in V1).
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const KITCHEN_BASE_HOB_V1: ConstructionRecipe = {
  recipeId: "KITCHEN_BASE_HOB_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "Frameless base carcass: two full-height sides, bottom between sides, no top rails (hob-body and ventilation clearance), grooved back, hinged shutter(s), referencing one HOB appliance.",
  assumptions: [
    "Sides run full cabinet height; bottom sits between the sides.",
    "There is no front or rear top support rail: the hob body and its ventilation need the whole top open. This is a permanent decision for this recipe, not a per-instance option.",
    "Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top of the carcass.",
    "Overlay shutters cover the carcass front face, held SHUTTER_BACK_GAP in front of it; inset shutters sit inside the opening (no back gap) — identical to KITCHEN_BASE_STANDARD_V1.",
    "The referenced hob Appliance's installation envelope and ventilation clearances are not yet checked by validation; the worktop cutout belongs to the future countertop object (Slice 5 step 6).",
    "Cabinet height excludes legs/plinth and worktop (none modelled in V1).",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
  ],
  constructionVariables: [
    { key: "BACK_GROOVE_DEPTH", description: "Depth of the back-panel groove in sides and bottom", unit: "MM" },
    { key: "BACK_REAR_OFFSET", description: "Distance from carcass rear edge to the back panel's rear face", unit: "MM" },
    { key: "OVERLAY_EDGE_GAP", description: "Overlay front reveal at each outer side edge", unit: "MM" },
    { key: "OVERLAY_TOP_GAP", description: "Overlay front reveal at the top", unit: "MM" },
    { key: "OVERLAY_BOTTOM_GAP", description: "Overlay front reveal at the bottom", unit: "MM" },
    { key: "FRONT_BETWEEN_GAP", description: "Gap between adjacent shutters", unit: "MM" },
    { key: "INSET_GAP", description: "Inset front clearance to the opening on each side", unit: "MM" },
    { key: "FRONT_FINISHED_FACES", description: "Number of shutter faces receiving the front finish", unit: "COUNT" },
    { key: "SHUTTER_BACK_GAP", description: "Gap between the back face of an overlay shutter and the carcass front face", unit: "MM" },
  ],
  formulas: [
    { formulaId: "INTERNAL_WIDTH", expression: "W - 2*T", variables: ["W", "T"], unit: "MM" },
    { formulaId: "INTERNAL_HEIGHT", expression: "H - 2*T", variables: ["H", "T"], unit: "MM" },
    {
      formulaId: "OVERLAY_SHUTTER_WIDTH",
      expression: "(W - 2*OVERLAY_EDGE_GAP - (N_SHUTTER - 1)*FRONT_BETWEEN_GAP) / N_SHUTTER",
      variables: ["W", "OVERLAY_EDGE_GAP", "N_SHUTTER", "FRONT_BETWEEN_GAP"],
      unit: "MM",
    },
    { formulaId: "OVERLAY_SHUTTER_HEIGHT", expression: "H - OVERLAY_TOP_GAP - OVERLAY_BOTTOM_GAP", variables: ["H", "OVERLAY_TOP_GAP", "OVERLAY_BOTTOM_GAP"], unit: "MM" },
    {
      formulaId: "INSET_SHUTTER_WIDTH",
      expression: "(INTERNAL_WIDTH - 2*INSET_GAP - (N_SHUTTER - 1)*FRONT_BETWEEN_GAP) / N_SHUTTER",
      variables: ["INTERNAL_WIDTH", "INSET_GAP", "N_SHUTTER", "FRONT_BETWEEN_GAP"],
      unit: "MM",
    },
    { formulaId: "INSET_SHUTTER_HEIGHT", expression: "INTERNAL_HEIGHT - 2*INSET_GAP", variables: ["INTERNAL_HEIGHT", "INSET_GAP"], unit: "MM" },
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
      templateId: "BACK", componentType: "BACK", idSuffix: "BCK", instanceSuffix: null, when: null, count: "1",
      plane: "XY", width: "INTERNAL_WIDTH + 2*BACK_GROOVE_DEPTH", height: "H - T + BACK_GROOVE_DEPTH", thickness: "TB",
      position: { x: "T - BACK_GROOVE_DEPTH", y: "T - BACK_GROOVE_DEPTH", z: "BACK_REAR_OFFSET" },
      materialRole: "BACK", finish: null, grainDirection: "NONE",
    },
    {
      templateId: "SHUTTER_OVERLAY", componentType: "SHUTTER", idSuffix: "SHT", instanceSuffix: "LEFT_RIGHT_WHEN_TWO", when: "FRONT_OVERLAY", count: "N_SHUTTER",
      plane: "XY", width: "OVERLAY_SHUTTER_WIDTH", height: "OVERLAY_SHUTTER_HEIGHT", thickness: "T_FRONT",
      position: { x: "OVERLAY_EDGE_GAP + i*(OVERLAY_SHUTTER_WIDTH + FRONT_BETWEEN_GAP)", y: "OVERLAY_BOTTOM_GAP", z: "D + SHUTTER_BACK_GAP" },
      materialRole: "FRONT", finish: { role: "FRONT_FINISH", faces: "FRONT_FINISHED_FACES" }, grainDirection: "HEIGHT",
    },
    {
      templateId: "SHUTTER_INSET", componentType: "SHUTTER", idSuffix: "SHT", instanceSuffix: "LEFT_RIGHT_WHEN_TWO", when: "FRONT_INSET", count: "N_SHUTTER",
      plane: "XY", width: "INSET_SHUTTER_WIDTH", height: "INSET_SHUTTER_HEIGHT", thickness: "T_FRONT",
      position: { x: "T + INSET_GAP + i*(INSET_SHUTTER_WIDTH + FRONT_BETWEEN_GAP)", y: "T + INSET_GAP", z: "D - T_FRONT" },
      materialRole: "FRONT", finish: { role: "FRONT_FINISH", faces: "FRONT_FINISHED_FACES" }, grainDirection: "HEIGHT",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "backMaterial", FRONT: "shutterMaterial" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [
    {
      ruleId: "KBH_CARCASS_THICKNESS_MATCHES_MATERIAL",
      description: "Carcass thickness parameter must equal the carcass board thickness",
      assert: "T == T_CARCASS_MAT",
      severity: "BLOCKER",
      message: "Carcass thickness {T} mm does not match carcass material thickness {T_CARCASS_MAT} mm",
    },
    {
      ruleId: "KBH_BACK_THICKNESS_MATCHES_MATERIAL",
      description: "Back thickness parameter must equal the back board thickness",
      assert: "TB == T_BACK_MAT",
      severity: "BLOCKER",
      message: "Back thickness {TB} mm does not match back material thickness {T_BACK_MAT} mm",
    },
    {
      ruleId: "KBH_WIDTH_EXCEEDS_SIDES",
      description: "Width must leave an internal opening",
      assert: "W > 2*T",
      severity: "BLOCKER",
      message: "Width {W} mm leaves no internal width with {T} mm sides",
    },
    {
      ruleId: "KBH_HEIGHT_EXCEEDS_CARCASS",
      description: "Height must leave an internal opening",
      assert: "H > 2*T",
      severity: "BLOCKER",
      message: "Height {H} mm leaves no internal height with {T} mm bottom",
    },
    {
      ruleId: "KBH_GROOVE_WITHIN_CARCASS",
      description: "Back groove must be shallower than the carcass board",
      assert: "BACK_GROOVE_DEPTH < T",
      severity: "BLOCKER",
      message: "Back groove depth {BACK_GROOVE_DEPTH} mm must be less than carcass thickness {T} mm",
    },
  ],
  edgeRuleSetId: "HOB_CARCASS_STANDARD",
  hardwareRuleSetId: "HOB_STANDARD",
};

/** Every shutter gets a hinge (identical to HINGE_STANDARD). No other hardware: a hob has no drawer, pull-out or waste-bin mechanism. */
export const HOB_STANDARD: HardwareRuleSet = {
  ruleSetId: "HOB_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [
    {
      ruleId: "HINGE_SHUTTER_HOB",
      componentType: "SHUTTER",
      category: "HINGE",
      application: "HINGED_DOOR",
      mounting: { parameterKey: "frontType", map: { OVERLAY: "FULL_OVERLAY", INSET: "INSET" } },
      preferredManufacturer: "HETTICH",
    },
  ],
};
