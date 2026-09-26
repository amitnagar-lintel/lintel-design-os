import type { CabinetComponent, DrawingPrimitive, EdgeSide, ResolvedCabinet } from "@lintel/types";
import { fmt } from "./format.js";
import { DRAWING_AREA, line, text } from "./sheet.js";

const SIDE_CODE: Readonly<Record<EdgeSide, string>> = { FRONT: "F", BACK: "BK", TOP: "T", BOTTOM: "BT", LEFT: "L", RIGHT: "R" };
const SIDE_ORDER: readonly EdgeSide[] = ["FRONT", "BACK", "TOP", "BOTTOM", "LEFT", "RIGHT"];

export const SCHEDULE_COLUMNS: readonly { readonly title: string; readonly width: number; readonly numeric?: boolean }[] = [
  { title: "NO", width: 9 },
  { title: "COMPONENT ID", width: 46 },
  { title: "TYPE", width: 38 },
  { title: "W", width: 16, numeric: true },
  { title: "H", width: 16, numeric: true },
  { title: "T", width: 11, numeric: true },
  { title: "MATERIAL", width: 36 },
  { title: "GRAIN", width: 16 },
  { title: "EDGE BANDING", width: 70 },
  { title: "FINISH", width: 40 },
  { title: "QTY", width: 10, numeric: true },
  { title: "STATUS", width: 32 },
];

const ROW_H = 7;
const TOP = DRAWING_AREA.y0 + 6;
export const ROWS_PER_SHEET = Math.floor((DRAWING_AREA.y1 - TOP) / ROW_H) - 1;

export interface ScheduleRow {
  readonly cells: readonly string[];
  /** Group header row (rendered bold). */
  readonly group?: boolean;
}

function edgesText(c: CabinetComponent, edgesUndefined: boolean): string {
  if (edgesUndefined) return "UNDEFINED";
  const byBand = new Map<string, string[]>();
  for (const side of SIDE_ORDER) {
    const e = c.edges[side];
    if (e === undefined) continue;
    const list = byBand.get(e.edgeBandId) ?? [];
    list.push(SIDE_CODE[side]);
    byBand.set(e.edgeBandId, list);
  }
  if (byBand.size === 0) return "NONE";
  return [...byBand.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([band, sides]) => `${band} (${sides.join("/")})`)
    .join("; ");
}

/** Rows: generated components in model order, then components that could not be generated. */
export function scheduleRows(resolved: ResolvedCabinet): ScheduleRow[] {
  const msgs = resolved.validation.messages;
  const edgeUndefined = new Set(msgs.filter((m) => m.code === "EDGE_RULES_UNDEFINED").map((m) => m.componentId));
  const rows: ScheduleRow[] = resolved.components.map((c, i) => ({
    cells: [
      String(i + 1),
      c.componentId,
      c.componentType,
      fmt(c.dimensions.width),
      fmt(c.dimensions.height),
      fmt(c.dimensions.thickness),
      c.materialId,
      c.grainDirection,
      edgesText(c, edgeUndefined.has(c.componentId)),
      c.finishId === null ? "-" : `${c.finishId} x${c.finishedFaces}`,
      String(c.quantity),
      "GENERATED",
    ],
  }));
  const missing = [...new Set(msgs.filter((m) => m.code === "COMPONENT_NOT_GENERATED").map((m) => m.componentId ?? "?"))];
  missing.forEach((id) => rows.push({ cells: ["", id, "-", "-", "-", "-", "-", "-", "-", "-", "-", "NOT GENERATED"] }));
  return rows.map((r, i) => ({ cells: [String(i + 1), ...r.cells.slice(1)] }));
}

/** One page of the schedule table. */
export function layoutSchedulePage(rows: readonly ScheduleRow[], pageTitle: string): DrawingPrimitive[] {
  const x0 = DRAWING_AREA.x0;
  const x1 = x0 + SCHEDULE_COLUMNS.reduce((a, c) => a + c.width, 0);
  const out: DrawingPrimitive[] = [text("TABLE", x0, TOP - 3, pageTitle, 3.2, { bold: true })];
  const total = rows.length + 1;
  for (let r = 0; r <= total; r++) out.push(line("TABLE", x0, TOP + r * ROW_H, x1, TOP + r * ROW_H, r <= 1 || r === total ? "MEDIUM" : "THIN"));
  let x = x0;
  for (const col of SCHEDULE_COLUMNS) {
    out.push(line("TABLE", x, TOP, x, TOP + total * ROW_H, "THIN"));
    x += col.width;
  }
  out.push(line("TABLE", x1, TOP, x1, TOP + total * ROW_H, "THIN"));
  const cellText = (row: readonly string[], r: number, bold: boolean): void => {
    let cx = x0;
    SCHEDULE_COLUMNS.forEach((col, i) => {
      const value = row[i] ?? "";
      const y = TOP + (r + 1) * ROW_H - 2.3;
      if (col.numeric === true) out.push(text("TABLE", cx + col.width - 1.2, y, value, 2, { anchor: "end", bold }));
      else out.push(text("TABLE", cx + 1.2, y, value, 2, { bold }));
      cx += col.width;
    });
  };
  cellText(SCHEDULE_COLUMNS.map((c) => c.title), 0, true);
  rows.forEach((row, i) => {
    cellText(row.cells, i + 1, row.group === true);
  });
  return out;
}
