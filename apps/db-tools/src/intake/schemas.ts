/**
 * Runtime schemas for intake files: strict Zod mirrors of the existing domain types (@lintel/types and the Hettich
 * model). They add no rule of their own — every business rule stays in the engines, the persistence mappers and the
 * database. The compile-time checks at the bottom fail the build if a schema and its domain type ever drift apart.
 */
import type {
  ConstructionRecipe, ConstructionStandard, EdgeBand, EdgeBandStandard, Finish, HardwareRuleSet, Material, PlanningStandard, PricingRuleSet, ProductDefinition, QuotationPolicy, RateCard,
} from "@lintel/types";
import type { HettichProductionDataset } from "@lintel/hettich-engine";
import { z } from "zod";

const Id = z.string().trim().min(1).max(200);
const Text = z.string();
const DataStatus = z.enum(["TEST_FIXTURE", "DRAFT", "APPROVED", "RETIRED"]);
const DataClassification = z.enum(["PRODUCTION", "TEST_FIXTURE"]);
const Mm = z.number();
const NullableNumber = z.number().nullable();
const Severity = z.enum(["INFO", "WARNING", "ERROR", "BLOCKER"]);
const ComponentType = z.enum([
  "SIDE_LEFT", "SIDE_RIGHT", "TOP", "BOTTOM", "TOP_SUPPORT_FRONT", "TOP_SUPPORT_BACK", "BACK", "SHELF", "PARTITION", "SHUTTER",
  "DRAWER_FRONT", "DRAWER_BOX_SIDE", "DRAWER_BOX_FRONT", "DRAWER_BOX_BACK", "DRAWER_BOTTOM",
  "PULLOUT_FRAME_SIDE", "PULLOUT_TRAY", "PLINTH", "FILLER", "END_PANEL", "KICKBOARD",
]);
const EdgeSide = z.enum(["FRONT", "BACK", "TOP", "BOTTOM", "LEFT", "RIGHT"]);
const HardwareCategory = z.enum(["HINGE", "MOUNTING_PLATE", "RUNNER"]);
const HingeMounting = z.enum(["FULL_OVERLAY", "HALF_OVERLAY", "INSET"]);

const Rule = z.strictObject({
  ruleId: Id, description: Text, when: Text.exactOptional(), assert: Text, severity: Severity, message: Text,
});
const Formula = z.strictObject({
  formulaId: Id, expression: Text, variables: z.array(Text), unit: z.enum(["MM", "COUNT", "BOOLEAN", "RATIO", "KG"]), description: Text.exactOptional(),
});

// ---------------------------------------------------------------- standards

const VariableValues = z.record(Id, NullableNumber);

export const ConstructionStandardSchema = z.strictObject({ standardId: Id, version: Id, status: DataStatus, description: Text, source: Text, variables: VariableValues });
export const PlanningStandardSchema = z.strictObject({ standardId: Id, version: Id, status: DataStatus, description: Text, source: Text, variables: VariableValues });
export const EdgeBandStandardSchema = z.strictObject({
  standardId: Id, version: Id, status: DataStatus, description: Text, source: Text,
  ruleSets: z.record(Id, z.partialRecord(ComponentType, z.partialRecord(EdgeSide, Id))),
});

/** Per-value provenance of a numeric standard (unit, source document, evidence reference, note). */
export const ValueProvenanceSchema = z.strictObject({ unit: Text.nullable(), source: Text.nullable(), evidenceRef: Text.nullable(), note: Text.nullable() });

// ---------------------------------------------------------------- catalog items

export const MaterialSchema = z.strictObject({
  materialId: Id, category: z.literal("BOARD"), name: Text, substrate: Text.nullable(), thickness: Mm,
  sheetSize: z.strictObject({ width: Mm, height: Mm }).nullable(), grain: z.boolean().nullable(), densityKgPerM3: NullableNumber, status: DataStatus, source: Text,
});
export const FinishSchema = z.strictObject({
  finishId: Id, type: z.enum(["LAMINATE", "VENEER", "PAINT", "ACRYLIC", "PU"]), name: Text, thickness: NullableNumber, status: DataStatus, source: Text,
});
export const EdgeBandSchema = z.strictObject({
  edgeBandId: Id, name: Text, material: z.enum(["ABS", "PVC", "VENEER"]).nullable(), thickness: Mm, width: NullableNumber, status: DataStatus, source: Text,
});
const HingeHardwareRule = z.strictObject({
  ruleId: Id, componentType: ComponentType, category: z.enum(["HINGE", "MOUNTING_PLATE"]), application: z.literal("HINGED_DOOR"),
  mounting: z.strictObject({ parameterKey: Id, map: z.record(Text, HingeMounting) }), preferredManufacturer: Id,
});
const RunnerHardwareRule = z.strictObject({
  ruleId: Id, componentType: ComponentType, category: z.literal("RUNNER"), application: z.literal("DRAWER"), preferredManufacturer: Id,
});
export const HardwareRuleSetSchema = z.strictObject({
  ruleSetId: Id, version: Id, status: DataStatus,
  rules: z.array(z.discriminatedUnion("application", [HingeHardwareRule, RunnerHardwareRule])),
});

