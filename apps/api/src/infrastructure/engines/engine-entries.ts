/**
 * The output engines and their composition entry modules (repository-relative). An entry module is the only place
 * that wires stored rows to engine calls; its static import graph is the engine's dependency closure.
 * Manufacturing has no engine yet (OD-S6-1).
 */
import { BOM_ENGINE_VERSION } from "@lintel/bom-engine";
import { BOQ_ENGINE_VERSION } from "@lintel/boq-engine";
import { ROOM_ENGINE_VERSION } from "@lintel/design-engine";
import { DRAWING_ENGINE_VERSION } from "@lintel/drawing-engine";
import { PRICING_ENGINE_VERSION, QUOTATION_ENGINE_VERSION } from "@lintel/pricing-engine";
import type { EngineName } from "@lintel/persistence";

export interface EngineEntry {
  readonly entry: string;
  readonly version: string;
}

export const ENGINE_ENTRIES: Readonly<Partial<Record<EngineName, EngineEntry>>> = {
  validation: { entry: "apps/api/src/modules/outputs/engines/validation.ts", version: ROOM_ENGINE_VERSION },
  bom: { entry: "apps/api/src/modules/outputs/engines/bom.ts", version: BOM_ENGINE_VERSION },
  boq: { entry: "apps/api/src/modules/outputs/engines/boq.ts", version: BOQ_ENGINE_VERSION },
  pricing: { entry: "apps/api/src/modules/outputs/engines/pricing.ts", version: PRICING_ENGINE_VERSION },
  quotation: { entry: "apps/api/src/modules/outputs/engines/quotation.ts", version: QUOTATION_ENGINE_VERSION },
  drawing: { entry: "apps/api/src/modules/outputs/engines/drawing.ts", version: DRAWING_ENGINE_VERSION },
};
