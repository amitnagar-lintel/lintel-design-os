import type { CatalogSnapshot, ConstructionStandard, DesignObject, DesignVersion, ManufacturerAdapter } from "@lintel/types";

export const ENGINE_VERSION = "0.1.0";

export interface ResolveCabinetInput {
  readonly designVersion: DesignVersion;
  readonly object: DesignObject;
  readonly catalog: CatalogSnapshot;
  readonly standard: ConstructionStandard;
  /** Manufacturer adapters, injected (the engine never imports a manufacturer). */
  readonly adapters: readonly ManufacturerAdapter[];
}

