import type {
  CabinetComponent,
  DataStatus,
  ResolvedCabinet,
  ScalarValue,
  TraceInfo,
  ValidationMessage,
  VersionRef,
} from "@lintel/types";
import { buildValidationResult, evaluateFormulaSet, evaluateRules, FormulaError } from "@lintel/rules-engine";
import { findEdgeBand, findFinish, findHardwareRuleSet, findMaterial, findProduct, findRecipe, validateEdgeBandStandard, validateStandard } from "@lintel/catalog-engine";
import { envelope, isSupportedTransform } from "@lintel/geometry-engine";
import { generateComponents } from "./components.js";
import { ENGINE_VERSION } from "./context.js";
import type { ResolveCabinetInput } from "./context.js";
import { buildHardwareRequirements, resolveHardware } from "./hardware.js";
import { resolveParameters } from "./parameters.js";
import { RootCauseResolver } from "./root-cause.js";

function sortedRecord<T>(r: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function notApproved(kind: string, ref: VersionRef, sourceObjectId: string): ValidationMessage | null {
  if (ref.status === "APPROVED") return null;
  const why: Record<Exclude<DataStatus, "APPROVED">, string> = {
    TEST_FIXTURE: "is a TEST FIXTURE with synthetic values",
    DRAFT: "is a DRAFT and not verified for production",
    RETIRED: "is RETIRED",
  };
  return {
    code: `${kind}_NOT_APPROVED`,
    severity: "BLOCKER",
    message: `${kind.toLowerCase().replace(/_/g, " ")} ${ref.id} v${ref.version} ${why[ref.status]}`,
    path: kind.toLowerCase(),
    sourceObjectId,
  };
}

/**
 * The deterministic parametric cabinet pipeline:
 * parameters → formulas → construction rules → components → geometry metadata →
 * hardware resolution → validation. Pure: same input ⇒ same output.
 * BOM and BOQ are derived from the result by their own engines.
 */
export function resolveCabinet(input: ResolveCabinetInput): ResolvedCabinet {
  const { object, catalog, standard, edgeBandStandard, designVersion } = input;
  const src = object.objectId;
  const messages: ValidationMessage[] = [];
  const add = (m: ValidationMessage | null): void => {
    if (m !== null) messages.push(m);
  };

  const standardRef: VersionRef = { id: standard.standardId, version: standard.version, status: standard.status };
  const edgeBandStandardRef: VersionRef = { id: edgeBandStandard.standardId, version: edgeBandStandard.version, status: edgeBandStandard.status };
  const product = findProduct(catalog, object.productId);
  const recipe = product === undefined ? undefined : findRecipe(catalog, product.recipeId);
  const productRef: VersionRef = product === undefined ? { id: object.productId, version: "unknown", status: "DRAFT" } : { id: product.productId, version: product.version, status: product.status };
  const recipeRef: VersionRef = recipe === undefined ? { id: product?.recipeId ?? "unknown", version: "unknown", status: "DRAFT" } : { id: recipe.recipeId, version: recipe.version, status: recipe.status };

  // Every input that is test-fixture data (production safety rule: never silently substituted).
  const fixtureSources = new Set<string>();
  if (standard.status === "TEST_FIXTURE") fixtureSources.add(`construction standard ${standard.standardId}`);
  if (edgeBandStandard.status === "TEST_FIXTURE") fixtureSources.add(`edge band standard ${edgeBandStandard.standardId}`);
  for (const a of input.adapters) if (a.dataset.classification === "TEST_FIXTURE") fixtureSources.add(`hardware dataset ${a.dataset.datasetId}`);
  if (productRef.status === "TEST_FIXTURE") fixtureSources.add(`product ${productRef.id}`);
  if (recipeRef.status === "TEST_FIXTURE") fixtureSources.add(`recipe ${recipeRef.id}`);

  const trace = (): TraceInfo => ({
    engineVersion: ENGINE_VERSION,
    dataClassification: fixtureSources.size > 0 ? "TEST_FIXTURE" : "PRODUCTION",
    testFixtureSources: [...fixtureSources].sort(),
    designVersionId: designVersion.designVersionId,
    designVersionStatus: designVersion.status,
    objectId: src,
    product: productRef,
    recipe: recipeRef,
    standard: standardRef,
    edgeBandStandard: edgeBandStandardRef,
    catalogVersion: catalog.catalogVersion,
    hardwareDatasets: input.adapters.map((a) => a.dataset),
  });

  if (designVersion.projectId !== object.projectId) {
    add({ code: "TRACE_PROJECT_MISMATCH", severity: "BLOCKER", message: `Object project ${object.projectId} ≠ design version project ${designVersion.projectId}`, sourceObjectId: src });
  }
  if (!isSupportedTransform(object.transform)) {
    add({ code: "TRANSFORM_UNSUPPORTED", severity: "ERROR", message: "Only rotation about the vertical axis is supported for base cabinets", path: "transform", sourceObjectId: src });
  }

  const hardwareRuleSet = recipe === undefined ? undefined : findHardwareRuleSet(catalog, recipe.hardwareRuleSetId);
  if (product === undefined || recipe === undefined || hardwareRuleSet === undefined) {
    add({
      code: "CATALOG_REFERENCE_MISSING",
      severity: "BLOCKER",
      message: product === undefined ? `Product ${object.productId} not in catalog ${catalog.catalogVersion}` : recipe === undefined ? `Recipe ${product.recipeId} not in catalog` : "Hardware rule set not in catalog",
      sourceObjectId: src,
    });
    return {
      trace: trace(),
      object,
      parameters: { values: {}, provenance: {} },
      scope: {},
      derived: {},
      components: [],
      hardwareRequirements: [],
      hardwareResolutions: [],
      geometry: { envelope: null, transform: object.transform },
      validation: buildValidationResult(messages),
    };
  }

  // Data approval status (PRD §6.8): unapproved rules/recipes/standards cannot drive production.
  add(notApproved("PRODUCT", productRef, src));
  add(notApproved("RECIPE", recipeRef, src));
  add(notApproved("CONSTRUCTION_STANDARD", standardRef, src));
  add(notApproved("EDGE_BAND_STANDARD", edgeBandStandardRef, src));
  add(notApproved("HARDWARE_RULE_SET", { id: hardwareRuleSet.ruleSetId, version: hardwareRuleSet.version, status: hardwareRuleSet.status }, src));
  for (const e of validateStandard(recipe, standard)) add({ ...e, sourceObjectId: src });
  for (const e of validateEdgeBandStandard(catalog, recipe, edgeBandStandard)) add({ ...e, sourceObjectId: src });

  // 1. Parameters.
  const params = resolveParameters(product, object, catalog);
  messages.push(...params.messages);

  // 2. Construction values: only declared, defined (non-null) values enter scope.
  const constructionKeys = new Set(recipe.constructionVariables.map((v) => v.key));
  const construction: Record<string, number> = {};
  for (const key of constructionKeys) {
    const v = standard.variables[key];
    if (typeof v === "number") construction[key] = v;
  }

  // 3. Derived formulas.
  const baseScope: Record<string, ScalarValue> = { ...params.scope, ...construction };
  const formulaSet = evaluateFormulaSet(recipe.formulas, baseScope);
  const scope: Record<string, ScalarValue> = { ...baseScope, ...formulaSet.values };
  const failedFormulas = new Map(recipe.formulas.filter((f) => formulaSet.errors[f.formulaId] !== undefined).map((f) => [f.formulaId, f.expression]));
  const rootCause = new RootCauseResolver(constructionKeys, failedFormulas, scope);
  const undefinedConstruction = new Set<string>();

  // 4. Product constraints + construction rules (PRD §18).
  const ruleMessages = [...evaluateRules(product.rules, scope, { sourceObjectId: src }), ...evaluateRules(recipe.rules, scope, { sourceObjectId: src })];
  for (const m of ruleMessages) {
    messages.push(m);
    if (m.code === "RULE_NOT_EVALUABLE") {
      const rule = [...product.rules, ...recipe.rules].find((r) => r.ruleId === m.ruleId);
      const exprs = rule === undefined ? [] : [rule.assert, ...(rule.when === undefined ? [] : [rule.when])];
      for (const e of exprs) {
        const cause = rootCause.explain(new FormulaError("UNKNOWN_VARIABLE", "rule", e));
        cause.undefinedConstruction.forEach((k) => undefinedConstruction.add(k));
      }
    }
  }

  // 5. Components + geometry metadata.
  const gen = generateComponents({ objectId: src, objectCode: object.objectCode, recipe, edgeBandStandard, catalog, parameters: params.parameters, scope, rootCause });
  messages.push(...gen.messages);
  gen.undefinedConstruction.forEach((k) => undefinedConstruction.add(k));

  for (const key of [...undefinedConstruction].sort()) {
    const def = recipe.constructionVariables.find((v) => v.key === key);
    messages.push({
      code: "CONSTRUCTION_VARIABLE_UNDEFINED",
      severity: "BLOCKER",
      message: `Construction value ${key} (${def?.description ?? "undeclared"}) is not defined in ${standard.standardId} v${standard.version}`,
      path: `standard.variables.${key}`,
      sourceObjectId: src,
    });
  }

  // Catalog items actually used: unverified data is a warning (verification pending).
  const used = new Set<string>();
  for (const c of gen.components) {
    const mat = findMaterial(catalog, c.materialId);
    if (mat?.status === "TEST_FIXTURE") fixtureSources.add(`material ${mat.materialId}`);
    if (mat !== undefined && mat.status !== "APPROVED") used.add(`material ${mat.materialId}`);
    const fin = c.finishId === null ? undefined : findFinish(catalog, c.finishId);
    if (fin !== undefined && fin.status !== "APPROVED") used.add(`finish ${fin.finishId}`);
    for (const e of Object.values(c.edges)) {
      const band = findEdgeBand(catalog, e.edgeBandId);
      if (band !== undefined && band.status !== "APPROVED") used.add(`edge band ${band.edgeBandId}`);
    }
  }
  for (const item of [...used].sort()) {
    messages.push({ code: "CATALOG_ITEM_NOT_APPROVED", severity: "WARNING", message: `Catalog ${item} is not yet verified (status DRAFT)`, sourceObjectId: src });
  }

  if (fixtureSources.size > 0) {
    messages.push({
      code: "TEST_FIXTURE_DATA_IN_USE",
      severity: "BLOCKER",
      message: `Result uses TEST_FIXTURE data and can never drive production: ${[...fixtureSources].sort().join("; ")}`,
      sourceObjectId: src,
    });
  }

  // 6. Hardware (PRD §26): requirements from context, resolution via adapters.
  const depth = params.scope.D;
  const hw = buildHardwareRequirements(gen.components, {
    objectId: src,
    ruleSet: hardwareRuleSet,
    parameters: params.parameters,
    catalog,
    availableDepth: typeof depth === "number" ? depth : 0,
  });
  messages.push(...hw.messages);
  const resolutions = resolveHardware(hw.requirements, input.adapters);
  for (const r of resolutions) messages.push(...r.messages);

  const components: CabinetComponent[] = gen.components.map((c) => ({
    ...c,
    hardwareLinks: hw.requirements.filter((r) => r.sourceComponentId === c.componentId).map((r) => r.requirementId),
  }));

  return {
    trace: trace(),
    object,
    parameters: { values: sortedRecord(params.parameters.values), provenance: sortedRecord(params.parameters.provenance) },
    scope: sortedRecord(scope),
    derived: sortedRecord(formulaSet.values),
    components,
    hardwareRequirements: hw.requirements,
    hardwareResolutions: resolutions,
    geometry: { envelope: envelope(components.map((c) => c.geometry.local)), transform: object.transform },
    validation: buildValidationResult(messages),
  };
}
