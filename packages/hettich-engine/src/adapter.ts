import type {
  FittingSituation,
  HardwareDatasetRef,
  HardwareRequirement,
  HardwareResolution,
  ManufacturerAdapter,
  ResolvedArticleLine,
  ScalarValue,
  ValidationMessage,
} from "@lintel/types";
import { evaluateBoolean, evaluateNumber } from "@lintel/rules-engine";
import type { HettichArticle, HettichCalculationRule, HettichDataset } from "./model.js";
import { toEngineArticle, validateFixtureDataset, validateProductionRecord, validateProductionRule } from "./validate.js";

export const HETTICH = "HETTICH";

/** The data the engine may actually use from a dataset, plus why anything was excluded. */
export interface UsableHettichData {
  readonly ref: HardwareDatasetRef;
  readonly articles: readonly HettichArticle[];
  readonly calculationRules: readonly HettichCalculationRule[];
  /** Dataset-level problems (excluded records / rules, mislabelled fixtures). */
  readonly messages: readonly ValidationMessage[];
  readonly excludedRecords: number;
}

/**
 * PRODUCTION: only records and rules that pass validation are usable.
 * TEST_FIXTURE: articles used as-is but never authoritative.
 */
export function usableData(dataset: HettichDataset): UsableHettichData {
  if (dataset.kind === "TEST_FIXTURE") {
    return {
      ref: { datasetId: dataset.datasetId, classification: "TEST_FIXTURE", manufacturer: HETTICH, sourceVersion: dataset.sourceVersion, authoritative: false },
      articles: dataset.articles,
      calculationRules: dataset.calculationRules,
      messages: validateFixtureDataset(dataset),
      excludedRecords: 0,
    };
  }
  const messages: ValidationMessage[] = [];
  const articles: HettichArticle[] = [];
  let excluded = 0;
  for (const r of dataset.records) {
    const problems = validateProductionRecord(r);
    if (problems.length === 0) articles.push(toEngineArticle(r));
    else {
      excluded++;
      messages.push(...problems);
    }
  }
  const calculationRules: HettichCalculationRule[] = [];
  for (const rule of dataset.calculationRules) {
    const problems = validateProductionRule(rule);
    if (problems.length === 0) calculationRules.push(rule);
    else messages.push(...problems);
  }
  return {
    ref: { datasetId: dataset.datasetId, classification: "PRODUCTION", manufacturer: HETTICH, sourceVersion: dataset.sourceVersion, authoritative: true },
    articles,
    calculationRules,
    messages,
    excludedRecords: excluded,
  };
}

export interface CompatibilityResult {
  readonly compatible: readonly HettichArticle[];
  /** Why each rejected article was excluded (articleNumber → reason). */
  readonly rejected: Readonly<Record<string, string>>;
}

function compareArticles(a: HettichArticle, b: HettichArticle): number {
  return a.preferenceRank - b.preferenceRank || (a.articleNumber < b.articleNumber ? -1 : a.articleNumber > b.articleNumber ? 1 : 0);
}

/** PRD §26: fitting situation → compatibility engine → valid articles (ranked). Pure. */
export function findCompatibleArticles(data: UsableHettichData, requirement: HardwareRequirement): CompatibilityResult {
  const s = requirement.fittingSituation;
  const rejected: Record<string, string> = {};
  const compatible: HettichArticle[] = [];
  for (const a of data.articles) {
    if (a.category !== requirement.category) continue;
    if (a.application !== s.application) {
      rejected[a.articleNumber] = `application ${String(a.application)} ≠ ${s.application}`;
    } else if (a.mounting !== s.mounting) {
      rejected[a.articleNumber] = `mounting ${String(a.mounting)} ≠ ${s.mounting}`;
    } else if (a.doorThicknessRange === null) {
      rejected[a.articleNumber] = "door thickness range not defined in dataset";
    } else if (s.doorThickness < a.doorThicknessRange.min || s.doorThickness > a.doorThicknessRange.max) {
      rejected[a.articleNumber] = `door thickness ${s.doorThickness} outside ${a.doorThicknessRange.min}-${a.doorThicknessRange.max}`;
    } else if (s.openingAngleRequired !== null && (a.openingAngle === null || a.openingAngle < s.openingAngleRequired)) {
      rejected[a.articleNumber] = `opening angle ${String(a.openingAngle)} < required ${s.openingAngleRequired}`;
    } else {
      compatible.push(a);
    }
  }
  return { compatible: compatible.sort(compareArticles), rejected };
}

export function fittingScope(s: FittingSituation): Record<string, ScalarValue> {
  const scope: Record<string, ScalarValue> = {
    DOOR_WIDTH: s.doorWidth,
    DOOR_HEIGHT: s.doorHeight,
    DOOR_THICKNESS: s.doorThickness,
  };
  if (s.doorWeightKg !== null) scope.DOOR_WEIGHT = s.doorWeightKg;
  if (s.openingAngleRequired !== null) scope.OPENING_ANGLE = s.openingAngleRequired;
  return scope;
}

type QuantityOutcome = { readonly ok: true; readonly quantity: number; readonly ruleId: string } | { readonly ok: false; readonly reason: string };

