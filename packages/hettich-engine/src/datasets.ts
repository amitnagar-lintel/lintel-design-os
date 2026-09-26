import type { HettichDataset } from "./model.js";

/**
 * Slot for official/authorised Hettich data. Intentionally EMPTY in M1: article,
 * drilling and calculation data must be ingested from official sources (Hettich
 * eShop / CAD / Technical Assistant) with source + licence metadata — never typed
 * from memory. Until then every hinge requirement resolves as UNRESOLVED (BLOCKER).
 */
export const HETTICH_OFFICIAL_DATASET: HettichDataset = {
  datasetId: "HETTICH_OFFICIAL",
  sourceVersion: "none-loaded",
  authoritative: true,
  retrievedAt: null,
  notes: "No official Hettich data ingested yet.",
  articles: [],
  calculationRules: [],
  drillingPatterns: [],
};
