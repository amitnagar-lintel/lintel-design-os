import type { CatalogSnapshot, ConstructionRecipe, ConstructionStandard, EdgeBandStandard, ProductDefinition, ValidationMessage } from "@lintel/types";
import { referencedVariables } from "@lintel/rules-engine";
import { edgeLength, grainLiesInFace } from "@lintel/geometry-engine";
import { findAppliance, findEdgeBand, findFinish, findHardwareRuleSet, findMaterial, findRecipe } from "./lookup.js";
import { INSTANCE_INDEX_VARIABLE, parameterSymbols, recipeScopeSymbols } from "./symbols.js";

function error(code: string, message: string, path: string): ValidationMessage {
  return { code, severity: "ERROR", message, path };
}

function checkExpression(expr: string, allowed: ReadonlySet<string>, path: string, out: ValidationMessage[]): void {
  let vars: string[];
  try {
    vars = referencedVariables(expr);
  } catch (e) {
    out.push(error("CATALOG_FORMULA_PARSE_ERROR", `${path}: ${e instanceof Error ? e.message : String(e)}`, path));
    return;
  }
  for (const v of vars) {
    if (!allowed.has(v)) out.push(error("CATALOG_UNKNOWN_VARIABLE", `${path}: unknown variable '${v}' in '${expr}'`, path));
  }
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup].sort();
}

function validateProduct(c: CatalogSnapshot, p: ProductDefinition, out: ValidationMessage[]): void {
  const base = `products.${p.productId}`;
  for (const d of duplicates(p.parameters.map((x) => x.key))) out.push(error("CATALOG_DUPLICATE_ID", `Duplicate parameter key ${d}`, base));
  for (const d of duplicates(p.parameters.map((x) => x.symbol))) out.push(error("CATALOG_DUPLICATE_ID", `Duplicate parameter symbol ${d}`, base));
  for (const param of p.parameters) {
    const path = `${base}.parameters.${param.key}`;
    switch (param.kind) {
      case "enum":
        if (!param.values.includes(param.default)) out.push(error("CATALOG_INVALID_DEFAULT", `Default '${param.default}' not in values`, path));
        break;
      case "material":
        if (findMaterial(c, param.default) === undefined) out.push(error("CATALOG_UNKNOWN_REFERENCE", `Unknown material '${param.default}'`, path));
        break;
      case "finish":
        if (findFinish(c, param.default) === undefined) out.push(error("CATALOG_UNKNOWN_REFERENCE", `Unknown finish '${param.default}'`, path));
        break;
      case "appliance":
        if (findAppliance(c, param.default) === undefined) out.push(error("CATALOG_UNKNOWN_REFERENCE", `Unknown appliance '${param.default}'`, path));
        break;
      case "number":
      case "integer":
        if ((param.min !== null && param.default < param.min) || (param.max !== null && param.default > param.max)) {
          out.push(error("CATALOG_INVALID_DEFAULT", `Default ${param.default} outside limits`, path));
        }
        if (param.kind === "integer" && !Number.isInteger(param.default)) out.push(error("CATALOG_INVALID_DEFAULT", "Integer default required", path));
        break;
    }
  }
  const productSymbols = new Set(parameterSymbols(p));
  for (const r of p.rules) {
    if (r.when !== undefined) checkExpression(r.when, productSymbols, `${base}.rules.${r.ruleId}.when`, out);
    checkExpression(r.assert, productSymbols, `${base}.rules.${r.ruleId}.assert`, out);
  }
  checkExpression(p.boq.quantity, productSymbols, `${base}.boq.quantity`, out);
  const recipe = findRecipe(c, p.recipeId);
  if (recipe === undefined) {
    out.push(error("CATALOG_UNKNOWN_REFERENCE", `Unknown recipe '${p.recipeId}'`, `${base}.recipeId`));
  } else {
    validateRecipe(c, p, recipe, out);
  }
}

