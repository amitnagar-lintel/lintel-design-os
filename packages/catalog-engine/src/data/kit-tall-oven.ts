import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_TALL_OVEN — Design Studio Slice 5 step 3 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md`
 * §4C): the first cabinet whose geometry is genuinely sized from an `Appliance` reference, not an invented
 * dimension. Per the design doc's Option C: "a tall-cabinet carcass whose shelf/partition templates are
 * `when`-gated to leave a void exactly sized to `Appliance.installation` plus the appliance's own clearances."
 * In this recipe the void needs no `when`-gating at all — it falls out of the geometry naturally: the carcass
 * (identical sides/bottom/rails/back to `KITCHEN_BASE_STANDARD_V1`, just full tall-cabinet height) has no front
 * and no shelf ever generated below `OVEN_BAY_BOTTOM_OFFSET + OVEN_H` (the appliance's own `installation`
 * height, read from the catalog, never invented) — shelves are generated only in the space above the bay, by
 * construction of `SHELF_PITCH_ABOVE`'s own formula. No new `ComponentType`, no boolean subtraction, no
 * geometry hack: this is `KIT_BASE_OPEN`'s exact shelf mechanism, offset to start above a real appliance
 * envelope instead of at the carcass floor.
 *
 * The appliance itself is never a `ComponentType`/`CabinetComponent` (PRD §16's closed union stays boxes-only;
 * it is not a board Lintel manufactures) — it is referenced data, resolved through the new `appliance`
 * parameter kind exactly the way a Hettich hinge article or a catalog material is referenced today, and shown
 * in the BOM as its own `"APPLIANCE"` line (Slice 5's isolated `BOMItem` widening), never fabricated geometry.
 *
 * Parameter defaults are a plausible V1 reference cabinet, not a Lintel-approved value (see `docs/PRD` —
 * production values must still be pinned and approved through the reference-data workflow before any output
 * can be issued). `OVEN_REFERENCE_60CM` (`data/appliances.ts`) is likewise a plausible engineering placeholder,
 * not a manufacturer-verified specification.
 */
export const KIT_TALL_OVEN: ProductDefinition = {
  productId: "KIT_TALL_OVEN",
  version: "1.0.0",
  status: "DRAFT",
  name: "Kitchen tall cabinet — oven tower",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "KITCHEN_TALL_OVEN_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 600, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 2000, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "number", key: "carcassThickness", symbol: "T", label: "Carcass thickness", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "backThickness", symbol: "TB", label: "Back thickness", unit: "MM", default: 6, min: null, max: null },
    { kind: "appliance", key: "oven", symbol: "OVEN", label: "Oven", default: "OVEN_REFERENCE_60CM" },
    { kind: "integer", key: "shelfCountAbove", symbol: "N_SHELF", label: "Shelf count (above the oven)", default: 2, min: 0, max: null, allowed: null },
    { kind: "material", key: "material", symbol: "T_CARCASS_MAT", label: "Carcass material", default: "BOARD_BWP_18" },
    { kind: "material", key: "backMaterial", symbol: "T_BACK_MAT", label: "Back material", default: "BOARD_BACK_6" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Finish (unused: no front this slice)", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KTO_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KTO_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KTO_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_TALL_OVEN-{width}",
    descriptionTemplate: "{width} Oven Tower",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * KITCHEN_TALL_OVEN_V1 recipe. Carcass (sides, bottom, back, top rails) identical to KITCHEN_BASE_STANDARD_V1,
 * just at tall-cabinet height. No front (like KITCHEN_BASE_OPEN_V1) — the appliance sits behind whatever front
 * a later slice or the appliance's own door provides; this slice's job is the structural void and the
 * appliance reference, not a bespoke oven door.
 *
 * Assumptions (explicit, PRD §14):
 * - Sides run full cabinet height; bottom and top rails sit between the sides.
 * - Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top
 *   of the carcass.
 * - Rear top rail sits directly in front of the back panel.
 * - The oven bay's bottom sits OVEN_BAY_BOTTOM_OFFSET above the carcass floor (a real, named construction
 *   value — never invented; NULL/UNVERIFIED until a construction standard supplies it, exactly like every
 *   other construction variable in this recipe).
 * - The bay's own size comes only from the referenced Appliance's `installation` envelope (OVEN_W/H/D) — never
 *   a separately-entered dimension, so the bay and the appliance can never disagree.
 * - Shelves above the bay are loose, spaced evenly in the remaining internal height, and sit in front of the
 *   back panel (identical to KITCHEN_BASE_STANDARD_V1's own shelves).
 * - No shelf, partition or front is ever generated inside the bay's own span: this falls out of the pitch
 *   formula (space above the bay only), not a `when`-gated suppression.
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const KITCHEN_TALL_OVEN_V1: ConstructionRecipe = {
  recipeId: "KITCHEN_TALL_OVEN_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "Frameless tall carcass: two full-height sides, bottom between sides, front and back top support rails, grooved back, no front, an oven bay sized from the referenced Appliance, loose shelves above.",
  assumptions: [
    "Sides run full cabinet height; bottom and top rails sit between the sides.",
    "Back panel is housed in grooves in both sides and the bottom (depth BACK_GROOVE_DEPTH) and runs to the top of the carcass.",
    "Rear top rail sits directly in front of the back panel.",
    "The oven bay's bottom sits OVEN_BAY_BOTTOM_OFFSET above the carcass floor — a real, named construction value, never invented.",
    "The bay's own size comes only from the referenced Appliance's installation envelope (OVEN_W/H/D), never a separately-entered dimension.",
    "Shelves above the bay are loose, spaced evenly in the remaining internal height, and sit in front of the back panel — identical to KITCHEN_BASE_STANDARD_V1's own shelves.",
    "No shelf is ever generated inside the bay's own span: this falls out of the shelf-pitch formula (space above the bay only), never a when-gated suppression.",
    "Cabinet height excludes legs/plinth and worktop (none modelled in V1).",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
  ],
  constructionVariables: [
    { key: "BACK_GROOVE_DEPTH", description: "Depth of the back-panel groove in sides and bottom", unit: "MM" },
    { key: "BACK_REAR_OFFSET", description: "Distance from carcass rear edge to the back panel's rear face", unit: "MM" },
    { key: "TOP_RAIL_WIDTH", description: "Depth (front-to-back) of each top support rail", unit: "MM" },
    { key: "SHELF_FRONT_SETBACK", description: "Shelf front edge setback from carcass front", unit: "MM" },
    { key: "SHELF_SIDE_CLEARANCE", description: "Total width clearance of a loose shelf between sides", unit: "MM" },
    { key: "OVEN_BAY_BOTTOM_OFFSET", description: "Height from the carcass floor to the bottom of the oven bay", unit: "MM" },
  ],
  formulas: [
    { formulaId: "INTERNAL_WIDTH", expression: "W - 2*T", variables: ["W", "T"], unit: "MM" },
    { formulaId: "INTERNAL_HEIGHT", expression: "H - 2*T", variables: ["H", "T"], unit: "MM" },
    { formulaId: "OVEN_BAY_TOP", expression: "OVEN_BAY_BOTTOM_OFFSET + OVEN_H", variables: ["OVEN_BAY_BOTTOM_OFFSET", "OVEN_H"], unit: "MM" },
    { formulaId: "SHELF_DEPTH", expression: "D - BACK_REAR_OFFSET - TB - SHELF_FRONT_SETBACK", variables: ["D", "BACK_REAR_OFFSET", "TB", "SHELF_FRONT_SETBACK"], unit: "MM" },
    { formulaId: "SHELF_SPACE_ABOVE", expression: "INTERNAL_HEIGHT - OVEN_BAY_TOP - N_SHELF*T", variables: ["INTERNAL_HEIGHT", "N_SHELF", "OVEN_BAY_TOP", "T"], unit: "MM" },
    { formulaId: "SHELF_PITCH_ABOVE", expression: "SHELF_SPACE_ABOVE / (N_SHELF + 1)", variables: ["N_SHELF", "SHELF_SPACE_ABOVE"], unit: "MM" },
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
      templateId: "SHELF_ABOVE_OVEN", componentType: "SHELF", idSuffix: "SHF", instanceSuffix: "INDEX", when: null, count: "N_SHELF",
      plane: "XZ", width: "INTERNAL_WIDTH - SHELF_SIDE_CLEARANCE", height: "SHELF_DEPTH", thickness: "T",
      position: { x: "T + SHELF_SIDE_CLEARANCE / 2", y: "OVEN_BAY_TOP + (i + 1)*SHELF_PITCH_ABOVE + i*T", z: "BACK_REAR_OFFSET + TB" },
      materialRole: "CARCASS", finish: null, grainDirection: "WIDTH",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "backMaterial", FRONT: "material" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [
    {
      ruleId: "KTO_CARCASS_THICKNESS_MATCHES_MATERIAL",
      description: "Carcass thickness parameter must equal the carcass board thickness",
      assert: "T == T_CARCASS_MAT",
      severity: "BLOCKER",
      message: "Carcass thickness {T} mm does not match carcass material thickness {T_CARCASS_MAT} mm",
    },
    {
      ruleId: "KTO_BACK_THICKNESS_MATCHES_MATERIAL",
      description: "Back thickness parameter must equal the back board thickness",
      assert: "TB == T_BACK_MAT",
      severity: "BLOCKER",
      message: "Back thickness {TB} mm does not match back material thickness {T_BACK_MAT} mm",
    },
    {
      ruleId: "KTO_WIDTH_EXCEEDS_SIDES",
      description: "Width must leave an internal opening",
      assert: "W > 2*T",
      severity: "BLOCKER",
      message: "Width {W} mm leaves no internal width with {T} mm sides",
    },
    {
      ruleId: "KTO_HEIGHT_EXCEEDS_CARCASS",
      description: "Height must leave an internal opening",
      assert: "H > 2*T",
      severity: "BLOCKER",
      message: "Height {H} mm leaves no internal height with {T} mm bottom and rails",
    },
    {
      ruleId: "KTO_GROOVE_WITHIN_CARCASS",
      description: "Back groove must be shallower than the carcass board",
      assert: "BACK_GROOVE_DEPTH < T",
      severity: "BLOCKER",
      message: "Back groove depth {BACK_GROOVE_DEPTH} mm must be less than carcass thickness {T} mm",
    },
    {
      ruleId: "KTO_OVEN_BAY_FITS",
      description: "The oven bay (its own floor offset plus the referenced appliance's installation height) must fit within the internal height",
      assert: "OVEN_BAY_TOP <= INTERNAL_HEIGHT",
      severity: "BLOCKER",
      message: "Oven bay top {OVEN_BAY_TOP} mm exceeds the internal height {INTERNAL_HEIGHT} mm; reduce OVEN_BAY_BOTTOM_OFFSET or increase cabinet height",
    },
    {
      ruleId: "KTO_SHELF_SPACE_ABOVE_POSITIVE",
      description: "The space above the oven bay must be positive once every shelf's own thickness is subtracted",
      assert: "SHELF_SPACE_ABOVE > 0",
      severity: "BLOCKER",
      message: "No positive space remains above the oven bay for {N_SHELF} shelf(-ves); reduce shelf count or increase cabinet height",
    },
  ],
  edgeRuleSetId: "OVEN_TOWER_CARCASS_STANDARD",
  hardwareRuleSetId: "OVEN_TOWER_STANDARD",
};

/** No hardware: an oven tower (this slice) has no shutter and no runner — zero rules is correct, not incomplete (identical precedent to OPEN_STANDARD). */
export const OVEN_TOWER_STANDARD: HardwareRuleSet = {
  ruleSetId: "OVEN_TOWER_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [],
};