/** Quantity from the manufacturer calculation rule for the article family (PRD §27). */
export function calculateQuantity(data: UsableHettichData, article: HettichArticle, situation: FittingSituation): QuantityOutcome {
  const rule = data.calculationRules.find((r) => r.family === article.family && r.category === article.category);
  if (rule === undefined) return { ok: false, reason: `no calculation rule for family ${article.family}` };
  const scope = fittingScope(situation);
  for (const band of rule.bands) {
    const w = evaluateBoolean(band.when, scope);
    if (!w.ok) return { ok: false, reason: `rule ${rule.ruleId} not evaluable: ${w.error.message}` };
    if (w.value) {
      const q = evaluateNumber(band.quantity, scope);
      if (!q.ok) return { ok: false, reason: `rule ${rule.ruleId} quantity not evaluable: ${q.error.message}` };
      if (!Number.isInteger(q.value) || q.value < 1) return { ok: false, reason: `rule ${rule.ruleId} produced invalid quantity ${q.value}` };
      return { ok: true, quantity: q.value, ruleId: rule.ruleId };
    }
  }
  return { ok: false, reason: `door is outside every band of rule ${rule.ruleId}` };
}

function line(a: HettichArticle, quantity: number): ResolvedArticleLine {
  return {
    manufacturer: HETTICH,
    articleNumber: a.articleNumber,
    description: a.description,
    category: a.category,
    quantity,
    sourceUrl: a.sourceUrl,
    sourceVersion: a.sourceVersion,
    licenseStatus: a.licenseStatus,
  };
}

/** Resolve one requirement against usable dataset content. Pure and deterministic. */
export function resolveWithData(data: UsableHettichData, requirement: HardwareRequirement): HardwareResolution {
  const ref = data.ref;
  const ctx = { sourceObjectId: requirement.sourceObjectId, componentId: requirement.sourceComponentId };
  const messages: ValidationMessage[] = [...data.messages];
  const unresolved = (code: string, message: string, candidates: readonly string[] = []): HardwareResolution => ({
    requirementId: requirement.requirementId,
    manufacturer: HETTICH,
    status: "UNRESOLVED",
    lines: [],
    candidates,
    quantityRuleId: null,
    drillingPatternId: null,
    dataset: ref,
    messages: [...messages, { code, severity: "BLOCKER", message, ...ctx }],
  });

  if (ref.classification === "TEST_FIXTURE") {
    messages.push({
      code: "HARDWARE_DATA_NOT_AUTHORITATIVE",
      severity: "BLOCKER",
      message: `Hardware for ${requirement.requirementId} resolved from TEST_FIXTURE dataset ${ref.datasetId}`,
      ...ctx,
    });
  }
  if (data.articles.length === 0) {
    const excluded = data.excludedRecords > 0 ? `; ${data.excludedRecords} record(s) excluded as unverified` : "";
    return unresolved(
      "HARDWARE_DATA_UNAVAILABLE",
      `No verified Hettich article data (dataset ${ref.datasetId} ${ref.sourceVersion}${excluded}); ${requirement.category} for ${requirement.sourceComponentId} cannot be resolved`,
    );
  }
  const { compatible } = findCompatibleArticles(data, requirement);
  const primary = compatible[0];
  const candidates = compatible.map((a) => a.articleNumber);
  if (primary === undefined) {
    return unresolved("HARDWARE_NO_COMPATIBLE_ARTICLE", `No compatible Hettich ${requirement.category} for ${requirement.sourceComponentId} (${requirement.fittingSituation.mounting}, door ${requirement.fittingSituation.doorThickness} mm)`);
  }
  const qty = calculateQuantity(data, primary, requirement.fittingSituation);
  if (!qty.ok) return unresolved("HARDWARE_QUANTITY_UNRESOLVED", `${primary.articleNumber}: ${qty.reason}`, candidates);

  const lines: ResolvedArticleLine[] = [line(primary, qty.quantity)];
  // compatibleArticles are alternatives in preference order; an empty list means none is required.
  if (primary.compatibleArticles.length > 0) {
    const accessory = primary.compatibleArticles
      .map((n) => data.articles.find((a) => a.articleNumber === n))
      .find((a) => a !== undefined);
    if (accessory === undefined) {
      return unresolved(
        "HARDWARE_ACCESSORY_MISSING",
        `${primary.articleNumber} requires one of [${primary.compatibleArticles.join(", ")}], none of which is in dataset ${ref.datasetId}`,
        candidates,
      );
    }
    lines.push(line(accessory, qty.quantity));
  }
  return {
    requirementId: requirement.requirementId,
    manufacturer: HETTICH,
    status: "RESOLVED",
    lines,
    candidates,
    quantityRuleId: qty.ruleId,
    drillingPatternId: primary.drillingPatternId,
    dataset: ref,
    messages,
  };
}

export function createHettichAdapter(dataset: HettichDataset): ManufacturerAdapter {
  const data = usableData(dataset);
  return {
    manufacturer: HETTICH,
    dataset: data.ref,
    resolve: (requirement) => resolveWithData(data, requirement),
  };
}
