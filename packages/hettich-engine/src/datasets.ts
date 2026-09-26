import type { HettichProductionDataset } from "./model.js";

/**
 * PRODUCTION Hettich dataset. Intentionally EMPTY: records must be captured from
 * official sources (Hettich eShop / CAD / Technical Assistant / downloads / Plan) with
 * every field of `HettichProductionRecord`, including source URL, source date and
 * licence — never typed or inferred from memory. Intake template:
 * docs/catalog/production-data/04-hardware-standards.md.
 * Until records exist, every hinge requirement is UNRESOLVED (BLOCKER).
 */
export const HETTICH_PRODUCTION_DATASET: HettichProductionDataset = {
  kind: "PRODUCTION",
  datasetId: "HETTICH_PRODUCTION",
  sourceVersion: "none-loaded",
  notes: "No source-verified Hettich records ingested yet.",
  records: [],
  calculationRules: [],
};
