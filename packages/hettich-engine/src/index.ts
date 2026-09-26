export type { HettichArticle, HettichCalculationRule, HettichDataset, HettichDrillingPattern, QuantityBand } from "./model.js";
export { HETTICH_OFFICIAL_DATASET } from "./datasets.js";
export { HETTICH_TEST_FIXTURE_DATASET } from "./fixtures/test-dataset.js";
export { HETTICH, calculateQuantity, createHettichAdapter, findCompatibleArticles, fittingScope, resolveWithDataset } from "./adapter.js";
export type { CompatibilityResult } from "./adapter.js";
