import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "@lintel/types";

/**
 * KIT_FILLER — Design Studio Slice 6C (a filler panel, closing a small gap between a cabinet and a wall,
 * appliance or corner). A single finished panel, nothing else: no carcass, no front, no internals, no
 * hardware. Placed and validated through the exact same DesignObject/room/BOM pipeline every cabinet already
 * uses (`packages/design-engine/src/room.ts` computes its wall placement, run membership and collisions
 * identically to a real cabinet's), so no engine change was needed — only this product/recipe pair. Parameter
 * defaults are a plausible V1 placeholder (a narrow gap-filler strip), not a Lintel-approved value (see
 * `docs/PRD` — production values must still be pinned and approved through the reference-data workflow).
 */
export const KIT_FILLER: ProductDefinition = {
  productId: "KIT_FILLER",
  version: "1.0.0",
  status: "DRAFT",
  name: "Filler panel",
  category: "KITCHEN_BASE",
  objectType: "BASE_CABINET",
  recipeId: "FILLER_STANDARD_V1",
  parameters: [
    { kind: "number", key: "width", symbol: "W", label: "Width", unit: "MM", default: 100, min: null, max: null },
    { kind: "number", key: "height", symbol: "H", label: "Height", unit: "MM", default: 720, min: null, max: null },
    { kind: "number", key: "depth", symbol: "D", label: "Depth", unit: "MM", default: 560, min: null, max: null },
    { kind: "material", key: "material", symbol: "T_MAT", label: "Panel material", default: "BOARD_BWP_18" },
    { kind: "finish", key: "finish", symbol: "FINISH", label: "Finish", default: "LAMINATE_WHITE" },
  ],
  rules: [
    { ruleId: "KFI_POSITIVE_WIDTH", description: "Width must be positive", assert: "W > 0", severity: "BLOCKER", message: "Width must be greater than 0 mm (got {W})" },
    { ruleId: "KFI_POSITIVE_HEIGHT", description: "Height must be positive", assert: "H > 0", severity: "BLOCKER", message: "Height must be greater than 0 mm (got {H})" },
    { ruleId: "KFI_POSITIVE_DEPTH", description: "Depth must be positive", assert: "D > 0", severity: "BLOCKER", message: "Depth must be greater than 0 mm (got {D})" },
  ],
  boq: {
    itemCodeTemplate: "KIT_FILLER-{width}",
    descriptionTemplate: "{width} Filler Panel",
    unit: "NOS",
    quantity: "1",
  },
};

/**
 * FILLER_STANDARD_V1 recipe: exactly one `FILLER` component, a finished vertical panel shaped like a real
 * gap-filler strip — a shutter-like flat board (width × height face, plane XY, exactly `SHUTTER`'s own
 * orientation), its own physical thickness sourced directly from the assigned material (`T_MAT`, a
 * `kind: "material"` parameter, which the engine resolves to that material's real registered thickness — so
 * this can never fail the generic component/material thickness check: it IS the material's own thickness, by
 * construction, not a value that could disagree with it). `depth` is intentionally not read by this component:
 * a real filler strip is a thin board mounted at the front of a gap, not a full-depth carcass side (unlike a
 * cabinet, whose sides run the full depth) — `depth` is kept as a declared field only because a designer still
 * places a filler within a run of a given depth, and it seeds the object's own `dimensions.depthMm` default.
 *
 * Assumptions (explicit, PRD §14):
 * - A filler has no carcass, front, internals or hardware — it is the one finished panel, full stop.
 * - The panel's own thickness is the assigned material's real thickness; `width`/`height` are its face.
 * - Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.
 */
export const FILLER_STANDARD_V1: ConstructionRecipe = {
  recipeId: "FILLER_STANDARD_V1",
  version: "1.0.0",
  status: "DRAFT",
  productType: "KITCHEN_BASE",
  description: "One finished panel, no carcass, no front, no internals.",
  assumptions: [
    "A filler is a single finished panel filling a gap between a cabinet and a wall, appliance or corner.",
    "The panel's own thickness is the assigned material's real thickness, not an independent dimension.",
    "Panel dimensions are finished sizes; cut-size allowances belong to the manufacturing engine.",
  ],
  constructionVariables: [
    { key: "FRONT_FINISHED_FACES", description: "Number of the filler's faces receiving the front finish", unit: "COUNT" },
  ],
  formulas: [],
  components: [
    {
      templateId: "FILLER", componentType: "FILLER", idSuffix: "FIL", instanceSuffix: null, when: null, count: "1",
      plane: "XY", width: "W", height: "H", thickness: "T_MAT", position: { x: "0", y: "0", z: "0" },
      materialRole: "FRONT", finish: { role: "FRONT_FINISH", faces: "FRONT_FINISHED_FACES" }, grainDirection: "HEIGHT",
    },
  ],
  materialRoles: { CARCASS: "material", BACK: "material", FRONT: "material" },
  finishRoles: { FRONT_FINISH: "finish" },
  rules: [],
  edgeRuleSetId: "FILLER_CARCASS_STANDARD",
  hardwareRuleSetId: "FILLER_STANDARD",
};

/** A filler has no door, no hardware of any kind: zero rules is the correct, complete hardware rule set. */
export const FILLER_STANDARD: HardwareRuleSet = {
  ruleSetId: "FILLER_STANDARD",
  version: "1.0.0",
  status: "DRAFT",
  rules: [],
};