// ---------------------------------------------------------------- recipe and product

const ParamBase = { key: Id, symbol: Id, label: Text };
const Parameter = z.discriminatedUnion("kind", [
  z.strictObject({ ...ParamBase, kind: z.literal("number"), unit: z.literal("MM"), default: Mm, min: NullableNumber, max: NullableNumber }),
  z.strictObject({ ...ParamBase, kind: z.literal("integer"), default: z.number().int(), min: z.number().int().nullable(), max: z.number().int().nullable(), allowed: z.array(z.number().int()).nullable() }),
  z.strictObject({ ...ParamBase, kind: z.literal("enum"), values: z.array(Text), default: Text }),
  z.strictObject({ ...ParamBase, kind: z.literal("material"), default: Id }),
  z.strictObject({ ...ParamBase, kind: z.literal("finish"), default: Id }),
]);
const BoqRecipe = z.strictObject({ itemCodeTemplate: Text, descriptionTemplate: Text, unit: z.literal("NOS"), quantity: Text });

export const ProductDefinitionSchema = z.strictObject({
  productId: Id, version: Id, status: DataStatus, name: Text, category: z.literal("KITCHEN_BASE"), objectType: z.literal("BASE_CABINET"), recipeId: Id,
  parameters: z.array(Parameter), rules: z.array(Rule), boq: BoqRecipe,
});

const ComponentTemplate = z.strictObject({
  templateId: Id, componentType: ComponentType, idSuffix: Text, instanceSuffix: z.enum(["INDEX", "LEFT_RIGHT_WHEN_TWO"]).nullable(), when: Text.nullable(), count: Text,
  plane: z.enum(["YZ", "XZ", "XY"]), width: Text, height: Text, thickness: Text, position: z.strictObject({ x: Text, y: Text, z: Text }),
  materialRole: z.enum(["CARCASS", "BACK", "FRONT"]), finish: z.strictObject({ role: z.literal("FRONT_FINISH"), faces: Text }).nullable(),
  grainDirection: z.enum(["HEIGHT", "WIDTH", "DEPTH", "NONE"]),
});
export const ConstructionRecipeSchema = z.strictObject({
  recipeId: Id, version: Id, status: DataStatus, productType: Id, description: Text, assumptions: z.array(Text),
  constructionVariables: z.array(z.strictObject({ key: Id, description: Text, unit: z.enum(["MM", "COUNT"]) })),
  formulas: z.array(Formula), components: z.array(ComponentTemplate),
  materialRoles: z.strictObject({ CARCASS: Id, BACK: Id, FRONT: Id }), finishRoles: z.strictObject({ FRONT_FINISH: Id }),
  rules: z.array(Rule), edgeRuleSetId: Id, hardwareRuleSetId: Id,
});

// ---------------------------------------------------------------- Hettich

const SourceReference = z.strictObject({ url: Text.nullable(), sourceDate: Text.nullable(), documentTitle: Text.nullable(), documentVersion: Text.nullable() });
const Verification = z.strictObject({ verifiedBy: Text.nullable(), verifiedAt: Text.nullable() });
const HettichRecord = z.strictObject({
  recordId: Id, articleNumber: Text.nullable(), productFamily: Text.nullable(), series: Text.nullable(), category: HardwareCategory.nullable(), description: Text.nullable(),
  exactApplication: z.strictObject({ description: Text.nullable(), application: z.enum(["HINGED_DOOR", "DRAWER"]).nullable(), mounting: HingeMounting.nullable() }),
  dimensions: z.record(Text, z.strictObject({ value: z.number(), unit: z.enum(["MM", "DEG", "KG", "N"]) })).nullable(),
  compatibility: z.strictObject({
    doorThicknessRange: z.strictObject({ min: Mm, max: Mm }).nullable(), openingAngle: NullableNumber, nominalLength: NullableNumber,
    compatibleArticles: z.array(Text).nullable(), notes: Text.nullable(),
  }),
  drilling: z.strictObject({
    patternId: Text.nullable(),
    holes: z.array(z.strictObject({ face: Text, datum: Text, x: Mm, y: Mm, diameter: Mm, depth: Mm })).nullable(),
    source: SourceReference.nullable(),
  }),
  installation: z.strictObject({ guide: SourceReference.nullable(), notes: Text.nullable() }),
  adjustment: z.strictObject({ ranges: z.record(Text, z.strictObject({ min: z.number(), max: z.number(), unit: z.enum(["MM", "DEG"]) })).nullable(), notes: Text.nullable() }),
  accessories: z.array(Text).nullable(),
  cadReference: z.strictObject({ assetId: Text.nullable(), formats: z.array(Text).nullable(), url: Text.nullable() }).nullable(),
  source: SourceReference,
  licence: z.strictObject({ status: z.enum(["OFFICIAL_PUBLIC", "AUTHORISED", "RESTRICTED", "UNKNOWN"]), usageNotes: Text.nullable() }),
  verification: Verification,
  preferenceRank: z.number().int().nullable(),
});
const HettichRule = z.strictObject({
  ruleId: Id, family: Id, category: HardwareCategory, description: Text, bands: z.array(z.strictObject({ when: Text, quantity: Text })),
  source: SourceReference.nullable(), verification: Verification.nullable(), sourceVersion: Id,
});
export const HettichProductionDatasetSchema = z.strictObject({
  kind: z.literal("PRODUCTION"), datasetId: Id, sourceVersion: Id, notes: Text, records: z.array(HettichRecord), calculationRules: z.array(HettichRule),
});

