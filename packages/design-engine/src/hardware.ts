import type {
  CabinetComponent,
  CatalogSnapshot,
  HardwareRequirement,
  HardwareResolution,
  HardwareRule,
  HardwareRuleSet,
  ManufacturerAdapter,
  ResolvedParameters,
  ValidationMessage,
} from "@lintel/types";
import { findMaterial } from "@lintel/catalog-engine";

export interface HardwareContext {
  readonly objectId: string;
  readonly ruleSet: HardwareRuleSet;
  readonly parameters: ResolvedParameters;
  readonly catalog: CatalogSnapshot;
  /** Depth available to fittings (cabinet depth). */
  readonly availableDepth: number;
}

function hingeRequirements(rule: Extract<HardwareRule, { application: "HINGED_DOOR" }>, components: readonly CabinetComponent[], ctx: HardwareContext): { requirements: HardwareRequirement[]; messages: ValidationMessage[] } {
  const requirements: HardwareRequirement[] = [];
  const messages: ValidationMessage[] = [];
  const selector = ctx.parameters.values[rule.mounting.parameterKey];
  const mounting = typeof selector === "string" ? rule.mounting.map[selector] : undefined;
  for (const c of components.filter((x) => x.componentType === rule.componentType)) {
    if (mounting === undefined) {
      messages.push({
        code: "HARDWARE_MOUNTING_UNMAPPED",
        severity: "BLOCKER",
        message: `${c.componentId}: no hinge mounting for ${rule.mounting.parameterKey}=${String(selector)} in ${ctx.ruleSet.ruleSetId}`,
        componentId: c.componentId,
        sourceObjectId: ctx.objectId,
      });
      continue;
    }
    const density = findMaterial(ctx.catalog, c.materialId)?.densityKgPerM3 ?? null;
    const { width, height, thickness } = c.dimensions;
    requirements.push({
      requirementId: `${c.componentId}-${rule.category}`,
      sourceObjectId: ctx.objectId,
      sourceComponentId: c.componentId,
      hardwareRuleId: rule.ruleId,
      category: rule.category,
      preferredManufacturer: rule.preferredManufacturer,
      fittingSituation: {
        application: "HINGED_DOOR",
        cabinetType: "BASE_CABINET",
        componentType: c.componentType,
        mounting,
        doorWidth: width,
        doorHeight: height,
        doorThickness: thickness,
        doorMaterialId: c.materialId,
        // Weight only when the catalog defines density; never assumed.
        doorWeightKg: density === null ? null : (width * height * thickness * density) / 1e9,
        openingAngleRequired: null,
        availableDepth: ctx.availableDepth,
      },
    });
  }
  return { requirements, messages };
}

/** A runner requirement for every component the rule names — no per-parameter mounting map (PRD §28). */
function runnerRequirements(rule: Extract<HardwareRule, { application: "DRAWER" }>, components: readonly CabinetComponent[], ctx: HardwareContext): { requirements: HardwareRequirement[]; messages: ValidationMessage[] } {
  const requirements: HardwareRequirement[] = [];
  for (const c of components.filter((x) => x.componentType === rule.componentType)) {
    const density = findMaterial(ctx.catalog, c.materialId)?.densityKgPerM3 ?? null;
    const { width, height, thickness } = c.dimensions;
    requirements.push({
      requirementId: `${c.componentId}-${rule.category}`,
      sourceObjectId: ctx.objectId,
      sourceComponentId: c.componentId,
      hardwareRuleId: rule.ruleId,
      category: rule.category,
      preferredManufacturer: rule.preferredManufacturer,
      fittingSituation: {
        application: "DRAWER",
        cabinetType: "BASE_CABINET",
        componentType: c.componentType,
        // A DRAWER_BOX_SIDE is plane YZ: width is the box's depth (its runner's nominal length), height is its height.
        boxDepth: width,
        boxHeight: height,
        boxMaterialId: c.materialId,
        boxWeightKg: density === null ? null : (width * height * thickness * density) / 1e9,
        availableDepth: ctx.availableDepth,
      },
    });
  }
  return { requirements, messages: [] };
}

/**
 * Build fitting situations from construction context (PRD §26). Users never pick a
 * generic fitting; the rule set maps component context to a requirement.
 */
export function buildHardwareRequirements(components: readonly CabinetComponent[], ctx: HardwareContext): { requirements: HardwareRequirement[]; messages: ValidationMessage[] } {
  const requirements: HardwareRequirement[] = [];
  const messages: ValidationMessage[] = [];
  for (const rule of ctx.ruleSet.rules) {
    const r = rule.application === "HINGED_DOOR" ? hingeRequirements(rule, components, ctx) : runnerRequirements(rule, components, ctx);
    requirements.push(...r.requirements);
    messages.push(...r.messages);
  }
  return { requirements, messages };
}

/** Route each requirement to its manufacturer adapter (PRD §24). */
export function resolveHardware(requirements: readonly HardwareRequirement[], adapters: readonly ManufacturerAdapter[]): HardwareResolution[] {
  return requirements.map((req) => {
    const adapter = adapters.find((a) => a.manufacturer === req.preferredManufacturer);
    if (adapter !== undefined) return adapter.resolve(req);
    return {
      requirementId: req.requirementId,
      manufacturer: req.preferredManufacturer,
      status: "UNRESOLVED",
      lines: [],
      candidates: [],
      quantityRuleId: null,
      drillingPatternId: null,
      dataset: { datasetId: "NONE", classification: "PRODUCTION", manufacturer: req.preferredManufacturer, sourceVersion: "none", authoritative: false },
      messages: [
        {
          code: "HARDWARE_ADAPTER_MISSING",
          severity: "BLOCKER",
          message: `No ${req.preferredManufacturer} adapter configured; ${req.requirementId} cannot be resolved`,
          componentId: req.sourceComponentId,
          sourceObjectId: req.sourceObjectId,
        },
      ],
    } satisfies HardwareResolution;
  });
}
