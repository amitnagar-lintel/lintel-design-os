import type { DataStatus, Millimetres } from "./common.js";
import type { FormulaDefinition, RuleDefinition } from "./formula.js";
import type { ComponentType, EdgeSide, GrainDirection, PanelPlane } from "./component.js";
import type { HardwareCategory, HingeMounting } from "./hardware.js";

/* ------------------------------------------------------------------ parameters */

interface ParameterBase {
  /** Key used in DesignObject.parameters / dimensions (e.g. "width"). */
  readonly key: string;
  /** Symbol exposed to formulas (e.g. "W"). */
  readonly symbol: string;
  readonly label: string;
}

export interface NumberParameterDefinition extends ParameterBase {
  readonly kind: "number";
  readonly unit: "MM";
  readonly default: Millimetres;
  /** Product limits. `null` = not configured (no limit check is performed). */
  readonly min: Millimetres | null;
  readonly max: Millimetres | null;
}

export interface IntegerParameterDefinition extends ParameterBase {
  readonly kind: "integer";
  readonly default: number;
  readonly min: number | null;
  readonly max: number | null;
  /** When set, the value must be one of these. */
  readonly allowed: readonly number[] | null;
}

export interface EnumParameterDefinition extends ParameterBase {
  readonly kind: "enum";
  readonly values: readonly string[];
  readonly default: string;
}

/** Reference to a board material. Exposes its thickness to formulas as `symbol`. */
export interface MaterialParameterDefinition extends ParameterBase {
  readonly kind: "material";
  readonly default: string;
}

export interface FinishParameterDefinition extends ParameterBase {
  readonly kind: "finish";
  readonly default: string;
}

export type ParameterDefinition =
  | NumberParameterDefinition
  | IntegerParameterDefinition
  | EnumParameterDefinition
  | MaterialParameterDefinition
  | FinishParameterDefinition;

/* ------------------------------------------------------------------ recipe */

/** Material roles (ported from the legacy SQL catalog's `material_role`). */
export type MaterialRole = "CARCASS" | "BACK" | "FRONT";
export type FinishRole = "FRONT_FINISH";

export type InstanceSuffixScheme =
  /** -01, -02, … */
  | "INDEX"
  /** -L / -R when exactly two instances, otherwise -01, -02, … (PRD §17 examples). */
  | "LEFT_RIGHT_WHEN_TWO";

/**
 * Declarative template for one component type in a recipe. Every dimension and
 * position is a formula expression (PRD §15). The variable `i` is the 0-based
 * instance index. Face dimensions map to cabinet axes by `plane`:
 *   YZ → width:Z height:Y thickness:X   (sides)
 *   XZ → width:X height:Z thickness:Y   (bottom, shelves, rails)
 *   XY → width:X height:Y thickness:Z   (back, fronts)
 */
export interface ComponentTemplate {
  readonly templateId: string;
  readonly componentType: ComponentType;
  /** Human-readable id suffix, e.g. "SL" → OBJ-KIT-001-SL. */
  readonly idSuffix: string;
  readonly instanceSuffix: InstanceSuffixScheme | null;
  /** Boolean expression; template is skipped when false. */
  readonly when: string | null;
  /** Number of instances (expression). */
  readonly count: string;
  readonly plane: PanelPlane;
  readonly width: string;
  readonly height: string;
  readonly thickness: string;
  readonly position: { readonly x: string; readonly y: string; readonly z: string };
  readonly materialRole: MaterialRole;
  readonly finish: { readonly role: FinishRole; readonly faces: string } | null;
  readonly grainDirection: GrainDirection;
}

export interface ConstructionVariableDefinition {
  readonly key: string;
  readonly description: string;
  readonly unit: "MM" | "COUNT";
}

/** PRD §14. The recipe is versioned data; changing it must not require code changes. */
export interface ConstructionRecipe {
  readonly recipeId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly productType: string;
  readonly description: string;
  /** Explicit construction assumptions for review (never hidden in code). */
  readonly assumptions: readonly string[];
  /** Variables whose values must come from a ConstructionStandard. */
  readonly constructionVariables: readonly ConstructionVariableDefinition[];
  readonly formulas: readonly FormulaDefinition[];
  readonly components: readonly ComponentTemplate[];
  readonly materialRoles: Readonly<Record<MaterialRole, string>>;
  readonly finishRoles: Readonly<Record<FinishRole, string>>;
  readonly rules: readonly RuleDefinition[];
  readonly edgeRuleSetId: string;
  readonly hardwareRuleSetId: string;
}

/* ------------------------------------------------------------------ standard */

/** Edge bands per edge side; `{}` means "explicitly no edge banding". */
export type EdgeRule = Readonly<Partial<Record<EdgeSide, string>>>;
export type EdgeRuleSet = Readonly<Partial<Record<ComponentType, EdgeRule>>>;

/**
 * Organisation construction standard: the numeric construction values and edge
 * rules a recipe depends on. `null` = not yet defined; the engine will not invent it.
 */
export interface ConstructionStandard {
  readonly standardId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly description: string;
  readonly source: string;
  readonly variables: Readonly<Record<string, number | null>>;
  readonly edgeRuleSets: Readonly<Record<string, EdgeRuleSet>>;
}

/* ------------------------------------------------------------------ hardware rules */

export interface HardwareRule {
  readonly ruleId: string;
  readonly componentType: ComponentType;
  readonly category: HardwareCategory;
  readonly application: "HINGED_DOOR";
  /** Maps a product enum parameter (e.g. frontType) to a hinge mounting. */
  readonly mounting: { readonly parameterKey: string; readonly map: Readonly<Record<string, HingeMounting>> };
  readonly preferredManufacturer: string;
}

export interface HardwareRuleSet {
  readonly ruleSetId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly rules: readonly HardwareRule[];
}

/* ------------------------------------------------------------------ BOQ recipe */

export interface BoqRecipe {
  /** `{key}` placeholders are replaced with resolved parameter values. */
  readonly itemCodeTemplate: string;
  readonly descriptionTemplate: string;
  readonly unit: "NOS";
  readonly quantity: string;
}

/* ------------------------------------------------------------------ product */

export interface ProductDefinition {
  readonly productId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly name: string;
  readonly category: "KITCHEN_BASE";
  readonly objectType: "BASE_CABINET";
  readonly recipeId: string;
  readonly parameters: readonly ParameterDefinition[];
  /** Product-level constraints (PRD §13 "Constraints"). */
  readonly rules: readonly RuleDefinition[];
  readonly boq: BoqRecipe;
}
