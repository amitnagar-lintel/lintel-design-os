/**
 * Reference-data intake (M6 G2): the intake file, its per-type rules and the offline validation report.
 *
 * An intake file carries exactly ONE new version of ONE reference-data entity:
 *   { format, type, classification, intent, entityCode, versionNumber, changeReason, source, sourceRef, data, … }
 * `data` is the existing domain object (the same shape the engines use, e.g. a ConstructionStandard). It is validated
 * by the strict schemas in ./schemas.ts, by the engines' own validators, and mapped to rows by @lintel/persistence
 * (which refuses TEST_FIXTURE data). Nothing here invents, defaults or rounds a value: NULL stays NULL / UNVERIFIED.
 *
 * Intent:
 *   WORKING_DRAFT          a DRAFT that may still hold NULL / UNVERIFIED values (listed in the report).
 *   PRODUCTION_CANDIDATE   a DRAFT meant for approval: it must be complete, fully sourced and depend only on
 *                          APPROVED / LOCKED versions — otherwise it is refused before anything is written.
 * Either way the version is written as DRAFT; it becomes APPROVED only through design_os.transition() (submit, then
 * approval by a different, authorised person).
 */
import { createHash } from "node:crypto";
import { KITCHEN_BASE_STANDARD_V1, PLANNING_VARIABLES } from "@lintel/catalog-engine";
import { FIXTURE_PREFIX, validateProductionRecord, validateProductionRule } from "@lintel/hettich-engine";
import type { ConstructionStandard, EdgeBandStandard, PlanningStandard } from "@lintel/types";
import { findTestFixtureMarker } from "@lintel/persistence";
import { z } from "zod";
import {
  ConstructionRecipeSchema, ConstructionStandardSchema, EdgeBandSchema, EdgeBandStandardSchema, FinishSchema, HardwareRuleSetSchema, HettichProductionDatasetSchema, MaterialSchema,
  PlanningStandardSchema, PricingRuleSetSchema, ProductDefinitionSchema, QuotationPolicySchema, RateCardSchema, ValueProvenanceSchema,
} from "./schemas.js";

export const INTAKE_FORMAT = "lintel.reference-intake/v1";

/** The types the intake accepts: every type with an existing domain model and persistence mapping. */
export const INTAKE_TYPES = [
  "construction_standard", "planning_standard", "edge_band_standard",
  "material", "edge_band", "finish", "hardware_rule_set", "construction_recipe", "product",
  "material_catalog", "finish_catalog", "hardware_catalog", "product_catalog",
  "hettich_dataset", "pricing_standard", "quotation_policy",
] as const;
export type IntakeType = (typeof INTAKE_TYPES)[number];

/**
 * Types of the reference-data architecture the intake does NOT accept yet, and why. No domain model exists for them,
 * so accepting them would mean inventing one. (ManufacturingStandard is Phase 2.)
 */
export const NOT_ACCEPTED: Readonly<Record<string, string>> = {
  hardware_item: "no approved domain model for hardware items exists yet (hardware is resolved through the Hettich dataset)",
  appliance: "no appliance domain model exists yet (appliances are recorded off-system for the V1 pilot)",
  appliance_catalog: "no appliance domain model exists yet",
  manufacturing_standard: "Phase 2: no ManufacturingStandard variables are defined",
};

export const CATALOG_MEMBERS: Readonly<Record<"material_catalog" | "finish_catalog" | "hardware_catalog" | "product_catalog", readonly string[]>> = {
  material_catalog: ["material", "edge_band"],
  finish_catalog: ["finish"],
  hardware_catalog: ["hardware_item", "hardware_rule_set"],
  product_catalog: ["product"],
};

const Code = z.string().trim().min(1).max(100);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const VersionRef = z.strictObject({ entityCode: Code, versionNumber: z.number().int().min(1) });
export const SourceRefSchema = z.strictObject({
  url: z.string().nullable(), documentTitle: z.string().nullable(), documentVersion: z.string().nullable(), sourceDate: IsoDate.nullable(),
});

