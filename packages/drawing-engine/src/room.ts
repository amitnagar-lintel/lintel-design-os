import type { DesignVersion, DrawingPrimitive, DrawingSheet, DrawingStatus, ResolvedRoom, RoomDrawing, RoomDrawingStaleness, RoomDrawingType, TitleBlock, ValidationMessage, WallId } from "@lintel/types";
import { deepFreeze, hash53, stableStringify } from "@lintel/types";
import { assertProductionEligible, compareRoomTrace, ProductionGuardError } from "@lintel/design-engine";
import type { DrawingMetadataInput } from "./drawing.js";
import { fmt } from "./format.js";
import { projectEdges } from "./projection.js";
import type { Rect2 } from "./projection.js";
import { layoutSchedulePage, ROWS_PER_SHEET, scheduleRows } from "./schedule.js";
import type { ScheduleRow } from "./schedule.js";
import { A3, frame, line, notes, text, titleBlock, watermark } from "./sheet.js";
import { projectBox, WALL_VIEWS } from "./views.js";
import { dimensioner, fitViewport } from "./viewport.js";

export interface CreateRoomDrawingInput {
  readonly room: ResolvedRoom;
  readonly designVersion: DesignVersion;
  readonly metadata: DrawingMetadataInput;
  readonly requestedStatus?: DrawingStatus;
}

export type RoomDrawingResult = { readonly status: "CREATED"; readonly drawing: RoomDrawing } | { readonly status: "REFUSED"; readonly blockers: readonly ValidationMessage[] };

/** Room drawings carry more notes; use the full width left of the title block. */
const ROOM_NOTE_WRAP = 125;

const refuse = (code: string, message: string): ValidationMessage => ({ code, severity: "BLOCKER", message });
const EPS = 1e-6;

/** Same conditions as object drawings, applied to the whole room. */
function guard(input: CreateRoomDrawingInput, status: DrawingStatus): ValidationMessage[] {
  const { room, designVersion } = input;
  const out: ValidationMessage[] = [];
  if (designVersion.designVersionId !== room.trace.designVersionId) out.push(refuse("DRAWING_TRACE_MISMATCH", `Room model belongs to ${room.trace.designVersionId}, not ${designVersion.designVersionId}`));
  if (status !== "FOR_PRODUCTION") return out;
  try {
    assertProductionEligible(designVersion, room.validation);
  } catch (e) {
    if (!(e instanceof ProductionGuardError)) throw e;
    out.push(refuse("DRAWING_PRODUCTION_GUARD", e.message));
  }
  if (room.trace.designVersionStatus !== "APPROVED" && room.trace.designVersionStatus !== "LOCKED") out.push(refuse("DRAWING_MODEL_NOT_FROM_APPROVED_VERSION", `Room was resolved while the design version was ${room.trace.designVersionStatus}`));
  if (room.trace.dataClassification !== "PRODUCTION") out.push(refuse("DRAWING_TEST_FIXTURE_DATA", `Room uses TEST_FIXTURE data (${room.trace.testFixtureSources.join("; ")})`));
  return out;
}

function watermarkFor(room: ResolvedRoom): string | null {
  if (room.trace.dataClassification === "TEST_FIXTURE") return "TEST FIXTURE DATA - NOT FOR PRODUCTION";
  if (!room.validation.canApprove) return `BLOCKED DATA - NOT FOR PRODUCTION (${room.validation.counts.BLOCKER} BLOCKERS)`;
  return null;
}

const codeOf = (room: ResolvedRoom, id: string): string => room.placements.find((p) => p.objectId === id)?.objectCode ?? id;

