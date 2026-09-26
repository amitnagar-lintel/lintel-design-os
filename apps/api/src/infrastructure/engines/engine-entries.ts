/**
 * The output engines and their composition entry modules (repository-relative). An entry module is the only place
 * that wires stored rows to engine calls; its static import graph is the engine's dependency closure.
 * Snapshot engines (bom, boq, pricing, quotation, drawing) are added with their entry modules (M5 Step 7).
 */
import { ROOM_ENGINE_VERSION } from "@lintel/design-engine";
import type { EngineName } from "@lintel/persistence";

export interface EngineEntry {
  readonly entry: string;
  readonly version: string;
}

export const ENGINE_ENTRIES: Readonly<Partial<Record<EngineName, EngineEntry>>> = {
  validation: { entry: "apps/api/src/modules/outputs/engines/validation.ts", version: ROOM_ENGINE_VERSION },
};
