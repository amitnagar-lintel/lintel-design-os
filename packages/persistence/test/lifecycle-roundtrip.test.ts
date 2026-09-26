/**
 * The exact lifecycle is never lost: a row in any lifecycle state, read into its domain
 * representation and written back, is identical — IN_REVIEW stays IN_REVIEW, LOCKED stays
 * LOCKED, SUPERSEDED stays SUPERSEDED. The engine calculation status is a separate, derived view.
 */
import { describe, expect, it } from "vitest";
import {
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  LINTEL_PLANNING_STANDARD_DRAFT,
} from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET } from "@lintel/hettich-engine";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_RATE_CARD } from "@lintel/pricing-engine";
import type { RecordLifecycleStatus, VersionEnvelope, Versioned, VersionMeta, VersionRow } from "../src/index.js";
import {
  constructionStandardFromRows,
  constructionStandardToRows,
  contentHash,
  designVersionFromRow,
  designVersionToRow,
  edgeBandFromRow,
  edgeBandStandardFromRows,
  edgeBandStandardToRows,
  edgeBandToRow,
  engineCalculationStatus,
  envelopeProblems,
  finishFromRow,
  finishToRow,
  hardwareRuleSetFromRows,
  hardwareRuleSetToRows,
  hettichDatasetFromRows,
  hettichDatasetToRows,
  materialFromRow,
  materialToRow,
  metaOf,
  planningStandardFromRows,
  planningStandardToRows,
  pricingStandardFromRows,
  pricingStandardToRows,
  productFromRow,
  productToRow,
  quotationPolicyFromRows,
  quotationPolicyToRows,
  RECORD_LIFECYCLE_STATUSES,
  recipeFromRow,
  recipeToRow,
} from "../src/index.js";

const CTX = { orgId: "org_lintel" };
const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-27T10:00:00.000Z";
const T2 = "2026-09-28T10:00:00.000Z";
const T3 = "2026-09-29T10:00:00.000Z";

const draftMeta: VersionMeta = {
  entityId: "ent_1",
  versionId: "ver_1",
  versionNumber: 1,
  status: "DRAFT",
  sourceRef: null,
  changeReason: "Initial version",
  createdBy: "user_author",
  createdAt: T0,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  effectiveFrom: null,
  lockedBy: null,
  lockedAt: null,
  supersededBy: null,
  supersededAt: null,
};

/** Column values a record carries in each lifecycle state (as the database would hold them). */
function lifecycleColumns(status: RecordLifecycleStatus): Partial<VersionRow> {
  const submitted = { submitted_by: "user_author", submitted_at: T1 };
  const approved = { ...submitted, approved_by: "user_head", approved_at: T2, effective_from: T2 };
  switch (status) {
    case "DRAFT":
      return { status };
    case "IN_REVIEW":
      return { status, ...submitted };
    case "APPROVED":
      return { status, ...approved };
    case "LOCKED":
      return { status, ...approved, locked_by: "user_head", locked_at: T3 };
    case "SUPERSEDED":
      return { status, ...approved, locked_by: "user_head", locked_at: T3, superseded_by: "ver_2", superseded_at: T3 };
  }
}

/** A domain under test, generics closed over so every domain runs through the same assertions. */
interface Case {
  readonly name: string;
  readonly run: (status: RecordLifecycleStatus) => { readonly original: unknown; readonly envelope: VersionEnvelope; readonly rewritten: unknown };
}

function makeCase<R, V>(name: string, draftRows: R, withStatus: (rows: R, cols: Partial<VersionRow>) => R, read: (rows: R) => Versioned<V>, write: (rows: R, value: V, meta: VersionMeta) => R): Case {
  return {
    name,
    run: (status) => {
      const original = withStatus(draftRows, lifecycleColumns(status));
      const v = read(original);
      return { original, envelope: v.envelope, rewritten: write(original, v.value, metaOf(v.envelope)) };
    },
  };
}

const onVersion = <R extends { readonly version: VersionRow }>(rows: R, cols: Partial<VersionRow>): R => ({ ...rows, version: { ...rows.version, ...cols } });
const onRow = <R extends VersionRow>(row: R, cols: Partial<VersionRow>): R => ({ ...row, ...cols });

const material = LINTEL_CATALOG.materials[0];
const edgeBand = LINTEL_CATALOG.edgeBands[0];
const finish = LINTEL_CATALOG.finishes[0];
const product = LINTEL_CATALOG.products[0];
const recipe = LINTEL_CATALOG.recipes[0];
const hardware = LINTEL_CATALOG.hardwareRuleSets[0];
if (material === undefined || edgeBand === undefined || finish === undefined || product === undefined || recipe === undefined || hardware === undefined) throw new Error("catalog data missing");

