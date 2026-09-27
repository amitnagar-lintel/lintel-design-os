import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_END_PANEL — Design Studio Slice 6C (a decorative end panel skinning the exposed side of a run's end
 * cabinet). Structurally identical to `KIT_FILLER` (one finished panel, no carcass/front/internals/hardware,
 * placed through the same DesignObject/room/BOM pipeline as any cabinet) — the two are separate products only
 * because their real-world defaults and purpose differ (a filler closes a gap; an end panel skins an exposed
 * side, so it defaults to a thin skin rather than a wide strip). Parameter defaults are a plausible V1
 * placeholder, not a Lintel-approved value (see `docs/PRD` — production values must still be pinned and
 * approved through the reference-data workflow).
 */
export const KIT_END_PANEL: ProductDefinition = {
  productId: "KIT_END_PANEL",
  version: "1.0.0",
  status: "DRAFT",
  name: "End panel",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "END_PANEL_STANDARD_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 18, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "material", key: "material", symbol: "T_MAT", label: "Panel material", default: "BOARD_BWP_18" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Finish", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KEP_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KEP_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KEP_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_END_PANEL-{width}",
    descriptionTemplate: "{width} End Panel",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * END_PANEL_STANDARD_V1 recipe: exactly one `END_PANEL` component, shaped identically to `FILLER_STANDARD_V1`'s
 * own single panel (see that recipe's own doc comment for the width/height/depth-to-axis mapping).
 *
 * Assumptions (explicit, PRD §14):
 * - An end panel has no carcass, front, internals or hardware — it is the one finished panel, full stop.
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const END_PANEL_STANDARD_V1: ConstructionRecipe = {
  recipeId: "END_PANEL_STANDARD_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "One finished panel, no carcass, no front, no internals.",
  assumptions: [
    "An end panel is a single finished panel skinning the exposed side of a run's end cabinet.",
    "The panel's own board thickness is its along-wall footprint width; height and depth match the run it skins.",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
  ],
  constructionVariables: [
    { key: "FRONT_FINISHED_FACES", description: "Number of the end panel's faces receiving the front finish", unit: "COUNT" },
  ],
  formulas: [],
  components: [
    {
      templateId: "END_PANEL", componentType: "END_PANEL", idSuffix: "ENP", instanceSuffix: null, when: null, count: "1",
      plane: "YZ", width: "D", height: "H", thickness: "W", position: { x: "0", y: "0", z: "0" },
      materialRole: "FRONT", finish: { role: "FRONT_FINISH", faces: "FRONT_FINISHED_FACES" }, grainDirection: "HEIGHT",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "material", FRONT: "material" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [],
  edgeRuleSetId: "END_PANEL_CARCASS_STANDARD",
  hardwareRuleSetId: "END_PANEL_STANDARD",
};

/** An end panel has no door, no hardware of any kind: zero rules is the correct, complete hardware rule set. */
export const END_PANEL_STANDARD: HardwareRuleSet = {
  ruleSetId: "END_PANEL_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [],
};
