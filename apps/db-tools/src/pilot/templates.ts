/**
 * Production intake templates for the pilot (M6 STEP 7): one intake file per required reference-data entity, built
 * from the repository's PRODUCTION drafts. Every value the drafts leave NULL stays NULL — nothing is invented — and the
 * offline validator's UNVERIFIED findings are the exact list of values Lintel must provide and approve.
 */
import { EDGE_BANDS, FINISHES, HINGE_STANDARD, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT,
  LINTEL_PLANNING_STANDARD_DRAFT, MATERIALS } from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET } from "@lintel/hettich-engine";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_RATE_CARD } from "@lintel/pricing-engine";
import type { Finding, IntakeType } from "../intake/spec.js";
import { INTAKE_FORMAT, validateIntake } from "../intake/spec.js";
import type { Role } from "./rehearsal-dataset.js";

export interface Template {
  readonly name: string;
  readonly type: IntakeType;
  readonly entityCode: string;
  readonly author: Role;
  readonly approver: Role;
  readonly file: Record<string, unknown>;
}

const sourceRef = { url: null, documentTitle: null, documentVersion: null, sourceDate: null };
const nullProvenance = (vars: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.keys(vars).map((k) => [k, { unit: "MM", source: null, evidenceRef: null, note: null }]));
const catalog = (label: string, members: readonly (readonly [string, string])[]) =>
  ({ versionLabel: label, description: `Lintel ${label} for the V1 pilot`, members: members.map(([itemType, entityCode]) => ({ itemType, entityCode, versionNumber: 1 })) });
function template(type: IntakeType, entityCode: string, data: unknown, source: string, author: Role, approver: Role, extra: Record<string, unknown> = {}): Omit<Template, "name"> {
  return {
    type, entityCode, author, approver,
    file: { format: INTAKE_FORMAT, type, classification: "PRODUCTION", intent: "WORKING_DRAFT", entityCode, versionNumber: 1, changeReason: "Initial Lintel values for the V1 pilot", source, sourceRef, data, ...extra },
  };
}