// Each case: rows (in a lifecycle state) → domain (Versioned) → rows, using only what the reader returned.
const cases: readonly Case[] = [
  makeCase("ConstructionStandard", constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, draftMeta, CTX), onVersion, constructionStandardFromRows, (_r, v, m) => constructionStandardToRows(v, m, CTX)),
  makeCase("PlanningStandard", planningStandardToRows(LINTEL_PLANNING_STANDARD_DRAFT, draftMeta, CTX), onVersion, planningStandardFromRows, (_r, v, m) => planningStandardToRows(v, m, CTX)),
  makeCase("EdgeBandStandard", edgeBandStandardToRows(LINTEL_EDGE_BAND_STANDARD_DRAFT, draftMeta, CTX), onVersion, edgeBandStandardFromRows, (_r, v, m) => edgeBandStandardToRows(v, m, CTX)),
  makeCase(
    "PricingStandard",
    pricingStandardToRows("LINTEL_PRICING_STANDARD", { rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES }, draftMeta, CTX),
    onVersion,
    pricingStandardFromRows,
    (r, v, m) => pricingStandardToRows(r.version.entity_code, v, m, CTX),
  ),
  makeCase("QuotationPolicy", quotationPolicyToRows(LINTEL_PRODUCTION_QUOTATION_POLICY, draftMeta, CTX), onVersion, quotationPolicyFromRows, (_r, v, m) => quotationPolicyToRows(v, m, CTX)),
  makeCase("Material", materialToRow(material, draftMeta, CTX), onRow, materialFromRow, (_r, v, m) => materialToRow(v, m, CTX)),
  makeCase("EdgeBand", edgeBandToRow(edgeBand, draftMeta, CTX), onRow, edgeBandFromRow, (_r, v, m) => edgeBandToRow(v, m, CTX)),
  makeCase("Finish", finishToRow(finish, draftMeta, CTX), onRow, finishFromRow, (_r, v, m) => finishToRow(v, m, CTX)),
  makeCase("Product", productToRow(product, draftMeta, { ...CTX, recipeVersionId: "rcv_1" }, "Lintel catalog"), onRow, productFromRow, (r, v, m) => productToRow(v, m, { ...CTX, recipeVersionId: r.recipe_version_id }, r.source)),
  makeCase("Recipe", recipeToRow(recipe, draftMeta, CTX, "Lintel catalog"), onRow, recipeFromRow, (r, v, m) => recipeToRow(v, m, CTX, r.source)),
  makeCase("HardwareRuleSet", hardwareRuleSetToRows(hardware, draftMeta, CTX, "Lintel catalog"), onVersion, hardwareRuleSetFromRows, (r, v, m) => hardwareRuleSetToRows(v, m, CTX, r.version.source)),
  makeCase("Hettich dataset", hettichDatasetToRows(HETTICH_PRODUCTION_DATASET, draftMeta, CTX, "Hettich intake"), onVersion, hettichDatasetFromRows, (r, v, m) => hettichDatasetToRows(v, m, CTX, r.version.source)),
];

describe.each(RECORD_LIFECYCLE_STATUSES.map((s) => [s]))("lifecycle %s", (status) => {
  it.each(cases.map((c) => [c.name, c] as const))("%s: rows → domain → rows is identical and keeps the exact status", (_name, c) => {
    const r = c.run(status);
    expect(r.envelope.status).toBe(status);
    expect(envelopeProblems(r.envelope)).toEqual([]);
    expect(r.rewritten).toEqual(r.original);
  });
});

describe("the engine calculation status is a separate, derived view", () => {
  it("each lifecycle maps to a calculation status, while the envelope keeps the lifecycle", () => {
    const rows = constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, draftMeta, CTX);
    const expected: Record<RecordLifecycleStatus, string> = { DRAFT: "DRAFT", IN_REVIEW: "DRAFT", APPROVED: "APPROVED", LOCKED: "APPROVED", SUPERSEDED: "RETIRED" };
    for (const status of RECORD_LIFECYCLE_STATUSES) {
      const v = constructionStandardFromRows(onVersion(rows, lifecycleColumns(status)));
      expect(v.envelope.status).toBe(status);
      expect(v.value.status).toBe(expected[status]);
      expect(engineCalculationStatus(status)).toBe(expected[status]);
    }
  });
  it("writing back uses the envelope's exact lifecycle, never the collapsed calculation status", () => {
    const v = constructionStandardFromRows(onVersion(constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, draftMeta, CTX), lifecycleColumns("LOCKED")));
    expect(v.value.status).toBe("APPROVED");
    expect(constructionStandardToRows(v.value, metaOf(v.envelope), CTX).version.status).toBe("LOCKED");
  });
});

describe("design versions keep their exact lifecycle", () => {
  const pins = {
    constructionStandardVersionId: "csv_1",
    planningStandardVersionId: "psv_1",
    edgeBandStandardVersionId: "ebv_1",
    materialCatalogVersionId: "mcr_1",
    finishCatalogVersionId: "fcr_1",
    hardwareCatalogVersionId: "hcr_1",
    hettichDatasetVersionId: "hdv_1",
    applianceCatalogVersionId: null,
    productCatalogVersionId: "pcr_1",
  };
  it.each(RECORD_LIFECYCLE_STATUSES.map((s) => [s]))("%s", (status) => {
    const cols = lifecycleColumns(status);
    const envelope: VersionEnvelope = {
      ...draftMeta,
      status,
      submittedBy: cols.submitted_by ?? null,
      submittedAt: cols.submitted_at ?? null,
      approvedBy: cols.approved_by ?? null,
      approvedAt: cols.approved_at ?? null,
      effectiveFrom: cols.effective_from ?? null,
      lockedBy: cols.locked_by ?? null,
      lockedAt: cols.locked_at ?? null,
      supersededBy: cols.superseded_by ?? null,
      supersededAt: cols.superseded_at ?? null,
      versionLabel: null,
      source: "design",
      dataClassification: "PRODUCTION",
      contentHash: contentHash("design content"),
    };
    const record = { envelope, projectId: "project_001", basedOnVersionId: null, roomRevisionId: "rr_1", pins, authoredEngineVersion: "0.1.0", inputHash: contentHash("inputs"), inputRevision: 1 };
    const row = designVersionToRow(record, CTX);
    expect(row.status).toBe(status);
    expect(designVersionFromRow(row)).toEqual(record);
    expect(designVersionToRow(designVersionFromRow(row), CTX)).toEqual(row);
  });
});
