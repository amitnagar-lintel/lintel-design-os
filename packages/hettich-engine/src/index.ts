export type {
  DrillHole,
  HettichArticle,
  HettichCalculationRule,
  HettichDataset,
  HettichDrillingPattern,
  HettichFixtureDataset,
  HettichLicenceStatus,
  HettichProductionDataset,
  HettichProductionRecord,
  Measured,
  QuantityBand,
  SourceReference,
} from "./model.js";
export { HETTICH_PRODUCTION_DATASET } from "./datasets.js";
export { HETTICH_TEST_FIXTURE_DATASET } from "./fixtures/test-dataset.js";
export { HETTICH, calculateQuantity, createHettichAdapter, findCompatibleArticles, fittingScope, resolveWithData, usableData } from "./adapter.js";
export type { CompatibilityResult, UsableHettichData } from "./adapter.js";
export { FIXTURE_PREFIX, isOfficialHettichUrl, toEngineArticle, validateFixtureDataset, validateProductionRecord, validateProductionRule } from "./validate.js";