function roomNotes(room: ResolvedRoom, wallId: WallId | null): string[] {
  const n: string[] = ["All dimensions in millimetres. Dimensions are read from the resolved room model, not measured from this drawing."];
  if (wallId !== null) {
    n.push(`View from inside the room facing wall ${wallId}; visible edges only. Objects on other walls are shown on their own wall elevations.`);
    for (const r of room.runs.filter((x) => x.wallId === wallId)) n.push(`${r.runId}: ${r.objectIds.map((id) => codeOf(room, id)).join(", ")} (length ${fmt(r.length)}).`);
    const adj = room.relationships.filter((r) => r.type === "ADJACENT" && r.wallIds.includes(wallId));
    if (adj.length > 0) n.push(`Adjacency: ${adj.map((r) => `${r.objectIds.map((id) => codeOf(room, id)).join("/")} ${r.touching === true ? "touching" : `gap ${fmt(r.gap ?? 0)}`}${r.source === "OVERRIDE" ? ` (override ${r.overrideIds.join(",")})` : ""}`).join("; ")}.`);
    const corners = room.relationships.filter((r) => r.type === "CORNER" && r.wallIds.includes(wallId));
    for (const c of corners) n.push(`Corner ${c.wallIds.join("/")}: ${c.objectIds.map((id) => codeOf(room, id)).join(" + ")}, gap ${fmt(c.gap ?? 0)}.`);
  } else {
    n.push("Edge codes: F front, BK back, T top, BT bottom, L left, R right. Rows grouped by object.");
  }
  n.push(`Derived from design version ${room.trace.designVersionId}; planning standard ${room.trace.planningStandard.id} v${room.trace.planningStandard.version} (${room.trace.planningStandard.status}); ${room.trace.objects.length} object(s).`);
  if (room.trace.dataClassification === "TEST_FIXTURE") n.push(`TEST FIXTURE data in use: ${room.trace.testFixtureSources.join("; ")}. Values are synthetic.`);
  if (!room.validation.canApprove) n.push(`${room.validation.counts.BLOCKER} validation BLOCKER(s) outstanding: this drawing must not be used for production.`);
  return n;
}