export const IntakeFileSchema = z.strictObject({
  format: z.literal(INTAKE_FORMAT),
  type: z.enum(INTAKE_TYPES),
  /** Must be PRODUCTION. TEST_FIXTURE is refused explicitly (it can never be persisted). */
  classification: z.string(),
  intent: z.enum(["WORKING_DRAFT", "PRODUCTION_CANDIDATE"]),
  entityCode: Code,
  versionNumber: z.number().int().min(1),
  changeReason: z.string().trim().min(1).max(2000),
  /** Where the values come from (document, drawing, supplier sheet, official URL). */
  source: z.string().trim().min(1).max(2000),
  sourceRef: SourceRefSchema,
  data: z.unknown(),
  /** Numeric standards: provenance per variable (unit, source, evidence reference, note). */
  provenance: z.record(Code, ValueProvenanceSchema).optional(),
  /** Product: the exact recipe version it is built on. */
  recipe: VersionRef.optional(),
});
export type IntakeFile = z.infer<typeof IntakeFileSchema>;

const CatalogData = z.strictObject({
  versionLabel: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2000),
  members: z.array(z.strictObject({ itemType: Code, entityCode: Code, versionNumber: z.number().int().min(1) })),
});
export type CatalogData = z.infer<typeof CatalogData>;
const PricingData = z.strictObject({ rateCard: RateCardSchema, rules: PricingRuleSetSchema });

const DATA_SCHEMAS: Readonly<Record<IntakeType, z.ZodType>> = {
  construction_standard: ConstructionStandardSchema, planning_standard: PlanningStandardSchema, edge_band_standard: EdgeBandStandardSchema,
  material: MaterialSchema, edge_band: EdgeBandSchema, finish: FinishSchema, hardware_rule_set: HardwareRuleSetSchema,
  construction_recipe: ConstructionRecipeSchema, product: ProductDefinitionSchema,
  material_catalog: CatalogData, finish_catalog: CatalogData, hardware_catalog: CatalogData, product_catalog: CatalogData,
  hettich_dataset: HettichProductionDatasetSchema, pricing_standard: PricingData, quotation_policy: QuotationPolicySchema,
};

// ---------------------------------------------------------------- report

export type Level = "ERROR" | "UNVERIFIED" | "INFO";
export interface Finding {
  readonly level: Level;
  readonly code: string;
  readonly path: string;
  readonly message: string;
}
const LEVEL_ORDER: Readonly<Record<Level, number>> = { ERROR: 0, UNVERIFIED: 1, INFO: 2 };
export function sortFindings(f: readonly Finding[]): Finding[] {
  return [...f].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.message < b.message ? -1 : 1));
}

export interface Validated {
  readonly file: IntakeFile;
  /** SHA-256 of the exact file bytes (recorded in the audit reason). */
  readonly fileHash: string;
  readonly findings: readonly Finding[];
  /** No ERROR, and — for a PRODUCTION_CANDIDATE — no UNVERIFIED either. */
  readonly accepted: boolean;
}

/** The domain id each type's `data` carries; the file's entityCode must equal it (explicit identity). */
function domainId(type: IntakeType, data: Record<string, unknown>): string | null {
  const key: Partial<Record<IntakeType, string>> = {
    construction_standard: "standardId", planning_standard: "standardId", edge_band_standard: "standardId", material: "materialId", edge_band: "edgeBandId", finish: "finishId",
    hardware_rule_set: "ruleSetId", construction_recipe: "recipeId", product: "productId", hettich_dataset: "datasetId", quotation_policy: "policyId",
  };
  const k = key[type];
  return k === undefined ? null : typeof data[k] === "string" ? data[k] : null;
}

/** The `source` the stored envelope will carry; the file's `source` must equal it where the domain object has one. */
function domainSource(type: IntakeType, data: Record<string, unknown>): string | null {
  if (type === "pricing_standard") return ((data.rateCard ?? {}) as { source?: string }).source ?? null;
  return typeof data.source === "string" ? data.source : null;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup].sort();
}

