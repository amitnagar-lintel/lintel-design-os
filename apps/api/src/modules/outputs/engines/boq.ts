/**
 * Entry module of the `boq` output engine: the room BOQ from the resolved room model, the pinned catalog and an exact
 * stored room BOM (consumed as-is; the BOQ engine checks it belongs to this room model and never recounts material).
 */
import { generateRoomBoq } from "@lintel/boq-engine";
import type { CatalogSnapshot, ResolvedRoom, RoomBOM, RoomBOQ } from "@lintel/types";

export { engineeringModel, resolveEngineeringModel } from "./validation.js";

export function roomBoq(resolved: ResolvedRoom, catalog: CatalogSnapshot, bom: RoomBOM): RoomBOQ {
  return generateRoomBoq(resolved, catalog, bom);
}