/** Wall Internal Elevation: every object on the wall, wall outline, dimension chain, relationships. */
export function layoutWallElevation(room: ResolvedRoom, wallId: WallId): { primitives: DrawingPrimitive[]; scale: string; objectIds: string[] } {
  const wall = room.room.walls.find((w) => w.wallId === wallId);
  if (wall === undefined) throw new RangeError(`Room ${room.room.id} has no wall ${wallId}`);
  const view = WALL_VIEWS[wallId];
  // Shift so that the horizontal coordinate equals the along-wall distance from the wall's left end.
  const shift = wallId === "C" ? room.room.length : wallId === "D" ? room.room.width : 0;
  const onWall = room.placements.filter((p) => p.wallId === wallId).sort((a, b) => a.alongWall.start - b.alongWall.start);
  const rects: Rect2[] = onWall.flatMap((p) => p.components.map((c) => {
    const r = projectBox(c.componentId, c.box, view);
    return { ...r, x0: r.x0 + shift, x1: r.x1 + shift };
  }));
  const bounds = { x0: 0, x1: wall.length, y0: 0, y1: wall.height };
  const vp = fitViewport(bounds, { left: 36, right: 26, top: 22, bottom: 30 });
  const out: DrawingPrimitive[] = [];
  // Wall outline: floor, ceiling and the two corners.
  out.push(line("VISIBLE", vp.sx(0), vp.sy(0), vp.sx(wall.length), vp.sy(0), "THICK"), line("VISIBLE", vp.sx(0), vp.sy(wall.height), vp.sx(wall.length), vp.sy(wall.height), "THICK"));
  out.push(line("VISIBLE", vp.sx(0), vp.sy(0), vp.sx(0), vp.sy(wall.height), "THICK"), line("VISIBLE", vp.sx(wall.length), vp.sy(0), vp.sx(wall.length), vp.sy(wall.height), "THICK"));
  for (const seg of projectEdges(rects)) if (!seg.hidden) out.push(line("VISIBLE", vp.sx(seg.x1), vp.sy(seg.y1), vp.sx(seg.x2), vp.sy(seg.y2), "MEDIUM"));

  const dim = dimensioner(out, vp);
  // Chain along the floor: corner gap, objects and gaps between them, corner gap.
  let cursor = 0;
  for (const p of onWall) {
    if (p.alongWall.start - cursor > EPS) dim.h(cursor, p.alongWall.start, 0, 10, p.alongWall.start - cursor);
    dim.h(p.alongWall.start, p.alongWall.end, 0, 10, p.alongWall.end - p.alongWall.start);
    cursor = Math.max(cursor, p.alongWall.end);
  }
  if (onWall.length > 0 && wall.length - cursor > EPS) dim.h(cursor, wall.length, 0, 10, wall.length - cursor);
  dim.h(0, wall.length, 0, 20, wall.length);
  dim.v(0, wall.height, 0, -12, wall.height);
  const top = Math.max(0, ...onWall.map((p) => p.envelope.min.y + p.envelope.size.y));
  if (onWall.length > 0) dim.v(0, top, 0, -24, top);

  for (const p of onWall) {
    const cx = vp.sx((p.alongWall.start + p.alongWall.end) / 2);
    const cy = vp.sy(p.envelope.min.y + p.envelope.size.y / 2);
    out.push(text("ANNOTATION", cx, cy, p.objectCode, 2.6, { anchor: "middle", bold: true }));
    out.push(text("ANNOTATION", cx, cy + 3.8, `${fmt(p.alongWall.end - p.alongWall.start)} x ${fmt(p.envelope.size.y)}`, 2, { anchor: "middle" }));
  }
  for (const c of room.relationships.filter((r) => r.type === "CORNER" && r.wallIds.includes(wallId))) {
    const atLeft = c.wallIds[1] === wallId; // this wall's left end meets the other wall's right end
    const other = c.wallIds[atLeft ? 0 : 1] ?? "?";
    const x = vp.sx(atLeft ? 0 : wall.length);
    out.push(text("ANNOTATION", x + (atLeft ? 2 : -2), vp.sy(wall.height) + 5, `CORNER ${wallId}/${other}: ${c.objectIds.map((id) => codeOf(room, id)).join(" + ")} (gap ${fmt(c.gap ?? 0)})`, 2, { anchor: atLeft ? "start" : "end" }));
  }
  if (onWall.length === 0) out.push(text("ANNOTATION", vp.sx(wall.length / 2), vp.sy(wall.height / 2), "NO OBJECTS ON THIS WALL", 4, { anchor: "middle", bold: true }));
  out.push(text("ANNOTATION", vp.sx(wall.length / 2), vp.sy(0) + 28, `WALL ${wallId} INTERNAL ELEVATION  ${room.room.name.toUpperCase()}  SCALE ${vp.scale}`, 3, { anchor: "middle", bold: true }));
  return { primitives: out, scale: vp.scale, objectIds: onWall.map((p) => p.objectId) };
}

/** Room Panel Schedule rows: a header row per object, then its components (numbering continues). */
export function roomScheduleRows(room: ResolvedRoom): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let n = 0;
  for (const c of room.cabinets) {
    const p = room.placements.find((x) => x.objectId === c.object.objectId);
    const d = c.object.dimensions;
    rows.push({ cells: ["", c.object.objectCode, c.trace.product.id, fmt(d.width), fmt(d.height), fmt(d.depth), "", "", p === undefined ? "NOT PLACED" : `WALL ${p.wallId} @ ${fmt(p.alongWall.start)}`, "", "", "OBJECT"], group: true });
    for (const r of scheduleRows(c)) {
      n += 1;
      rows.push({ cells: [String(n), ...r.cells.slice(1)] });
    }
  }
  return rows;
}

