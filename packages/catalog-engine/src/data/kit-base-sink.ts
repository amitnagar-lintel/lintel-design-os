import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_BASE_SINK — Design Studio Slice 5 step 4 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md`
 * §4A): "Sink cabinet — recipe variant, no cutout on the cabinet." The worktop hole belongs to the (not yet
 * built) countertop object, not to this cabinet (Slice 5 step 6) — this recipe only carries the two real
 * carcass differences a sink cabinet needs: no rear top rail (plumbing/waste-trap clearance) and an optional
 * internal waste-bin tray, reusing the exact same `PULLOUT_FRAME_SIDE`/`PULLOUT_TRAY` component types and
 * construction variables Slice 5 step 1 already introduced (a waste-bin tray is physically the same kind of
 * loose frame-and-tray assembly as a pull-out — no new `ComponentType`, no new migration).
 *
 * Parameter defaults are a plausible V1 reference cabinet, not a Lintel-approved value (see `docs/PRD` —
 * production values must still be pinned and approved through the reference-data workflow before any output
 * can be issued).
 */
export const KIT_BASE_SINK: ProductDefinition = {
  productId: "KIT_BASE_SINK",
  version: "1.0.0",
  status: "DRAFT",
  name: "Kitchen base cabinet — sink",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "KITCHEN_BASE_SINK_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 600, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "number", key: "carcassThickness", symbol: "T", label: "Carcass thickness", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "backThickness", symbol: "TB", label: "Back thickness", unit: "MM", default: 6, min: null, max: null },
    { kind: "integer", key: "shutterCount", symbol: "N_SHUTTER", label: "Shutter count", default: 2, min: 1, max: 2, allowed: [1, 2] },
    { kind: "enum", key: "frontType", symbol: "FRONT", label: "Front type", values: ["OVERLAY", "INSET"], default: "OVERLAY" },
    { kind: "enum", key: "internalConfig", symbol: "ICFG", label: "Internal configuration", values: ["OPEN", "WASTE_BIN"], default: "OPEN" },
    { kind: "material", key: "material", symbol: "T_CARCASS_MAT", label: "Carcass material", default: "BOARD_BWP_18" },
    { kind: "material", key: "backMaterial", symbol: "T_BACK_MAT", label: "Back material", default: "BOARD_BACK_6" },
    { kind: "material", key: "shutterMaterial", symbol: "T_FRONT", label: "Shutter material", default: "BOARD_HDHMR_18" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Shutter finish", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KBSK_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KBSK_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KBSK_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_BASE_SINK-{width}",
    descriptionTemplate: "{width} Sink Base Cabinet",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * KITCHEN_BASE_SINK_V1 recipe. The carcass and shutter front are identical to KITCHEN_BASE_STANDARD_V1's own,
 * minus the rear top support rail (omitted, not `when`-gated: a sink cabinet never has one). The countertop's
 * own future cutout (Slice 5 step 6) references this cabinet's position only — nothing about this recipe's
 * own components changes because of it (design doc §4A).
 *
 * Assumptions (explicit, PRD §14):
 * - Sides run full cabinet height; bottom sits between the sides; only the FRONT top rail exists — there is no
 *   rear top rail, leaving clearance for the sink bowl's waste trap and plumbing. This is a permanent
 *   construction decision for this recipe, not a per-instance option.
 * - Overlay/inset shutter positioning is identical to KITCHEN_BASE_STANDARD_V1's own.
 * - The optional internal waste-bin tray is modelled exactly like a Slice 5 step 1 pull-out frame (two board
 *   sides plus a thin tray bottom, one `RUNNER` pair, same construction variables) — centred in the internal
 *   height rather than evenly spaced, since there is exactly one.
 * - Cabinet height excludes legs/plinth and worktop (none modelled in V1).
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const KITCHEN_BASE_SINK_V1: ConstructionRecipe = {
  recipeId: "KITCHEN_BASE_SINK_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "Frameless base carcass: two full-height sides, bottom between sides, front top support rail only (no rear rail — plumbing clearance), grooved back, hinged shutter(s), an optional internal waste-bin tray on runners.",
  assumptions: [
    "Sides run full cabinet height; bottom sits between the sides.",
    "There is no rear top support rail: the sink bowl's waste trap and plumbing need the clearance. This is a permanent decision for this recipe, not a per-instance option.",
    "Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top of the carcass.",
    "Overlay shutters cover the carcass front face, held SHUTTER_BACK_GAP in front of it; inset shutters sit inside the opening below the front top rail (no back gap) — identical to KITCHEN_BASE_STANDARD_V1.",
    "The optional waste-bin tray is two board sides plus a thin tray bottom, centred in the internal height, riding on one RUNNER pair — the same construction variables and mechanism as a Slice 5 step 1 pull-out frame.",
    "Frame sides reuse the carcass material/thickness; the tray reuses the back panel's thin board — no dedicated waste-bin material role exists yet.",
    "Cabinet height excludes legs/plinth and worktop (none modelled in V1).",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
    "The countertop cutout for the sink bowl belongs to the future countertop object (Slice 5 step 6), not to this cabinet: this recipe's own components are unaffected by it.",
  ],
  constructionVariables: [
    { key: "BACK_GROOVE_DEPTH", description: "Depth of the back-panel groove in sides and bottom", unit: "MM" },
    { key: "BACK_REAR_OFFSET", description: "Distance from carcass rear edge to the back panel's rear face", unit: "MM" },
    { key: "TOP_RAIL_WIDTH", description: "Depth (front-to-back) of the front top support rail", unit: "MM" },
    { key: "OVERLAY_EDGE_GAP", description: "Overlay front reveal at each outer side edge", unit: "MM" },
    { key: "OVERLAY_TOP_GAP", description: "Overlay front reveal at the top", unit: "MM" },
    { key: "OVERLAY_BOTTOM_GAP", description: "Overlay front reveal at the bottom", unit: "MM" },
    { key: "FRONT_BETWEEN_GAP", description: "Gap between adjacent shutters", unit: "MM" },
    { key: "INSET_GAP", description: "Inset front clearance to the opening on each side", unit: "MM" },
    { key: "FRONT_FINISHED_FACES", description: "Number of shutter faces receiving the front finish", unit: "COUNT" },
    { key: "SHUTTER_BACK_GAP", description: "Gap between the back face of an overlay shutter and the carcass front face", unit: "MM" },
    { key: "PULLOUT_FRAME_HEIGHT", description: "Height of the waste-bin tray's side panel (occupied height)", unit: "MM" },
    { key: "PULLOUT_FRAME_SIDE_CLEARANCE", description: "Total width clearance of the waste-bin tray between the internal sides (runner mechanism clearance)", unit: "MM" },
    { key: "PULLOUT_FRAME_DEPTH_SETBACK", description: "Waste-bin tray front-wall setback from the carcass front face", unit: "MM" },
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
    { formulaId: "WASTE_BIN_TRAY_DEPTH", expression: "D - BACK_REAR_OFFSET - TB - PULLOUT_FRAME_DEPTH_SETBACK", variables: ["D", "BACK_REAR_OFFSET", "TB", "PULLOUT_FRAME_DEPTH_SETBACK"], unit: "MM" },
    { formulaId: "WASTE_BIN_TRAY_WIDTH", expression: "INTERNAL_WIDTH - PULLOUT_FRAME_SIDE_CLEARANCE - 2*T", variables: ["INTERNAL_WIDTH", "PULLOUT_FRAME_SIDE_CLEARANCE", "T"], unit: "MM" },
    { formulaId: "WASTE_BIN_OFFSET", expression: "(INTERNAL_HEIGHT - PULLOUT_FRAME_HEIGHT) / 2", variables: ["INTERNAL_HEIGHT", "PULLOUT_FRAME_HEIGHT"], unit: "MM" },
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
    {
      templateId: "WASTE_BIN_FRAME_SIDE_LEFT", componentType: "PULLOUT_FRAME_SIDE", idSuffix: "WBL", instanceSuffix: null, when: "ICFG_WASTE_BIN", count: "1",
      plane: "YZ", width: "WASTE_BIN_TRAY_DEPTH", height: "PULLOUT_FRAME_HEIGHT", thickness: "T",
      position: { x: "T + PULLOUT_FRAME_SIDE_CLEARANCE / 2", y: "T + WASTE_BIN_OFFSET", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "WASTE_BIN_FRAME_SIDE_RIGHT", componentType: "PULLOUT_FRAME_SIDE", idSuffix: "WBR", instanceSuffix: null, when: "ICFG_WASTE_BIN", count: "1",
      plane: "YZ", width: "WASTE_BIN_TRAY_DEPTH", height: "PULLOUT_FRAME_HEIGHT", thickness: "T",
      position: { x: "W - T - PULLOUT_FRAME_SIDE_CLEARANCE / 2 - T", y: "T + WASTE_BIN_OFFSET", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "WASTE_BIN_TRAY", componentType: "PULLOUT_TRAY", idSuffix: "WBT", instanceSuffix: null, when: "ICFG_WASTE_BIN", count: "1",
      plane: "XZ", width: "WASTE_BIN_TRAY_WIDTH", height: "WASTE_BIN_TRAY_DEPTH", thickness: "TB",
      position: { x: "T + PULLOUT_FRAME_SIDE_CLEARANCE / 2 + T", y: "T + WASTE_BIN_OFFSET", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "BACK", finish: null, grainDirection: "WIDTH",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "backMaterial", FRONT: "shutterMaterial" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [
    {
      ruleId: "KBSK_CARCASS_THICKNESS_MATCHES_MATERIAL",
      description: "Carcass thickness parameter must equal the carcass board thickness",
      assert: "T == T_CARCASS_MAT",
      severity: "BLOCKER",
      message: "Carcass thickness {T} mm does not match carcass material thickness {T_CARCASS_MAT} mm",
    },
    {
      ruleId: "KBSK_BACK_THICKNESS_MATCHES_MATERIAL",
      description: "Back thickness parameter must equal the back board thickness",
      assert: "TB == T_BACK_MAT",
      severity: "BLOCKER",
      message: "Back thickness {TB} mm does not match back material thickness {T_BACK_MAT} mm",
    },
    {
      ruleId: "KBSK_WIDTH_EXCEEDS_SIDES",
      description: "Width must leave an internal opening",
      assert: "W > 2*T",
      severity: "BLOCKER",
      message: "Width {W} mm leaves no internal width with {T} mm sides",
    },
    {
      ruleId: "KBSK_HEIGHT_EXCEEDS_CARCASS",
      description: "Height must leave an internal opening",
      assert: "H > 2*T",
      severity: "BLOCKER",
      message: "Height {H} mm leaves no internal height with {T} mm bottom and rail",
    },
    {
      ruleId: "KBSK_GROOVE_WITHIN_CARCASS",
      description: "Back groove must be shallower than the carcass board",
      assert: "BACK_GROOVE_DEPTH < T",
      severity: "BLOCKER",
      message: "Back groove depth {BACK_GROOVE_DEPTH} mm must be less than carcass thickness {T} mm",
    },
    {
      ruleId: "KBSK_WASTE_BIN_OFFSET_POSITIVE",
      description: "The waste-bin tray must fit within the internal height",
      when: "ICFG_WASTE_BIN",
      assert: "WASTE_BIN_OFFSET > 0",
      severity: "BLOCKER",
      message: "Waste-bin tray does not fit the internal height; increase cabinet height or reduce PULLOUT_FRAME_HEIGHT",
    },
    {
      ruleId: "KBSK_WASTE_BIN_TRAY_WIDTH_POSITIVE",
      description: "The waste-bin tray must have a positive width",
      when: "ICFG_WASTE_BIN",
      assert: "WASTE_BIN_TRAY_WIDTH > 0",
      severity: "BLOCKER",
      message: "Waste-bin tray width {WASTE_BIN_TRAY_WIDTH} mm is not positive; reduce PULLOUT_FRAME_SIDE_CLEARANCE or increase cabinet width",
    },
  ],
  edgeRuleSetId: "SINK_CARCASS_STANDARD",
  hardwareRuleSetId: "SINK_STANDARD",
};

/** Every shutter gets a hinge (identical to HINGE_STANDARD); the waste-bin tray, when present, gets one runner pair (identical mechanism to PULLOUT_STANDARD's own). */
export const SINK_STANDARD: HardwareRuleSet = {
  ruleSetId: "SINK_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [
    {
      ruleId: "HINGE_SHUTTER_SINK",
      componentType: "SHUTTER",
      category: "HINGE",
      application: "HINGED_DOOR",
      mounting: { parameterKey: "frontType", map: { OVERLAY: "FULL_OVERLAY", INSET: "INSET" } },
      preferredManufacturer: "HETTICH",
    },
    { ruleId: "RUNNER_WASTE_BIN", componentType: "PULLOUT_FRAME_SIDE", category: "RUNNER", application: "DRAWER", preferredManufacturer: "HETTICH" },
  ],
};
