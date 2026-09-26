/**
 * Entry module of the `drawing` output engine: the existing M3/M4 drawing engine (room and cabinet drawings) on the
 * execution context's resolved room, and its file renderers (one SVG per sheet, one PDF). Cabinet drawings take the
 * cabinet from the same `resolved.cabinets` (one resolution for both scopes). Mapping only: every layout, guard,
 * title block and seal is the engine's.
 */
import {
  createCabinetInternalElevation, createFrontElevation, createPanelSchedule, createRoomPanelSchedule, createSideSection, createWallInternalElevation, renderPdf, renderSvg,
} from "@lintel/drawing-engine";
import type { DrawingMetadataInput } from "@lintel/drawing-engine";
import type { DesignVersion, Drawing, DrawingStatus, ResolvedRoom, RoomDrawing, ValidationMessage, WallId } from "@lintel/types";

export { engineeringModel, resolveEngineeringModel } from "./validation.js";

export type DrawingRequest =
  | { readonly drawingType: "WALL_INTERNAL_ELEVATION"; readonly wallId: WallId }
  | { readonly drawingType: "ROOM_PANEL_SCHEDULE" }
  | { readonly drawingType: "FRONT_ELEVATION" | "CABINET_INTERNAL_ELEVATION" | "PANEL_SCHEDULE"; readonly objectLineageId: string }
  | { readonly drawingType: "SIDE_SECTION"; readonly objectLineageId: string; readonly cutXMm: number | null };

export type DrawingOutput =
  | { readonly status: "CREATED"; readonly drawing: Drawing | RoomDrawing }
  | { readonly status: "REFUSED"; readonly blockers: readonly ValidationMessage[] }
  | { readonly status: "OBJECT_NOT_FOUND" };

export function drawOutput(input: {
  readonly resolved: ResolvedRoom;
  readonly designVersion: DesignVersion;
  readonly request: DrawingRequest;
  readonly metadata: DrawingMetadataInput;
  readonly status: DrawingStatus;
}): DrawingOutput {
  const { resolved, designVersion, request, metadata, status } = input;
  const room = { room: resolved, designVersion, metadata, requestedStatus: status };
  switch (request.drawingType) {
    case "WALL_INTERNAL_ELEVATION":
      return createWallInternalElevation({ ...room, wallId: request.wallId });
    case "ROOM_PANEL_SCHEDULE":
      return createRoomPanelSchedule(room);
    case "FRONT_ELEVATION":
    case "CABINET_INTERNAL_ELEVATION":
    case "PANEL_SCHEDULE":
    case "SIDE_SECTION": {
      const cabinet = resolved.cabinets.find((c) => c.object.objectId === request.objectLineageId);
      if (cabinet === undefined) return { status: "OBJECT_NOT_FOUND" };
      const base = { resolved: cabinet, designVersion, metadata, requestedStatus: status };
      switch (request.drawingType) {
        case "FRONT_ELEVATION": return createFrontElevation(base);
        case "CABINET_INTERNAL_ELEVATION": return createCabinetInternalElevation(base);
        case "PANEL_SCHEDULE": return createPanelSchedule(base);
        case "SIDE_SECTION": return createSideSection(request.cutXMm === null ? base : { ...base, cutX: request.cutXMm });
      }
    }
  }
}

/** One rendered file: a format of the output file registry, its sheet (sheet-scoped formats) and its exact bytes. */
export interface RenderedFile {
  readonly format: "PDF" | "SVG";
  readonly sheetIndex: number | null;
  readonly bytes: Uint8Array;
}

/** Every file of a drawing: one PDF of all sheets (latin1 bytes) and one SVG per sheet (UTF-8). */
export function renderDrawingFiles(drawing: Drawing | RoomDrawing): RenderedFile[] {
  return [
    { format: "PDF", sheetIndex: null, bytes: new Uint8Array(Buffer.from(renderPdf([drawing]), "latin1")) },
    ...drawing.sheets.map((_, i): RenderedFile => ({ format: "SVG", sheetIndex: i, bytes: new Uint8Array(Buffer.from(renderSvg(drawing, i), "utf8")) })),
  ];
}
