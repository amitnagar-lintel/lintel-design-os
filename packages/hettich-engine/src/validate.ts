import type { ValidationMessage } from "@lintel/types";
import type { HettichArticle, HettichCalculationRule, HettichFixtureDataset, HettichProductionRecord, SourceReference } from "./model.js";

export const FIXTURE_PREFIX = "FIXTURE-";
const OFFICIAL_HOST = /^(?:[a-z0-9-]+\.)*hettich\.com$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function blocker(code: string, message: string, path: string): ValidationMessage {
  return { code, severity: "BLOCKER", message, path };
}

/** True for an https URL on hettich.com or a subdomain (no environment URL API needed). */
export function isOfficialHettichUrl(url: string | null): boolean {
  if (url === null) return false;
  const m = /^https:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  const host = m?.[1];
  return host !== undefined && OFFICIAL_HOST.test(host);
}

function checkSource(ref: SourceReference | null, path: string, out: ValidationMessage[]): void {
  if (ref === null) {
    out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${path} is NULL / UNVERIFIED`, path));
    return;
  }
  if (!isOfficialHettichUrl(ref.url)) out.push(blocker("HETTICH_SOURCE_NOT_OFFICIAL", `${path}.url must be an https hettich.com URL (got ${String(ref.url)})`, `${path}.url`));
  if (ref.sourceDate === null || !ISO_DATE.test(ref.sourceDate)) out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${path}.sourceDate must be an ISO date (got ${String(ref.sourceDate)})`, `${path}.sourceDate`));
}

/**
 * Validate a production intake record. Any message = the record is not usable.
 * Every field listed in the production data requirements must be present and sourced.
 */
export function validateProductionRecord(r: HettichProductionRecord): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  const base = `hettich.records.${r.recordId}`;
  const need = (value: unknown, field: string): void => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${base}.${field} is NULL / UNVERIFIED`, `${base}.${field}`));
    }
  };
  need(r.articleNumber, "articleNumber");
  if (r.articleNumber?.startsWith(FIXTURE_PREFIX) === true) {
    out.push(blocker("HETTICH_FIXTURE_IN_PRODUCTION", `${base}: fixture article ${r.articleNumber} in a PRODUCTION dataset`, `${base}.articleNumber`));
  }
  need(r.productFamily, "productFamily");
  need(r.category, "category");
  need(r.description, "description");
  need(r.exactApplication.description, "exactApplication.description");
  if (r.category === "HINGE") {
    need(r.exactApplication.application, "exactApplication.application");
    need(r.exactApplication.mounting, "exactApplication.mounting");
    need(r.compatibility.doorThicknessRange, "compatibility.doorThicknessRange");
    need(r.compatibility.openingAngle, "compatibility.openingAngle");
    need(r.drilling.patternId, "drilling.patternId");
    need(r.drilling.holes, "drilling.holes");
    if (r.drilling.holes?.length === 0) out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${base}.drilling.holes is empty`, `${base}.drilling.holes`));
    checkSource(r.drilling.source, `${base}.drilling.source`, out);
    need(r.adjustment.ranges, "adjustment.ranges");
  }
  if (r.dimensions === null || Object.keys(r.dimensions).length === 0) out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${base}.dimensions is NULL / UNVERIFIED`, `${base}.dimensions`));
  need(r.compatibility.compatibleArticles, "compatibility.compatibleArticles");
  checkSource(r.installation.guide, `${base}.installation.guide`, out);
  need(r.accessories, "accessories");
  need(r.cadReference, "cadReference");
  if (r.cadReference !== null) {
    need(r.cadReference.assetId, "cadReference.assetId");
    need(r.cadReference.formats, "cadReference.formats");
    if (!isOfficialHettichUrl(r.cadReference.url)) out.push(blocker("HETTICH_SOURCE_NOT_OFFICIAL", `${base}.cadReference.url must be an https hettich.com URL`, `${base}.cadReference.url`));
  }
  checkSource(r.source, `${base}.source`, out);
  if (r.licence.status === "UNKNOWN" || r.licence.status === "RESTRICTED") {
    out.push(blocker("HETTICH_LICENCE_NOT_CLEARED", `${base}: licence status ${r.licence.status}`, `${base}.licence.status`));
  }
  need(r.verification.verifiedBy, "verification.verifiedBy");
  need(r.verification.verifiedAt, "verification.verifiedAt");
  need(r.preferenceRank, "preferenceRank");
  return out;
}

export function validateProductionRule(rule: HettichCalculationRule): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  const base = `hettich.calculationRules.${rule.ruleId}`;
  checkSource(rule.source, `${base}.source`, out);
  if (rule.verification?.verifiedBy == null || rule.verification.verifiedAt == null) {
    out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${base}.verification is NULL / UNVERIFIED`, `${base}.verification`));
  }
  if (rule.bands.length === 0) out.push(blocker("HETTICH_FIELD_UNVERIFIED", `${base}.bands is empty`, `${base}.bands`));
  return out;
}

/** Convert a validated record to the engine view. Caller must have validated it. */
export function toEngineArticle(r: HettichProductionRecord): HettichArticle {
  return {
    manufacturer: "HETTICH",
    articleNumber: r.articleNumber ?? "",
    description: r.description ?? "",
    family: r.productFamily ?? "",
    series: r.series,
    category: r.category ?? "HINGE",
    application: r.exactApplication.application,
    mounting: r.exactApplication.mounting,
    openingAngle: r.compatibility.openingAngle,
    doorThicknessRange: r.compatibility.doorThicknessRange,
    compatibleArticles: r.compatibility.compatibleArticles ?? [],
    drillingPatternId: r.drilling.patternId,
    preferenceRank: r.preferenceRank ?? Number.MAX_SAFE_INTEGER,
    sourceUrl: r.source.url,
    sourceVersion: r.source.documentVersion ?? r.source.sourceDate ?? "",
    retrievedAt: r.source.sourceDate ?? "",
    licenseStatus: r.licence.status,
  };
}

/** Fixture datasets may contain only `FIXTURE-*` articles (so they can never be mistaken for real ones). */
export function validateFixtureDataset(ds: HettichFixtureDataset): ValidationMessage[] {
  return ds.articles
    .filter((a) => !a.articleNumber.startsWith(FIXTURE_PREFIX) || a.licenseStatus !== "TEST_FIXTURE")
    .map((a) => blocker("HETTICH_FIXTURE_NOT_LABELLED", `Fixture article ${a.articleNumber} must use the ${FIXTURE_PREFIX} prefix and TEST_FIXTURE licence`, `hettich.fixture.${a.articleNumber}`));
}
