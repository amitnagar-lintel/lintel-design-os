import type {
  CabinetComponent,
  CatalogSnapshot,
  ComponentEdge,
  ComponentTemplate,
  ConstructionRecipe,
  ConstructionStandard,
  EdgeSide,
  GrainDirection,
  ResolvedParameters,
  ScalarValue,
  ValidationMessage,
} from "@lintel/types";
import { evaluateBoolean, evaluateNumber } from "@lintel/rules-engine";
import type { FormulaError } from "@lintel/rules-engine";
import { findEdgeBand, findMaterial, INSTANCE_INDEX_VARIABLE } from "@lintel/catalog-engine";
import { edgeLength, edgeSidesForPlane, panelBox } from "@lintel/geometry-engine";
import type { RootCauseResolver } from "./root-cause.js";

export interface ComponentGenerationContext {
  readonly objectId: string;
  readonly objectCode: string;
  readonly recipe: ConstructionRecipe;
  readonly standard: ConstructionStandard;
  readonly catalog: CatalogSnapshot;
  readonly parameters: ResolvedParameters;
  readonly scope: Readonly<Record<string, ScalarValue>>;
  readonly rootCause: RootCauseResolver;
}

export interface ComponentGenerationResult {
  readonly components: readonly CabinetComponent[];
  readonly messages: readonly ValidationMessage[];
  /** Construction values that blocked generation. */
  readonly undefinedConstruction: readonly string[];
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Deterministic, human-readable component id (PRD §17). */
export function componentId(objectCode: string, t: ComponentTemplate, index: number, count: number): string {
  if (t.instanceSuffix === null && count === 1) return `${objectCode}-${t.idSuffix}`;
  if (t.instanceSuffix === "LEFT_RIGHT_WHEN_TWO" && count === 2) return `${objectCode}-${t.idSuffix}-${index === 0 ? "L" : "R"}`;
  return `${objectCode}-${t.idSuffix}-${pad2(index + 1)}`;
}

const zero = (v: number): number => (v === 0 ? 0 : v);

/** Generate components from recipe templates (PRD §16). Pure. */
export function generateComponents(ctx: ComponentGenerationContext): ComponentGenerationResult {
  const messages: ValidationMessage[] = [];
  const components: CabinetComponent[] = [];
  const undefinedConstruction = new Set<string>();
  const warnedGrain = new Set<string>();
  const edgeSet = ctx.standard.edgeRuleSets[ctx.recipe.edgeRuleSetId];
  const src = ctx.objectId;

  /** Report every failed field with the union of root causes (not just the first failure). */
  const failure = (id: string, failed: readonly (readonly [string, FormulaError])[]): void => {
    const construction = new Set<string>();
    const other = new Set<string>();
    for (const [, error] of failed) {
      const cause = ctx.rootCause.explain(error);
      cause.undefinedConstruction.forEach((k) => construction.add(k));
      cause.other.forEach((o) => other.add(o));
    }
    construction.forEach((k) => undefinedConstruction.add(k));
    const keys = [...construction].sort();
    const reasons = [...keys.map((k) => `construction value ${k} undefined`), ...[...other].sort()];
    messages.push({
      code: "COMPONENT_NOT_GENERATED",
      severity: "BLOCKER",
      message: `${id}: ${failed.map(([k]) => k).join(", ")} could not be computed (${reasons.join("; ")})`,
      componentId: id,
      sourceObjectId: src,
      details: { missing: keys.join(",") || null },
    });
  };

  for (const t of ctx.recipe.components) {
    const templateRef = `${ctx.objectCode}-${t.idSuffix}`;
    if (t.when !== null) {
      const w = evaluateBoolean(t.when, ctx.scope);
      if (!w.ok) {
        failure(templateRef, [[`when`, w.error]]);
        continue;
      }
      if (!w.value) continue;
    }
    const c = evaluateNumber(t.count, ctx.scope);
    if (!c.ok) {
      failure(templateRef, [["count", c.error]]);
      continue;
    }
    const count = c.value;
    if (!Number.isInteger(count) || count < 0) {
      messages.push({ code: "COMPONENT_COUNT_INVALID", severity: "BLOCKER", message: `${templateRef}: count ${count} is not a non-negative integer`, componentId: templateRef, sourceObjectId: src });
      continue;
    }

    const materialKey = ctx.recipe.materialRoles[t.materialRole];
    const materialId = ctx.parameters.values[materialKey];
    const material = typeof materialId === "string" ? findMaterial(ctx.catalog, materialId) : undefined;
    const finishId = t.finish === null ? null : ctx.parameters.values[ctx.recipe.finishRoles[t.finish.role]];

    for (let i = 0; i < count; i++) {
      const id = componentId(ctx.objectCode, t, i, count);
      const scope = { ...ctx.scope, [INSTANCE_INDEX_VARIABLE]: i };
      const fields: [string, string][] = [
        ["width", t.width],
        ["height", t.height],
        ["thickness", t.thickness],
        ["position.x", t.position.x],
        ["position.y", t.position.y],
        ["position.z", t.position.z],
      ];
      if (t.finish !== null) fields.push(["finishedFaces", t.finish.faces]);
      const out: Record<string, number> = {};
      const failed: [string, FormulaError][] = [];
      for (const [k, expr] of fields) {
        const r = evaluateNumber(expr, scope);
        if (r.ok) out[k] = zero(r.value);
        else failed.push([k, r.error]);
      }
      if (failed.length > 0) {
        failure(id, failed);
        continue;
      }
      const width = out.width ?? 0;
      const height = out.height ?? 0;
      const thickness = out.thickness ?? 0;

      if (width <= 0 || height <= 0 || thickness <= 0) {
        messages.push({ code: "COMPONENT_DIMENSION_INVALID", severity: "BLOCKER", message: `${id}: dimensions ${width} × ${height} × ${thickness} mm must all be positive`, componentId: id, sourceObjectId: src });
        continue;
      }
      if (material === undefined) {
        messages.push({ code: "COMPONENT_MATERIAL_UNRESOLVED", severity: "BLOCKER", message: `${id}: ${t.materialRole} material is not resolved`, componentId: id, sourceObjectId: src });
        continue;
      }
      if (material.thickness !== thickness) {
        messages.push({
          code: "COMPONENT_THICKNESS_MATERIAL_MISMATCH",
          severity: "BLOCKER",
          message: `${id}: panel thickness ${thickness} mm ≠ ${material.materialId} thickness ${material.thickness} mm`,
          componentId: id,
          sourceObjectId: src,
        });
      }

      let finishedFaces = 0;
      let resolvedFinish: string | null = null;
      if (t.finish !== null) {
        const faces = out.finishedFaces ?? 0;
        if (!Number.isInteger(faces) || faces < 0 || faces > 2) {
          messages.push({ code: "COMPONENT_FINISH_FACES_INVALID", severity: "BLOCKER", message: `${id}: finished faces ${faces} must be 0, 1 or 2`, componentId: id, sourceObjectId: src });
          continue;
        }
        finishedFaces = faces;
        resolvedFinish = typeof finishId === "string" ? finishId : null;
      }

      // Edges (PRD §20): from the standard's edge rules, never from code.
      const rule = edgeSet?.[t.componentType];
      const edges: Partial<Record<EdgeSide, ComponentEdge>> = {};
      if (rule === undefined) {
        messages.push({
          code: "EDGE_RULES_UNDEFINED",
          severity: "BLOCKER",
          message: `${id}: edge rules for ${t.componentType} are not defined in ${ctx.standard.standardId} (${ctx.recipe.edgeRuleSetId})`,
          componentId: id,
          sourceObjectId: src,
        });
      } else {
        for (const side of edgeSidesForPlane(t.plane)) {
          const bandId = rule[side];
          if (bandId === undefined) continue;
          const band = findEdgeBand(ctx.catalog, bandId);
          const length = edgeLength(t.plane, side, { width, height });
          if (band === undefined || length === null) {
            messages.push({ code: "EDGE_RULE_INVALID", severity: "BLOCKER", message: `${id}: edge ${side} → '${bandId}' is invalid`, componentId: id, sourceObjectId: src });
            continue;
          }
          edges[side] = { edgeBandId: band.edgeBandId, thickness: band.thickness, length };
        }
      }

      // Grain (PRD §21): a grainless board has no grain direction.
      let grain: GrainDirection = t.grainDirection;
      if (material.grain === false) grain = "NONE";
      else if (material.grain === null && t.grainDirection !== "NONE" && !warnedGrain.has(material.materialId)) {
        warnedGrain.add(material.materialId);
        messages.push({
          code: "MATERIAL_GRAIN_UNDEFINED",
          severity: "WARNING",
          message: `${material.materialId}: grain is not defined in the catalog; recipe grain direction kept`,
          path: `materials.${material.materialId}.grain`,
          sourceObjectId: src,
        });
      }

      components.push({
        componentId: id,
        sourceObjectId: src,
        templateId: t.templateId,
        instanceIndex: i,
        componentType: t.componentType,
        dimensions: { width, height, thickness },
        materialId: material.materialId,
        finishId: resolvedFinish,
        finishedFaces,
        edges,
        grainDirection: grain,
        drilling: [],
        hardwareLinks: [],
        quantity: 1,
        manufacturingData: null,
        geometry: { plane: t.plane, local: panelBox(t.plane, { width, height, thickness }, { x: out["position.x"] ?? 0, y: out["position.y"] ?? 0, z: out["position.z"] ?? 0 }) },
      });
    }
  }

  const seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.componentId)) {
      messages.push({ code: "COMPONENT_ID_DUPLICATE", severity: "BLOCKER", message: `Duplicate component id ${c.componentId}`, componentId: c.componentId, sourceObjectId: src });
    }
    seen.add(c.componentId);
  }
  return { components, messages, undefinedConstruction: [...undefinedConstruction].sort() };
}