function validateRecipe(c: CatalogSnapshot, p: ProductDefinition, r: ConstructionRecipe, out: ValidationMessage[]): void {
  const base = `recipes.${r.recipeId}`;
  const scope = recipeScopeSymbols(p, r);
  const templateScope = new Set([...scope, INSTANCE_INDEX_VARIABLE]);
  for (const d of duplicates(r.formulas.map((f) => f.formulaId))) out.push(error("CATALOG_DUPLICATE_ID", `Duplicate formula ${d}`, base));
  for (const d of duplicates(r.components.map((t) => t.templateId))) out.push(error("CATALOG_DUPLICATE_ID", `Duplicate template ${d}`, base));
  for (const d of duplicates(r.constructionVariables.map((v) => v.key))) out.push(error("CATALOG_DUPLICATE_ID", `Duplicate construction variable ${d}`, base));
  for (const f of r.formulas) {
    const path = `${base}.formulas.${f.formulaId}`;
    checkExpression(f.expression, scope, path, out);
    try {
      const actual = referencedVariables(f.expression);
      const declared = [...f.variables].sort();
      if (JSON.stringify(actual) !== JSON.stringify(declared)) {
        out.push(error("CATALOG_FORMULA_VARIABLES_MISMATCH", `${path}: declares [${declared.join(", ")}] but uses [${actual.join(", ")}]`, path));
      }
    } catch {
      // parse error already reported
    }
  }
  const paramKeys = new Map(p.parameters.map((x) => [x.key, x.kind]));
  for (const [role, key] of Object.entries(r.materialRoles)) {
    if (paramKeys.get(key) !== "material") out.push(error("CATALOG_UNKNOWN_REFERENCE", `Material role ${role} → '${key}' is not a material parameter`, `${base}.materialRoles.${role}`));
  }
  for (const [role, key] of Object.entries(r.finishRoles)) {
    if (paramKeys.get(key) !== "finish") out.push(error("CATALOG_UNKNOWN_REFERENCE", `Finish role ${role} → '${key}' is not a finish parameter`, `${base}.finishRoles.${role}`));
  }
  for (const t of r.components) {
    const path = `${base}.components.${t.templateId}`;
    const exprs: [string, string][] = [
      ["count", t.count],
      ["width", t.width],
      ["height", t.height],
      ["thickness", t.thickness],
      ["position.x", t.position.x],
      ["position.y", t.position.y],
      ["position.z", t.position.z],
    ];
    if (t.when !== null) exprs.push(["when", t.when]);
    if (t.finish !== null) exprs.push(["finish.faces", t.finish.faces]);
    for (const [k, e] of exprs) checkExpression(e, k === "count" || k === "when" ? scope : templateScope, `${path}.${k}`, out);
    if (!grainLiesInFace(t.plane, t.grainDirection)) {
      out.push(error("CATALOG_INVALID_GRAIN", `Grain ${t.grainDirection} does not lie in plane ${t.plane}`, `${path}.grainDirection`));
    }
  }
  for (const rule of r.rules) {
    if (rule.when !== undefined) checkExpression(rule.when, scope, `${base}.rules.${rule.ruleId}.when`, out);
    checkExpression(rule.assert, scope, `${base}.rules.${rule.ruleId}.assert`, out);
  }
  const hw = findHardwareRuleSet(c, r.hardwareRuleSetId);
  if (hw === undefined) {
    out.push(error("CATALOG_UNKNOWN_REFERENCE", `Unknown hardware rule set '${r.hardwareRuleSetId}'`, `${base}.hardwareRuleSetId`));
  } else {
    for (const rule of hw.rules) {
      if (rule.application !== "HINGED_DOOR") continue;
      const param = p.parameters.find((x) => x.key === rule.mounting.parameterKey);
      if (param?.kind !== "enum") {
        out.push(error("CATALOG_UNKNOWN_REFERENCE", `Hardware rule ${rule.ruleId} mounting parameter '${rule.mounting.parameterKey}' is not an enum`, `hardwareRuleSets.${hw.ruleSetId}`));
      } else {
        for (const v of param.values) {
          if (rule.mounting.map[v] === undefined) out.push(error("CATALOG_INCOMPLETE_MAPPING", `Hardware rule ${rule.ruleId} has no mounting for ${param.key}=${v}`, `hardwareRuleSets.${hw.ruleSetId}`));
        }
      }
    }
  }
}

/** Structural validation of a catalog snapshot. Returns ERROR messages; empty = valid. */
export function validateCatalog(c: CatalogSnapshot): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  const idLists: [string, string[]][] = [
    ["products", c.products.map((x) => x.productId)],
    ["recipes", c.recipes.map((x) => x.recipeId)],
    ["materials", c.materials.map((x) => x.materialId)],
    ["finishes", c.finishes.map((x) => x.finishId)],
    ["edgeBands", c.edgeBands.map((x) => x.edgeBandId)],
    ["hardwareRuleSets", c.hardwareRuleSets.map((x) => x.ruleSetId)],
  ];
  for (const [kind, ids] of idLists) for (const d of duplicates(ids)) out.push(error("CATALOG_DUPLICATE_ID", `Duplicate ${kind} id ${d}`, kind));
  for (const p of c.products) validateProduct(c, p, out);
  return out;
}

/** Checks a construction standard against a recipe: unknown variable keys. */
export function validateStandard(recipe: ConstructionRecipe, s: ConstructionStandard): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  const base = `standards.${s.standardId}`;
  const declared = new Set(recipe.constructionVariables.map((v) => v.key));
  for (const key of Object.keys(s.variables).sort()) {
    if (!declared.has(key)) out.push(error("STANDARD_UNKNOWN_VARIABLE", `Variable ${key} is not declared by recipe ${recipe.recipeId}`, `${base}.variables.${key}`));
  }
  return out;
}

/** Checks an edge-band standard against a recipe: the selected rule set, component types, edge sides and edge band references. */
export function validateEdgeBandStandard(c: CatalogSnapshot, recipe: ConstructionRecipe, s: EdgeBandStandard): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  const base = `edgeBandStandards.${s.standardId}`;
  const set = s.ruleSets[recipe.edgeRuleSetId];
  if (set === undefined) {
    out.push(error("STANDARD_MISSING_EDGE_RULE_SET", `Edge rule set ${recipe.edgeRuleSetId} missing from ${s.standardId}`, `${base}.ruleSets`));
    return out;
  }
  const planes = new Map(recipe.components.map((t) => [t.componentType, t.plane]));
  for (const [type, rule] of Object.entries(set)) {
    const plane = planes.get(type as never);
    const path = `${base}.ruleSets.${recipe.edgeRuleSetId}.${type}`;
    if (plane === undefined) {
      out.push(error("STANDARD_UNKNOWN_COMPONENT_TYPE", `Component type ${type} not in recipe`, path));
      continue;
    }
    for (const [side, edgeBandId] of Object.entries(rule)) {
      if (edgeLength(plane, side as never, { width: 1, height: 1 }) === null) out.push(error("STANDARD_INVALID_EDGE_SIDE", `Side ${side} does not exist on plane ${plane}`, `${path}.${side}`));
      if (findEdgeBand(c, edgeBandId) === undefined) out.push(error("CATALOG_UNKNOWN_REFERENCE", `Unknown edge band '${edgeBandId}'`, `${path}.${side}`));
    }
  }
  return out;
}
