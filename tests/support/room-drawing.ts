import type { DrawingStatus, ResolvedRoom, WallId } from "@lintel/types";
import { createRoomPanelSchedule, createWallInternalElevation } from "@lintel/drawing-engine";
import type { RoomDrawingResult } from "@lintel/drawing-engine";
import { DESIGN_VERSION } from "./scenario.js";
import { METADATA } from "./drawing.js";

export function wallElevation(room: ResolvedRoom, wallId: WallId, status?: DrawingStatus): RoomDrawingResult {
  return createWallInternalElevation({ room, designVersion: DESIGN_VERSION, wallId, metadata: { ...METADATA, drawingNumber: `KIT-WE-${wallId}` }, ...(status === undefined ? {} : { requestedStatus: status }) });
}

export function roomSchedule(room: ResolvedRoom, status?: DrawingStatus): RoomDrawingResult {
  return createRoomPanelSchedule({ room, designVersion: DESIGN_VERSION, metadata: { ...METADATA, drawingNumber: "KIT-RPS-001" }, ...(status === undefined ? {} : { requestedStatus: status }) });
}

export function createdRoom(r: RoomDrawingResult) {
  if (r.status !== "CREATED") throw new Error(`expected CREATED, got REFUSED: ${r.blockers.map((b) => b.code).join(", ")}`);
  return r.drawing;
}