const CONSTRUCTION_CODES = KITCHEN_BASE_STANDARD_V1.constructionVariables.map((v) => v.key).sort();
const PLANNING_CODES = PLANNING_VARIABLES.map((v) => v.key).sort();

/** Parse and validate an intake file without any database access. Deterministic: same bytes → same report. */
export function validateIntake(bytes: string): Validated | { readonly fileHash: string; readonly findings: readonly Finding[]; readonly accepted: false; readonly file: null } {
  const fileHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const out: Finding[] = [];
  const err = (code: string, path: string, message: string) => out.push({ level: "ERROR", code, path, message });
  const unverified = (code: string, path: string, message: string) => out.push({ level: "UNVERIFIED", code, path, message });

  let json: unknown;
  try {
    json = JSON.parse(bytes);
  } catch (e) {
    return { fileHash, findings: [{ level: "ERROR", code: "FILE_NOT_JSON", path: "$", message: e instanceof Error ? e.message : String(e) }], accepted: false, file: null };
  }
  // TEST_FIXTURE anywhere in the file is refused before anything else, with its own code.
  const marker = findTestFixtureMarker(json);
  if (marker !== null) err("TEST_FIXTURE_REFUSED", marker, "TEST_FIXTURE data can never be imported as production data");
  const type = (json as { type?: unknown } | null)?.type;
  if (typeof type === "string" && type in NOT_ACCEPTED) err("TYPE_NOT_ACCEPTED", "$.type", `${type}: ${NOT_ACCEPTED[type] ?? ""}`);

  const parsed = IntakeFileSchema.safeParse(json);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err("FORMAT_INVALID", `$.${i.path.join(".")}`, i.message);
    return { fileHash, findings: sortFindings(out), accepted: false, file: null };
  }
  const file = parsed.data;
  if (file.classification === "TEST_FIXTURE") err("TEST_FIXTURE_REFUSED", "$.classification", "TEST_FIXTURE data can never be imported as production data");
  else if (file.classification !== "PRODUCTION") err("CLASSIFICATION_INVALID", "$.classification", "classification must be PRODUCTION");
  if (file.entityCode.toUpperCase().includes("TEST_FIXTURE") || file.entityCode.startsWith(FIXTURE_PREFIX)) err("TEST_FIXTURE_REFUSED", "$.entityCode", "fixture codes are never production entities");

  const data = DATA_SCHEMAS[file.type].safeParse(file.data);
  if (!data.success) {
    for (const i of data.error.issues) err("DATA_INVALID", `$.data.${i.path.join(".")}`, i.message);
    return { file, fileHash, findings: sortFindings(out), accepted: false };
  }
  const d = data.data as Record<string, unknown>;

  // ---- identity and lifecycle
  const id = domainId(file.type, d);
  if (id !== null && id !== file.entityCode) err("IDENTITY_MISMATCH", "$.entityCode", `entityCode ${file.entityCode} must equal the data's id ${id}`);
  const status = (d as { status?: string }).status;
  if (status !== undefined && status !== "DRAFT") {
    if (status === "TEST_FIXTURE") err("TEST_FIXTURE_REFUSED", "$.data.status", "TEST_FIXTURE data can never be imported");
    else err("STATUS_NOT_DRAFT", "$.data.status", `data status must be DRAFT (got ${status}): approval happens only through the approval workflow, never by import`);
  }
  if (file.type === "pricing_standard") {
    const p = d as z.infer<typeof PricingData>;
    for (const [k, s] of [["rateCard", p.rateCard], ["rules", p.rules]] as const) {
      if (s.status !== "DRAFT") err("STATUS_NOT_DRAFT", `$.data.${k}.status`, "must be DRAFT");
      if (s.classification !== "PRODUCTION") err("TEST_FIXTURE_REFUSED", `$.data.${k}.classification`, "must be PRODUCTION");
    }
    if (p.rateCard.version !== p.rules.version) err("IDENTITY_MISMATCH", "$.data.rules.version", "rate card and pricing rules versions must be equal");
    if (p.rateCard.effectiveFrom !== null) err("EFFECTIVE_FROM_NOT_ALLOWED", "$.data.rateCard.effectiveFrom", "effectiveFrom is set by the approval, never by import (must be null)");
  }
  if (file.type === "quotation_policy" && (d as { classification: string }).classification !== "PRODUCTION") err("TEST_FIXTURE_REFUSED", "$.data.classification", "must be PRODUCTION");

  // ---- provenance
  const ds = domainSource(file.type, d);
  if (ds !== null && ds !== file.source) err("SOURCE_MISMATCH", "$.source", "source must equal the data's own source (one source of record)");
  if (file.intent === "PRODUCTION_CANDIDATE") {
    if (file.sourceRef.documentTitle === null) err("PROVENANCE_MISSING", "$.sourceRef.documentTitle", "a production candidate names its source document");
    if (file.sourceRef.sourceDate === null) err("PROVENANCE_MISSING", "$.sourceRef.sourceDate", "a production candidate dates its source");
  }

  // ---- per-type content
  const numeric = (s: ConstructionStandard | PlanningStandard, registry: readonly string[]) => {
    const keys = Object.keys(s.variables).sort();
    for (const k of keys) if (!registry.includes(k)) err("UNKNOWN_VARIABLE", `$.data.variables.${k}`, `${k} is not a registered variable`);
    for (const k of registry) {
      if (!(k in s.variables)) unverified("VALUE_MISSING", `$.data.variables.${k}`, `${k} is not provided`);
      else if (s.variables[k] === null) unverified("VALUE_UNVERIFIED", `$.data.variables.${k}`, `${k} is NULL / UNVERIFIED`);
    }
    const prov = file.provenance ?? {};
    for (const k of Object.keys(prov).sort()) if (!(k in s.variables)) err("PROVENANCE_FOR_UNKNOWN_VALUE", `$.provenance.${k}`, `provenance for ${k}, which the data does not declare`);
    for (const k of keys) {
      if (s.variables[k] === null) continue;
      const p = prov[k];
      if (p?.source == null || p.source.trim() === "") err("VALUE_WITHOUT_SOURCE", `$.provenance.${k}`, `${k} has a value but no source: an unsourced value is never accepted`);
      else if (p.evidenceRef == null || p.evidenceRef.trim() === "") unverified("EVIDENCE_MISSING", `$.provenance.${k}.evidenceRef`, `${k} has no evidence reference`);
    }
  };
  switch (file.type) {
    case "construction_standard": numeric(d as unknown as ConstructionStandard, CONSTRUCTION_CODES); break;
    case "planning_standard": numeric(d as unknown as PlanningStandard, PLANNING_CODES); break;
    case "edge_band_standard": {
      const s = d as unknown as EdgeBandStandard;
      if (Object.keys(s.ruleSets).length === 0) unverified("RULES_MISSING", "$.data.ruleSets", "no edge rule set");
      for (const [set, rules] of Object.entries(s.ruleSets)) if (Object.keys(rules).length === 0) unverified("RULES_MISSING", `$.data.ruleSets.${set}`, `rule set ${set} defines no component type`);
      break;
    }
    case "material": {
      const m = d as z.infer<typeof MaterialSchema>;
      for (const [k, v] of [["substrate", m.substrate], ["sheetSize", m.sheetSize], ["grain", m.grain], ["densityKgPerM3", m.densityKgPerM3]] as const) {
        if (v === null) unverified("VALUE_UNVERIFIED", `$.data.${k}`, `${k} is NULL / UNVERIFIED`);
      }
      break;
    }
    case "edge_band": {
      const b = d as z.infer<typeof EdgeBandSchema>;
      if (b.material === null) unverified("VALUE_UNVERIFIED", "$.data.material", "material is NULL / UNVERIFIED");
      if (b.width === null) unverified("VALUE_UNVERIFIED", "$.data.width", "width is NULL / UNVERIFIED");
      break;
    }
    case "finish":
      if ((d as z.infer<typeof FinishSchema>).thickness === null) unverified("VALUE_UNVERIFIED", "$.data.thickness", "thickness is NULL / UNVERIFIED");
      break;
    case "hardware_rule_set": {
      const s = d as z.infer<typeof HardwareRuleSetSchema>;
      for (const x of duplicates(s.rules.map((r) => r.ruleId))) err("DUPLICATE_RECORD", "$.data.rules", `rule ${x} appears more than once`);
      if (s.rules.length === 0) unverified("RULES_MISSING", "$.data.rules", "no hardware rules");
      break;
    }
    case "construction_recipe": {
      const r = d as z.infer<typeof ConstructionRecipeSchema>;
      for (const x of duplicates(r.components.map((c) => c.templateId))) err("DUPLICATE_RECORD", "$.data.components", `component template ${x} appears more than once`);
      for (const x of duplicates(r.formulas.map((f) => f.formulaId))) err("DUPLICATE_RECORD", "$.data.formulas", `formula ${x} appears more than once`);
      for (const x of duplicates(r.rules.map((f) => f.ruleId))) err("DUPLICATE_RECORD", "$.data.rules", `rule ${x} appears more than once`);
      break;
    }
    case "product": {
      const p = d as z.infer<typeof ProductDefinitionSchema>;
      if (file.recipe === undefined) err("DEPENDENCY_MISSING", "$.recipe", "a product names the exact recipe version it is built on");
      else if (file.recipe.entityCode !== p.recipeId) err("IDENTITY_MISMATCH", "$.recipe.entityCode", `the recipe must be ${p.recipeId}`);
      for (const x of duplicates(p.parameters.map((q) => q.key))) err("DUPLICATE_RECORD", "$.data.parameters", `parameter ${x} appears more than once`);
      for (const q of p.parameters) {
        if (q.kind !== "number" && q.kind !== "integer") continue;
        if (q.min === null) unverified("LIMIT_UNVERIFIED", `$.data.parameters.${q.key}.min`, `${q.key} minimum is NULL / UNVERIFIED`);
        if (q.max === null) unverified("LIMIT_UNVERIFIED", `$.data.parameters.${q.key}.max`, `${q.key} maximum is NULL / UNVERIFIED`);
      }
      break;
    }
    case "material_catalog":
    case "finish_catalog":
    case "hardware_catalog":
    case "product_catalog": {
      const c = d as CatalogData;
      const allowed = CATALOG_MEMBERS[file.type];
      c.members.forEach((m, i) => { if (!allowed.includes(m.itemType)) err("MEMBER_TYPE_INVALID", `$.data.members.${String(i)}.itemType`, `${file.type} lists only ${allowed.join(", ")}`); });
      for (const x of duplicates(c.members.map((m) => `${m.itemType}:${m.entityCode}`))) err("DUPLICATE_RECORD", "$.data.members", `${x} is listed more than once (a catalog version lists one exact version per item)`);
      if (c.members.length === 0) unverified("MEMBERS_MISSING", "$.data.members", "the catalog version lists no items");
      break;
    }
    case "hettich_dataset": {
      const h = d as z.infer<typeof HettichProductionDatasetSchema>;
      for (const x of duplicates(h.records.map((r) => r.recordId))) err("DUPLICATE_RECORD", "$.data.records", `record ${x} appears more than once`);
      for (const x of duplicates(h.records.flatMap((r) => (r.articleNumber === null ? [] : [r.articleNumber])))) err("DUPLICATE_RECORD", "$.data.records", `article ${x} appears more than once`);
      for (const x of duplicates(h.calculationRules.map((r) => r.ruleId))) err("DUPLICATE_RECORD", "$.data.calculationRules", `rule ${x} appears more than once`);
      if (h.records.length === 0) unverified("RECORDS_MISSING", "$.data.records", "the dataset has no records");
      h.records.forEach((r, i) => {
        if (r.articleNumber?.startsWith(FIXTURE_PREFIX) === true) err("TEST_FIXTURE_REFUSED", `$.data.records.${String(i)}.articleNumber`, "FIXTURE-* articles are never production data");
        if (r.licence.status === "RESTRICTED" || r.licence.status === "UNKNOWN") err("LICENCE_NOT_CLEARED", `$.data.records.${String(i)}.licence.status`, `licence ${r.licence.status}: only OFFICIAL_PUBLIC or AUTHORISED data may be used`);
        for (const m of validateProductionRecord(r)) if (m.code !== "HETTICH_LICENCE_NOT_CLEARED" && m.code !== "HETTICH_FIXTURE_IN_PRODUCTION") unverified(m.code, `$.data.records.${String(i)}`, m.message);
      });
      h.calculationRules.forEach((r, i) => { for (const m of validateProductionRule(r)) unverified(m.code, `$.data.calculationRules.${String(i)}`, m.message); });
      break;
    }
    case "pricing_standard": {
      const p = d as z.infer<typeof PricingData>;
      const rates = [["boardPerM2", p.rateCard.boardPerM2], ["edgeBandPerM", p.rateCard.edgeBandPerM], ["finishPerM2", p.rateCard.finishPerM2], ["hardwarePerUnit", p.rateCard.hardwarePerUnit]] as const;
      if (rates.every(([, r]) => Object.keys(r).length === 0)) unverified("RATES_MISSING", "$.data.rateCard", "the rate card has no rates");
      for (const [k, r] of rates) for (const [item, v] of Object.entries(r).sort()) if (v === null) unverified("VALUE_UNVERIFIED", `$.data.rateCard.${k}.${item}`, `rate ${item} is NULL / UNVERIFIED`);
      const rules = p.rules;
      const fields: [string, unknown][] = [["manufacturingCost", rules.manufacturingCost], ["wastagePercent.board", rules.wastagePercent.board], ["wastagePercent.edgeBand", rules.wastagePercent.edgeBand],
        ["wastagePercent.finish", rules.wastagePercent.finish], ["overheadPercent", rules.overheadPercent], ["marginBasis", rules.marginBasis], ["marginPercent", rules.marginPercent], ["gstPercent", rules.gstPercent]];
      for (const [k, v] of fields) if (v === null) unverified("VALUE_UNVERIFIED", `$.data.rules.${k}`, `${k} is NULL / UNVERIFIED`);
      break;
    }
    case "quotation_policy": {
      const q = d as z.infer<typeof QuotationPolicySchema>;
      if (Object.keys(q.taxRates).length === 0) unverified("RATES_MISSING", "$.data.taxRates", "no tax rates");
      if (Object.keys(q.taxRateByProductCategory).length === 0) unverified("RATES_MISSING", "$.data.taxRateByProductCategory", "no product category is mapped to a tax rate");
      for (const [k, v] of Object.entries(q.taxRates).sort()) if (v === null) unverified("VALUE_UNVERIFIED", `$.data.taxRates.${k}`, `tax rate ${k} is NULL / UNVERIFIED`);
      for (const [k, v] of Object.entries(q.taxRateByProductCategory).sort()) {
        if (v === null) unverified("VALUE_UNVERIFIED", `$.data.taxRateByProductCategory.${k}`, `mapping for ${k} is NULL / UNVERIFIED`);
        else if (!(v in q.taxRates)) err("REFERENCE_INVALID", `$.data.taxRateByProductCategory.${k}`, `tax rate ${v} is not defined`);
      }
      for (const [k, v] of [["taxPolicy", q.taxPolicy], ["rounding.tax", q.rounding.tax], ["rounding.grandTotal", q.rounding.grandTotal], ["discountPolicy", q.discountPolicy]] as const) {
        if (v === null) unverified("VALUE_UNVERIFIED", `$.data.${k}`, `${k} is NULL / UNVERIFIED`);
      }
      break;
    }
  }

  if (file.intent === "PRODUCTION_CANDIDATE" && out.some((f) => f.level === "UNVERIFIED")) {
    err("INCOMPLETE_PRODUCTION_DATA", "$", "a PRODUCTION_CANDIDATE must be complete and fully sourced: every UNVERIFIED item above refuses it");
  }
  const findings = sortFindings(out);
  return { file, fileHash, findings, accepted: !findings.some((f) => f.level === "ERROR") };
}
