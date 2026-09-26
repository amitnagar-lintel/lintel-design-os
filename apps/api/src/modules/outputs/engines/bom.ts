/**
 * Entry module of the `bom` output engine: the room BOM from the resolved room model. The room is resolved by the
 * validation entry (re-exported so it is part of this engine's fingerprint closure) — once per execution context.
 */
import { generateRoomBom } from "@lintel/bom-engine";
import type { ResolvedRoom, RoomBOM } from "@lintel/types";

export { engineeringModel, resolveEngineeringModel } from "./validation.js";

export function roomBom(resolved: ResolvedRoom): RoomBOM {
  return generateRoomBom(resolved);
}
