import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_BASE_PULLOUT — Design Studio Slice 5, step 1 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md`
 * §4D): "reuse the drawer-bank architecture, not a cutout concept at all." A pull-out cabinet is an ordinary
 * shutter-fronted base carcass (identical to KIT_BASE_STANDARD's) with `pulloutCount` internal pull-out frames
 * behind the door, each riding on `RUNNER` hardware — no new geometry primitive, no `Appliance`/`CutoutFeature`
 * concept, no boolean subtraction. Reuses the exact same `i`-indexed per-instance mechanism `DRAWER_BOX_SIDE`
 * (Slice 2) and `SHELF` (Slice 1/3) already use.
 *
 * Parameter defaults are a plausible V1 reference cabinet, not a Lintel-approved value (see `docs/PRD` —
 * production values must still be pinned and approved through the reference-data workflow before any output
 * can be issued).
 */
export const KIT_BASE_PULLOUT: ProductDefinition = {
  productId: "KIT_BASE_PULLOUT",
  version: "1.0.0",
  status: "DRAFT",
  name: "Kitchen base cabinet — pull-out",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "KITCHEN_BASE_PULLOUT_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 300, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "number", key: "carcassThickness", symbol: "T", label: "Carcass thickness", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "backThickness", symbol: "TB", label: "Back thickness", unit: "MM", default: 6, min: null, max: null },
    { kind: "integer", key: "shutterCount", symbol: "N_SHUTTER", label: "Shutter count", default: 1, min: 1, max: 2, allowed: [1, 2] },
    { kind: "integer", key: "pulloutCount", symbol: "N_PULLOUT", label: "Pull-out count", default: 3, min: 1, max: 4, allowed: [1, 2, 3, 4] },
    { kind: "enum", key: "frontType", symbol: "FRONT", label: "Front type", values: ["OVERLAY", "INSET"], default: "OVERLAY" },
    { kind: "material", key: "material", symbol: "T_CARCASS_MAT", label: "Carcass material", default: "BOARD_BWP_18" },
    { kind: "material", key: "backMaterial", symbol: "T_BACK_MAT", label: "Back material", default: "BOARD_BACK_6" },
    { kind: "material", key: "shutterMaterial", symbol: "T_FRONT", label: "Shutter material", default: "BOARD_HDHMR_18" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Shutter finish", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KBPO_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KBPO_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KBPO_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_BASE_PULLOUT-{width}",
    descriptionTemplate: "{width} Pull-Out Base Cabinet",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * KITCHEN_BASE_PULLOUT_V1 recipe. The carcass (sides, bottom, back, top rails) and shutter front are identical
 * to KITCHEN_BASE_STANDARD_V1 (same templates, same formulas) — a pull-out cabinet is a standard cabinet with
 * `pulloutCount` internal frames behind the door instead of loose shelves. Each frame is two sides
 * (`PULLOUT_FRAME_SIDE`) and a tray bottom (`PULLOUT_TRAY`), evenly spaced in the internal height exactly the
 * way KITCHEN_BASE_STANDARD_V1 spaces `SHELF` components — reusing `SHELF_PITCH`'s own formula shape with the
 * frame's own occupied height in place of the shelf's board thickness.
 *
 * Assumptions (explicit, PRD §14):
 * - Sides run full cabinet height; bottom and top rails sit between the sides (identical to the standard carcass).
 * - Overlay/inset shutter positioning is identical to KITCHEN_BASE_STANDARD_V1's own.
 * - Pull-out frames are loose (not fixed to the carcass), evenly spaced, and sit in front of the back panel —
 *   the same simplification KITCHEN_BASE_STANDARD_V1 already applies to shelves.
 * - The pull-out frame is modelled as two board sides plus a thin tray bottom (no dedicated wire-basket
 *   geometry exists; PRD/CLAUDE.md forbid inventing a manufacturer's basket geometry). The frame rides on one
 *   `RUNNER` pair per frame, resolved the same way a drawer box's runner is (Slice 2) — no new hardware model.
 * - Frame sides reuse the carcass material/thickness (MaterialRole CARCASS); the tray reuses the back panel's
 *   thin board (MaterialRole BACK) — identical material-role reuse to KITCHEN_BASE_DRAWER_V1's drawer box.
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const KITCHEN_BASE_PULLOUT_V1: ConstructionRecipe = {
  recipeId: "KITCHEN_BASE_PULLOUT_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "Frameless base carcass: two full-height sides, bottom between sides, front and back top support rails, grooved back, hinged shutter(s), an internal bank of pull-out frames on runners.",
  assumptions: [
    "Sides run full cabinet height; bottom and top rails sit between the sides.",
    "Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top of the carcass.",
    "Rear top rail sits directly in front of the back panel.",
    "Overlay shutters cover the carcass front face, held SHUTTER_BACK_GAP in front of it; inset shutters sit inside the opening below the top rails (no back gap) — identical to KITCHEN_BASE_STANDARD_V1.",
    "Pull-out frames are loose, spaced evenly in the internal height, and sit in front of the back panel — the same simplification already applied to KITCHEN_BASE_STANDARD_V1's shelves.",
    "A pull-out frame is two board sides plus a thin tray bottom; no wire-basket geometry is modelled (no manufacturer basket data exists yet). One RUNNER pair per frame, resolved the same way a drawer box's runner is.",
    "Frame sides reuse the carcass material/thickness; the tray reuses the back panel's thin board — no dedicated pull-out material role exists yet.",
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
    { key: "FRONT_BETWEEN_GAP", description: "Gap between adjacent shutters", unit: "MM" },
    { key: "INSET_GAP", description: "Inset front clearance to the opening on each side", unit: "MM" },
    { key: "FRONT_FINISHED_FACES", description: "Number of shutter faces receiving the front finish", unit: "COUNT" },
    { key: "SHUTTER_BACK_GAP", description: "Gap between the back face of an overlay shutter and the carcass front face", unit: "MM" },
    { key: "PULLOUT_FRAME_HEIGHT", description: "Height of a pull-out frame's side panel (occupied height per pull-out slot)", unit: "MM" },
    { key: "PULLOUT_FRAME_SIDE_CLEARANCE", description: "Total width clearance of a pull-out frame between the internal sides (runner mechanism clearance)", unit: "MM" },
    { key: "PULLOUT_FRAME_DEPTH_SETBACK", description: "Pull-out frame front-wall setback from the carcass front face", unit: "MM" },
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
    { formulaId: "PULLOUT_TRAY_DEPTH", expression: "D - BACK_REAR_OFFSET - TB - PULLOUT_FRAME_DEPTH_SETBACK", variables: ["D", "BACK_REAR_OFFSET", "TB", "PULLOUT_FRAME_DEPTH_SETBACK"], unit: "MM" },
    { formulaId: "PULLOUT_TRAY_WIDTH", expression: "INTERNAL_WIDTH - PULLOUT_FRAME_SIDE_CLEARANCE - 2*T", variables: ["INTERNAL_WIDTH", "PULLOUT_FRAME_SIDE_CLEARANCE", "T"], unit: "MM" },
    { formulaId: "PULLOUT_PITCH", expression: "(INTERNAL_HEIGHT - N_PULLOUT*PULLOUT_FRAME_HEIGHT) / (N_PULLOUT + 1)", variables: ["INTERNAL_HEIGHT", "N_PULLOUT", "PULLOUT_FRAME_HEIGHT"], unit: "MM" },
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
      templateId: "PULLOUT_FRAME_SIDE_LEFT", componentType: "PULLOUT_FRAME_SIDE", idSuffix: "PFL", instanceSuffix: "INDEX", when: null, count: "N_PULLOUT",
      plane: "YZ", width: "PULLOUT_TRAY_DEPTH", height: "PULLOUT_FRAME_HEIGHT", thickness: "T",
      position: { x: "T + PULLOUT_FRAME_SIDE_CLEARANCE / 2", y: "T + (i + 1)*PULLOUT_PITCH + i*PULLOUT_FRAME_HEIGHT", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "PULLOUT_FRAME_SIDE_RIGHT", componentType: "PULLOUT_FRAME_SIDE", idSuffix: "PFR", instanceSuffix: "INDEX", when: null, count: "N_PULLOUT",
      plane: "YZ", width: "PULLOUT_TRAY_DEPTH", height: "PULLOUT_FRAME_HEIGHT", thickness: "T",
      position: { x: "W - T - PULLOUT_FRAME_SIDE_CLEARANCE / 2 - T", y: "T + (i + 1)*PULLOUT_PITCH + i*PULLOUT_FRAME_HEIGHT", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "HEIGHT",
    },
    {
      templateId: "PULLOUT_TRAY", componentType: "PULLOUT_TRAY", idSuffix: "PTR", instanceSuffix: "INDEX", when: null, count: "N_PULLOUT",
      plane: "XZ", width: "PULLOUT_TRAY_WIDTH", height: "PULLOUT_TRAY_DEPTH", thickness: "TB",
      position: { x: "T + PULLOUT_FRAME_SIDE_CLEARANCE / 2 + T", y: "T + (i + 1)*PULLOUT_PITCH + i*PULLOUT_FRAME_HEIGHT", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "BACK", finish: null, grainDirection: "WIDTH",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "backMaterial", FRONT: "shutterMaterial" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [
    {
      ruleId: "KBPO_CARCASS_THICKNESS_MATCHES_MATERIAL",
      description: "Carcass thickness parameter must equal the carcass board thickness",
      assert: "T == T_CARCASS_MAT",
      severity: "BLOCKER",
      message: "Carcass thickness {T} mm does not match carcass material thickness {T_CARCASS_MAT} mm",
    },
    {
      ruleId: "KBPO_BACK_THICKNESS_MATCHES_MATERIAL",
      description: "Back thickness parameter must equal the back board thickness",
      assert: "TB == T_BACK_MAT",
      severity: "BLOCKER",
      message: "Back thickness {TB} mm does not match back material thickness {T_BACK_MAT} mm",
    },
    {
      ruleId: "KBPO_WIDTH_EXCEEDS_SIDES",
      description: "Width must leave an internal opening",
      assert: "W > 2*T",
      severity: "BLOCKER",
      message: "Width {W} mm leaves no internal width with {T} mm sides",
    },
    {
      ruleId: "KBPO_HEIGHT_EXCEEDS_CARCASS",
      description: "Height must leave an internal opening",
      assert: "H > 2*T",
      severity: "BLOCKER",
      message: "Height {H} mm leaves no internal height with {T} mm bottom and rails",
    },
    {
      ruleId: "KBPO_GROOVE_WITHIN_CARCASS",
      description: "Back groove must be shallower than the carcass board",
      assert: "BACK_GROOVE_DEPTH < T",
      severity: "BLOCKER",
      message: "Back groove depth {BACK_GROOVE_DEPTH} mm must be less than carcass thickness {T} mm",
    },
    {
      ruleId: "KBPO_PULLOUT_PITCH_POSITIVE",
      description: "Pull-out frames must fit within the internal height with a positive gap between them",
      assert: "PULLOUT_PITCH > 0",
      severity: "BLOCKER",
      message: "Pull-out count {N_PULLOUT} does not fit the internal height; reduce pull-out count, increase cabinet height, or reduce PULLOUT_FRAME_HEIGHT",
    },
    {
      ruleId: "KBPO_PULLOUT_TRAY_WIDTH_POSITIVE",
      description: "The pull-out tray must have a positive width",
      assert: "PULLOUT_TRAY_WIDTH > 0",
      severity: "BLOCKER",
      message: "Pull-out tray width {PULLOUT_TRAY_WIDTH} mm is not positive; reduce PULLOUT_FRAME_SIDE_CLEARANCE or increase cabinet width",
    },
  ],
  edgeRuleSetId: "PULLOUT_CARCASS_STANDARD",
  hardwareRuleSetId: "PULLOUT_STANDARD",
};

/** Every shutter gets a hinge (identical to HINGE_STANDARD); every pull-out frame side gets a runner pair (identical mechanism to DRAWER_STANDARD's `RUNNER_DRAWER_BOX`). */
export const PULLOUT_STANDARD: HardwareRuleSet = {
  ruleSetId: "PULLOUT_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [
    {
      ruleId: "HINGE_SHUTTER_PULLOUT",
      componentType: "SHUTTER",
      category: "HINGE",
      application: "HINGED_DOOR",
      mounting: { parameterKey: "frontType", map: { OVERLAY: "FULL_OVERLAY", INSET: "INSET" } },
      preferredManufacturer: "HETTICH",
    },
    { ruleId: "RUNNER_PULLOUT_FRAME", componentType: "PULLOUT_FRAME_SIDE", category: "RUNNER", application: "DRAWER", preferredManufacturer: "HETTICH" },
  ],
};
