import type { BOM, BOQ, ConstructionStandard, EdgeBandStandard, DesignObject, DesignVersion, ManufacturerAdapter, ParameterValue, ResolvedCabinet } from "@lintel/types";
import {
  KIT_BASE_STANDARD,
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  TEST_FIXTURE_CONSTRUCTION_STANDARD,
  TEST_FIXTURE_EDGE_BAND_STANDARD,
} from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET, createHettichAdapter } from "@lintel/hettich-engine";
import { resolveCabinet } from "@lintel/design-engine";
import { generateBom } from "@lintel/bom-engine";
import { generateBoq } from "@lintel/boq-engine";

/** PRD §10–12 reference records. */
export const DESIGN_VERSION: DesignVersion = {
  designVersionId: "dv_001",
  designId: "design_001",
  projectId: "project_001",
  versionNumber: 1,
  status: "DRAFT",
};

/** PRD §12 example object = PRD §42 reference cabinet (600 × 720 × 560). */
export function referenceObject(over: { dimensions?: Partial<DesignObject["dimensions"]>; parameters?: Record<string, ParameterValue> } = {}): DesignObject {
  return {
    objectId: "obj_001",
    objectCode: "OBJ-KIT-001",
    projectId: "project_001",
    roomId: "room_001",
    objectType: "BASE_CABINET",
    productId: "KIT_BASE_STANDARD",
    transform: { x: 1200, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
    dimensions: { width: 600, height: 720, depth: 560, ...over.dimensions },
    parameters: {
      carcassThickness: 18,
      backThickness: 6,
      shelfCount: 1,
      shutterCount: 2,
      frontType: "OVERLAY",
      material: "BOARD_BWP_18",
      finish: "LAMINATE_WHITE",
      ...over.parameters,
    },
    status: "DRAFT",
  };
}

export interface SliceResult {
  readonly resolved: ResolvedCabinet;
  readonly bom: BOM;
  readonly boq: BOQ;
}

export function runSlice(
  object: DesignObject,
  standard: ConstructionStandard,
  edgeBandStandard: EdgeBandStandard,
  adapters: readonly ManufacturerAdapter[],
  designVersion: DesignVersion = DESIGN_VERSION,
): SliceResult {
  const resolved = resolveCabinet({ designVersion, object, catalog: LINTEL_CATALOG, standard, edgeBandStandard, adapters });
  const bom = generateBom(resolved);
  const boq = generateBoq(resolved, KIT_BASE_STANDARD, bom);
  return { resolved, bom, boq };
}

/** Production configuration: Lintel DRAFT construction + edge band standards + (empty) PRODUCTION Hettich dataset. */
export const productionSlice = (object: DesignObject = referenceObject()): SliceResult =>
  runSlice(object, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);

/** Mechanics configuration: TEST_FIXTURE construction + edge band standards + TEST_FIXTURE Hettich data. */
export const fixtureSlice = (object: DesignObject = referenceObject()): SliceResult =>
  runSlice(object, TEST_FIXTURE_CONSTRUCTION_STANDARD, TEST_FIXTURE_EDGE_BAND_STANDARD, [createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET)]);
