import type { HardwareCategory } from "@lintel/types";
import type { HettichCalculationRule, HettichProductionDataset, HettichProductionRecord } from "@lintel/hettich-engine";
import { MappingError } from "../errors.js";
import { assertNoTestFixture } from "../fixture-guard.js";
import type { MapContext, VersionMeta, VersionRow } from "./common.js";
import { omit, readEnvelope, versionRow } from "./common.js";

/*
 * Hettich manufacturer data (catalog domain, behind the ManufacturerAdapter). The dataset
 * version is the release unit; its article and rule rows are insert-only. Only PRODUCTION
 * intake datasets are ever persisted — the TEST_FIXTURE dataset stays in code.
 */

export interface HettichDatasetVersionRow extends VersionRow {
  readonly notes: string;
}

/** Mirrors `HettichProductionRecord`: key fields as columns, structured groups as jsonb. Nulls stay null (unverified). */
export interface HettichArticleRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly record_code: string;
  readonly article_number: string | null;
  readonly product_family: string | null;
  readonly series: string | null;
  readonly category: HardwareCategory | null;
  readonly description: string | null;
  readonly exact_application: HettichProductionRecord["exactApplication"];
  readonly dimensions: HettichProductionRecord["dimensions"];
  readonly compatibility: HettichProductionRecord["compatibility"];
  readonly drilling: HettichProductionRecord["drilling"];
  readonly installation: HettichProductionRecord["installation"];
  readonly adjustment: HettichProductionRecord["adjustment"];
  readonly accessories: HettichProductionRecord["accessories"];
  readonly cad_reference: HettichProductionRecord["cadReference"];
  readonly source_ref: HettichProductionRecord["source"];
  readonly licence_status: HettichProductionRecord["licence"]["status"];
  readonly licence_usage_notes: string | null;
  readonly verified_by: string | null;
  readonly verified_at: string | null;
  readonly preference_rank: number | null;
}

export interface HettichCalculationRuleRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly rule_code: string;
  readonly family: string;
  readonly category: HardwareCategory;
  readonly description: string;
  readonly bands: HettichCalculationRule["bands"];
  readonly source_ref: HettichCalculationRule["source"];
  readonly verification: HettichCalculationRule["verification"];
  readonly source_version: string;
}

export interface HettichDatasetRows {
  readonly version: HettichDatasetVersionRow;
  readonly articles: readonly HettichArticleRow[];
  readonly calculationRules: readonly HettichCalculationRuleRow[];
}

/** `source` of the dataset version (the envelope); every record also keeps its own source reference. */
export function hettichDatasetToRows(d: HettichProductionDataset, meta: VersionMeta, ctx: MapContext, source: string): HettichDatasetRows {
  assertNoTestFixture(`Hettich dataset ${d.datasetId}`, d);
  const base = { org_id: ctx.orgId, version_id: meta.versionId };
  const articles: HettichArticleRow[] = d.records.map((r) => ({
    ...base,
    record_code: r.recordId,
    article_number: r.articleNumber,
    product_family: r.productFamily,
    series: r.series,
    category: r.category,
    description: r.description,
    exact_application: r.exactApplication,
    dimensions: r.dimensions,
    compatibility: r.compatibility,
    drilling: r.drilling,
    installation: r.installation,
    adjustment: r.adjustment,
    accessories: r.accessories,
    cad_reference: r.cadReference,
    source_ref: r.source,
    licence_status: r.licence.status,
    licence_usage_notes: r.licence.usageNotes,
    verified_by: r.verification.verifiedBy,
    verified_at: r.verification.verifiedAt,
    preference_rank: r.preferenceRank,
  }));
  const calculationRules: HettichCalculationRuleRow[] = d.calculationRules.map((c) => ({
    ...base,
    rule_code: c.ruleId,
    family: c.family,
    category: c.category,
    description: c.description,
    bands: c.bands,
    source_ref: c.source,
    verification: c.verification,
    source_version: c.sourceVersion,
  }));
  const content = omit(d, "kind");
  return { version: { ...versionRow(ctx, d.datasetId, meta, source, d.sourceVersion, content), notes: d.notes }, articles, calculationRules };
}

export function hettichDatasetFromRows(rows: HettichDatasetRows): HettichProductionDataset {
  const e = readEnvelope(rows.version);
  const check = (id: string, versionId: string): void => {
    if (versionId !== e.versionId) throw new MappingError(`Hettich row ${id} belongs to version ${versionId}, not ${e.versionId}`);
  };
  const records: HettichProductionRecord[] = rows.articles.map((a) => {
    check(a.record_code, a.version_id);
    return {
      recordId: a.record_code,
      articleNumber: a.article_number,
      productFamily: a.product_family,
      series: a.series,
      category: a.category,
      description: a.description,
      exactApplication: a.exact_application,
      dimensions: a.dimensions,
      compatibility: a.compatibility,
      drilling: a.drilling,
      installation: a.installation,
      adjustment: a.adjustment,
      accessories: a.accessories,
      cadReference: a.cad_reference,
      source: a.source_ref,
      licence: { status: a.licence_status, usageNotes: a.licence_usage_notes },
      verification: { verifiedBy: a.verified_by, verifiedAt: a.verified_at },
      preferenceRank: a.preference_rank,
    };
  });
  const calculationRules: HettichCalculationRule[] = rows.calculationRules.map((c) => {
    check(c.rule_code, c.version_id);
    return { ruleId: c.rule_code, family: c.family, category: c.category, description: c.description, bands: c.bands, source: c.source_ref, verification: c.verification, sourceVersion: c.source_version };
  });
  if (rows.version.version_label === null) throw new MappingError(`Hettich dataset ${rows.version.entity_code}: source version label is required`);
  return { kind: "PRODUCTION", datasetId: rows.version.entity_code, sourceVersion: rows.version.version_label, notes: rows.version.notes, records, calculationRules };
}
