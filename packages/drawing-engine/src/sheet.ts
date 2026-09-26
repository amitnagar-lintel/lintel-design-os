import type { DrawingLayer, DrawingPrimitive, TitleBlock } from "@lintel/types";
import { ascii } from "./format.js";

/** ISO A3 landscape, millimetres. */
export const A3 = { name: "A3" as const, width: 420, height: 297 };
export const FRAME = { x0: 10, y0: 10, x1: 410, y1: 287 };
export const TITLE_BLOCK = { x0: 230, y0: 232, x1: 410, y1: 287 };
/** Region available to the drawing content (clear of frame, title block and notes). */
export const DRAWING_AREA = { x0: 20, y0: 24, x1: 400, y1: 224 };

export function line(layer: DrawingLayer, x1: number, y1: number, x2: number, y2: number, weight: "THIN" | "MEDIUM" | "THICK" = "THIN", dashed = false): DrawingPrimitive {
  return { kind: "line", layer, x1, y1, x2, y2, dashed, weight };
}

export function text(layer: DrawingLayer, x: number, y: number, value: string, size: number, opts: { anchor?: "start" | "middle" | "end"; bold?: boolean; rotate?: number } = {}): DrawingPrimitive {
  return { kind: "text", layer, x, y, text: ascii(value), size, anchor: opts.anchor ?? "start", bold: opts.bold ?? false, rotate: opts.rotate ?? 0 };
}

export function rect(layer: DrawingLayer, x0: number, y0: number, x1: number, y1: number, weight: "THIN" | "MEDIUM" | "THICK" = "THIN"): DrawingPrimitive[] {
  return [line(layer, x0, y0, x1, y0, weight), line(layer, x1, y0, x1, y1, weight), line(layer, x1, y1, x0, y1, weight), line(layer, x0, y1, x0, y0, weight)];
}

export function frame(sheetLabel: string): DrawingPrimitive[] {
  return [
    ...rect("BORDER", FRAME.x0, FRAME.y0, FRAME.x1, FRAME.y1, "THICK"),
    text("BORDER", FRAME.x0 + 3, FRAME.y0 + 5, "LINTEL DESIGN OS", 3, { bold: true }),
    text("BORDER", FRAME.x1 - 3, FRAME.y0 + 5, sheetLabel, 2.5, { anchor: "end" }),
  ];
}

/** PRD §34 title block (plus model fingerprint and data classification). */
export function titleBlock(tb: TitleBlock, sheet: string): DrawingPrimitive[] {
  const rows: [string, string][] = [
    ["PROJECT", `${tb.projectCode} (${tb.projectId})`],
    ["ROOM", tb.room],
    ["DRAWING TITLE", tb.drawingTitle],
    ["DRAWING NO. / SHEET", `${tb.drawingNumber}   ${sheet}`],
    ["REVISION / DATE", `${tb.revision}   ${tb.date}`],
    ["DESIGNER / CHECKER", `${tb.designer} / ${tb.checker}`],
    ["SCALE", tb.scale],
    ["APPROVAL STATUS", tb.approvalStatus],
    ["SOURCE DESIGN VERSION", `${tb.sourceDesignVersionId} (${tb.sourceDesignVersionStatus})`],
    ["MODEL FINGERPRINT", tb.modelFingerprint],
    ["DATA CLASSIFICATION", tb.dataClassification],
  ];
  const { x0, y0, x1, y1 } = TITLE_BLOCK;
  const h = (y1 - y0) / rows.length;
  const split = x0 + 42;
  const out: DrawingPrimitive[] = [...rect("TITLE_BLOCK", x0, y0, x1, y1, "MEDIUM"), line("TITLE_BLOCK", split, y0, split, y1)];
  rows.forEach(([label, value], i) => {
    const top = y0 + i * h;
    if (i > 0) out.push(line("TITLE_BLOCK", x0, top, x1, top));
    out.push(text("TITLE_BLOCK", x0 + 1.5, top + h - 1.5, label, 1.6));
    out.push(text("TITLE_BLOCK", split + 1.5, top + h - 1.4, value, 2.2, { bold: label === "APPROVAL STATUS" || label === "DRAWING TITLE" }));
  });
  return out;
}

/** Large diagonal watermark plus a banner, used whenever the drawing may not drive production. */
export function watermark(message: string): DrawingPrimitive[] {
  const cx = (DRAWING_AREA.x0 + DRAWING_AREA.x1) / 2;
  const cy = (DRAWING_AREA.y0 + DRAWING_AREA.y1) / 2;
  // Size to fit ~300 mm of diagonal regardless of message length (≈0.62 em per character).
  const size = Math.min(11, Math.round(((300 * 0.7) / (0.62 * message.length)) * 10) / 10);
  return [
    text("WATERMARK", cx, cy, message, size, { anchor: "middle", bold: true, rotate: 20 }),
    text("WATERMARK", (FRAME.x0 + FRAME.x1) / 2, FRAME.y0 + 5, message, 3, { anchor: "middle", bold: true }),
  ];
}

const NOTE_WRAP = 100;
const NOTE_LINES = 11;

function wrap(value: string, width: number): string[] {
  const words = value.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length > 0 && cur.length + 1 + w.length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur.length === 0 ? w : `${cur} ${w}`;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Numbered notes left of the title block, wrapped; overflow is stated, never silently dropped. */
export function notes(items: readonly string[]): DrawingPrimitive[] {
  const lines: string[] = [];
  items.forEach((n, i) => {
    wrap(`${i + 1}. ${n}`, NOTE_WRAP).forEach((l, j) => {
      lines.push(j === 0 ? l : `   ${l}`);
    });
  });
  const shown = lines.length > NOTE_LINES ? [...lines.slice(0, NOTE_LINES - 1), "... further notes truncated: see the validation report for this DesignVersion"] : lines;
  const out: DrawingPrimitive[] = [text("ANNOTATION", FRAME.x0 + 4, TITLE_BLOCK.y0 + 4, "NOTES", 2.5, { bold: true })];
  shown.forEach((l, i) => out.push(text("ANNOTATION", FRAME.x0 + 4, TITLE_BLOCK.y0 + 8.5 + i * 4.2, l, 2)));
  return out;
}