// ---------------------------------------------------------------- PricingStandard and QuotationPolicy

const Rates = z.record(Id, NullableNumber);
export const RateCardSchema = z.strictObject({
  rateCardId: Id, version: Id, status: DataStatus, classification: DataClassification, currency: z.literal("INR"), effectiveFrom: Text.nullable(), source: Text,
  boardPerM2: Rates, edgeBandPerM: Rates, finishPerM2: Rates, hardwarePerUnit: Rates,
});
export const PricingRuleSetSchema = z.strictObject({
  ruleSetId: Id, version: Id, status: DataStatus, classification: DataClassification, source: Text, manufacturingCost: Text.nullable(),
  wastagePercent: z.strictObject({ board: NullableNumber, edgeBand: NullableNumber, finish: NullableNumber }),
  overheadPercent: NullableNumber, marginBasis: z.enum(["MARKUP_ON_COST", "MARGIN_ON_PRICE"]).nullable(), marginPercent: NullableNumber, gstPercent: NullableNumber,
});
const Rounding = z.strictObject({ mode: z.enum(["HALF_UP", "HALF_EVEN", "DOWN", "UP"]), incrementPaise: z.number().int() }).nullable();
export const QuotationPolicySchema = z.strictObject({
  policyId: Id, version: Id, status: DataStatus, classification: DataClassification, source: Text,
  taxRates: z.record(Id, NullableNumber), taxRateByProductCategory: z.record(Id, Id.nullable()),
  taxPolicy: z.enum(["PER_LINE", "PER_RATE_GROUP"]).nullable(), rounding: z.strictObject({ tax: Rounding, grandTotal: Rounding }),
  discountPolicy: z.strictObject({ mode: z.literal("NONE") }).nullable(),
});

// ---------------------------------------------------------------- compile-time drift guard

type DeepReadonly<T> = T extends (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Mirrors<S extends z.ZodType, T> = Same<DeepReadonly<z.infer<S>>, DeepReadonly<T>>;

/** Each line fails to compile when a schema and its domain type disagree in any field. */
export const SCHEMAS_MATCH_DOMAIN_TYPES: readonly true[] = [
  true satisfies Mirrors<typeof ConstructionStandardSchema, ConstructionStandard>,
  true satisfies Mirrors<typeof PlanningStandardSchema, PlanningStandard>,
  true satisfies Mirrors<typeof EdgeBandStandardSchema, EdgeBandStandard>,
  true satisfies Mirrors<typeof MaterialSchema, Material>,
  true satisfies Mirrors<typeof FinishSchema, Finish>,
  true satisfies Mirrors<typeof EdgeBandSchema, EdgeBand>,
  true satisfies Mirrors<typeof HardwareRuleSetSchema, HardwareRuleSet>,
  true satisfies Mirrors<typeof ProductDefinitionSchema, ProductDefinition>,
  true satisfies Mirrors<typeof ConstructionRecipeSchema, ConstructionRecipe>,
  true satisfies Mirrors<typeof HettichProductionDatasetSchema, HettichProductionDataset>,
  true satisfies Mirrors<typeof RateCardSchema, RateCard>,
  true satisfies Mirrors<typeof PricingRuleSetSchema, PricingRuleSet>,
  true satisfies Mirrors<typeof QuotationPolicySchema, QuotationPolicy>,
];