function build(type: RoomDrawingType, input: CreateRoomDrawingInput, wallId: WallId | null): RoomDrawingResult {
  const status = input.requestedStatus ?? "PRELIMINARY";
  const blockers = guard(input, status);
  if (blockers.length > 0) return { status: "REFUSED", blockers };
  const { room, metadata } = input;
  const mark = watermarkFor(room);
  let pages: DrawingPrimitive[][];
  let scale: string;
  let objectIds: string[];
  let title: string;
  if (type === "WALL_INTERNAL_ELEVATION" && wallId !== null) {
    const layout = layoutWallElevation(room, wallId);
    pages = [layout.primitives];
    scale = layout.scale;
    objectIds = layout.objectIds;
    title = `WALL ${wallId} INTERNAL ELEVATION - ${room.room.name.toUpperCase()}`;
  } else {
    const rows = roomScheduleRows(room);
    pages = [];
    for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_SHEET) pages.push(layoutSchedulePage(rows.slice(i, i + ROWS_PER_SHEET), `ROOM PANEL SCHEDULE  ${room.room.name.toUpperCase()}`));
    scale = "NTS";
    objectIds = room.cabinets.map((c) => c.object.objectId);
    title = `ROOM PANEL SCHEDULE - ${room.room.name.toUpperCase()}`;
  }
  const tb: TitleBlock = {
    projectId: room.trace.projectId,
    projectCode: metadata.projectCode,
    room: metadata.room,
    drawingNumber: metadata.drawingNumber,
    drawingTitle: title,
    revision: metadata.revision,
    date: metadata.date,
    designer: metadata.designer,
    checker: metadata.checker,
    scale,
    approvalStatus: status,
    sourceDesignVersionId: room.trace.designVersionId,
    sourceDesignVersionStatus: room.trace.designVersionStatus,
    modelFingerprint: room.roomFingerprint,
    dataClassification: room.trace.dataClassification,
  };
  const noteLines = roomNotes(room, wallId);
  const sheets: DrawingSheet[] = pages.map((content, i) => {
    const label = `SHEET ${i + 1} OF ${pages.length}`;
    return { sheetNumber: i + 1, paper: A3, primitives: [...(mark === null ? [] : watermark(mark)), ...frame(label), ...content, ...notes(noteLines, ROOM_NOTE_WRAP), ...titleBlock(tb, label)] };
  });
  const body: Omit<RoomDrawing, "contentHash"> = {
    drawingId: `DRW:${room.trace.designVersionId}:${room.room.id}:${type}${wallId === null ? "" : `:${wallId}`}:${metadata.drawingNumber}:R${metadata.revision}`,
    type,
    wallId,
    titleBlock: tb,
    status,
    watermark: mark,
    trace: JSON.parse(JSON.stringify(room.trace)) as RoomDrawing["trace"],
    modelFingerprint: room.roomFingerprint,
    objectIds,
    notes: noteLines,
    sheets,
  };
  return { status: "CREATED", drawing: deepFreeze({ ...body, contentHash: hash53(stableStringify(body)) }) };
}

/** Primary room drawing: one wall with every object on it. Pure. */
export function createWallInternalElevation(input: CreateRoomDrawingInput & { readonly wallId: WallId }): RoomDrawingResult {
  return build("WALL_INTERNAL_ELEVATION", input, input.wallId);
}

/** Room Panel Schedule: every panel of every object, grouped by object. Pure. */
export function createRoomPanelSchedule(input: CreateRoomDrawingInput): RoomDrawingResult {
  return build("ROOM_PANEL_SCHEDULE", input, null);
}

export function verifyRoomDrawing(drawing: RoomDrawing): boolean {
  const { contentHash, ...body } = drawing;
  return hash53(stableStringify(body)) === contentHash;
}

/** Stale when the room changed; reports which objects changed (shared with quotations). */
export function checkRoomDrawingStaleness(drawing: RoomDrawing, current: ResolvedRoom): RoomDrawingStaleness {
  return compareRoomTrace(drawing.trace, drawing.modelFingerprint, current);
}