/** In dependency order: import and approve each before the next that references it. */
export function productionTemplates(): Template[] {
  const pending = "Pending — Lintel catalog (confirm or replace with the source document)";
  const list: Omit<Template, "name">[] = [
    template("construction_standard", LINTEL_CONSTRUCTION_STANDARD_DRAFT.standardId, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_CONSTRUCTION_STANDARD_DRAFT.source, "PRODUCTION", "DESIGN_HEAD", { provenance: nullProvenance(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables) }),
    template("planning_standard", LINTEL_PLANNING_STANDARD_DRAFT.standardId, LINTEL_PLANNING_STANDARD_DRAFT, LINTEL_PLANNING_STANDARD_DRAFT.source, "PRODUCTION", "DESIGN_HEAD", { provenance: nullProvenance(LINTEL_PLANNING_STANDARD_DRAFT.variables) }),
    ...MATERIALS.map((m) => template("material", m.materialId, m, m.source, "PROCUREMENT", "DESIGN_HEAD")),
    ...EDGE_BANDS.map((b) => template("edge_band", b.edgeBandId, b, b.source, "PROCUREMENT", "DESIGN_HEAD")),
    ...FINISHES.map((f) => template("finish", f.finishId, f, f.source, "PROCUREMENT", "DESIGN_HEAD")),
    template("edge_band_standard", LINTEL_EDGE_BAND_STANDARD_DRAFT.standardId, LINTEL_EDGE_BAND_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT.source, "PRODUCTION", "DESIGN_HEAD"),
    template("hardware_rule_set", HINGE_STANDARD.ruleSetId, HINGE_STANDARD, pending, "PROCUREMENT", "PRODUCTION"),
    template("construction_recipe", KITCHEN_BASE_STANDARD_V1.recipeId, KITCHEN_BASE_STANDARD_V1, pending, "DESIGN_HEAD", "PRODUCTION"),
    template("product", KIT_BASE_STANDARD.productId, KIT_BASE_STANDARD, pending, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_BASE_STANDARD_V1.recipeId, versionNumber: 1 } }),
    template("material_catalog", "LINTEL_MATERIAL_CATALOG", catalog("material catalog", [...MATERIALS.map((m) => ["material", m.materialId] as const), ...EDGE_BANDS.map((b) => ["edge_band", b.edgeBandId] as const)]), pending, "PROCUREMENT", "DESIGN_HEAD"),
    template("finish_catalog", "LINTEL_FINISH_CATALOG", catalog("finish catalog", FINISHES.map((f) => ["finish", f.finishId] as const)), pending, "PROCUREMENT", "DESIGN_HEAD"),
    template("hardware_catalog", "LINTEL_HARDWARE_CATALOG", catalog("hardware catalog", [["hardware_rule_set", HINGE_STANDARD.ruleSetId]]), pending, "PROCUREMENT", "PRODUCTION"),
    template("product_catalog", "LINTEL_PRODUCT_CATALOG", catalog("product catalog", [["product", KIT_BASE_STANDARD.productId]]), pending, "DESIGN_HEAD", "PRODUCTION"),
    template("hettich_dataset", HETTICH_PRODUCTION_DATASET.datasetId, HETTICH_PRODUCTION_DATASET, "Pending — official Hettich sources (eShop / CAD / Technical Assistant)", "PROCUREMENT", "PRODUCTION"),
    template("pricing_standard", "LINTEL_PRICING_STANDARD", { rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES }, LINTEL_PRODUCTION_RATE_CARD.source, "COSTING", "FINANCE"),
    template("quotation_policy", LINTEL_PRODUCTION_QUOTATION_POLICY.policyId, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_QUOTATION_POLICY.source, "COSTING", "FINANCE"),
  ];
  return list.map((t, i) => ({ ...t, name: `${String(i + 1).padStart(2, "0")}-${t.type}-${t.entityCode}.json` }));
}

export interface TemplateReport {
  readonly template: Template;
  readonly accepted: boolean;
  readonly errors: readonly Finding[];
  readonly missing: readonly Finding[];
}

export function templateReports(): TemplateReport[] {
  return productionTemplates().map((t) => {
    const v = validateIntake(JSON.stringify(t.file));
    return { template: t, accepted: v.accepted, errors: v.findings.filter((f) => f.level === "ERROR"), missing: v.findings.filter((f) => f.level === "UNVERIFIED") };
  });
}

/** The README of the templates folder: per file, who authors / approves it and every value still missing. */
export function templatesReadme(reports: readonly TemplateReport[]): string {
  const lines = [
    "# Pilot intake templates (generated — do not edit by hand)",
    "",
    "Generated by `pnpm pilot:templates` from the repository's PRODUCTION drafts. Every NULL is a value Lintel has not",
    "provided yet; nothing here is invented. Fill a copy, set `intent` to `PRODUCTION_CANDIDATE`, fill `sourceRef`",
    "(document title and date), then import, submit and approve it (see docs/PILOT-TOMORROW.md, section E).",
    "Import in the numbered order: each file may reference the ones before it, which must already be APPROVED.",
    "",
    "| # | File | Author role (imports, submits) | Approver role (a different person) | Values still missing |",
    "|---|---|---|---|---|",
  ];
  for (const r of reports) lines.push(`| ${r.template.name.slice(0, 2)} | \`${r.template.name}\` | ${r.template.author} | ${r.template.approver} | ${String(r.missing.length)} |`);
  lines.push("");
  for (const r of reports) {
    lines.push(`## ${r.template.name}`, "");
    if (r.missing.length === 0) lines.push("Nothing is NULL in the draft. Confirm the values and name the source document.");
    for (const f of r.missing) lines.push(`- \`${f.path}\` — ${f.message}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
