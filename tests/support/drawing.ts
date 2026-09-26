import type { DesignVersion, Drawing, DrawingStatus, ResolvedCabinet } from "@lintel/types";
import { createFrontElevation, createPanelSchedule } from "@lintel/drawing-engine";
import type { DrawingMetadataInput, DrawingResult } from "@lintel/drawing-engine";
import { DESIGN_VERSION } from "./scenario.js";

export const METADATA: DrawingMetadataInput = {
  projectCode: "LSA-BLR-2026-0001",
  room: "Kitchen",
  drawingNumber: "KIT-EL-001",
  revision: "A",
  date: "2026-09-26",
  designer: "TEST DESIGNER",
  checker: "UNASSIGNED",
};

export function elevation(resolved: ResolvedCabinet, opts: { status?: DrawingStatus; designVersion?: DesignVersion } = {}): DrawingResult {
  return createFrontElevation({ resolved, designVersion: opts.designVersion ?? DESIGN_VERSION, metadata: METADATA, ...(opts.status === undefined ? {} : { requestedStatus: opts.status }) });
}

export function schedule(resolved: ResolvedCabinet, opts: { status?: DrawingStatus; designVersion?: DesignVersion } = {}): DrawingResult {
  return createPanelSchedule({ resolved, designVersion: opts.designVersion ?? DESIGN_VERSION, metadata: { ...METADATA, drawingNumber: "KIT-PS-001" }, ...(opts.status === undefined ? {} : { requestedStatus: opts.status }) });
}

export function created(r: DrawingResult): Drawing {
  if (r.status !== "CREATED") throw new Error(`expected CREATED, got REFUSED: ${r.blockers.map((b) => b.code).join(", ")}`);
  return r.drawing;
}
