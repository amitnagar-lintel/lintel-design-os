import type { Drawing, DrawingLayer, DrawingPrimitive } from "@lintel/types";
import { coord } from "./format.js";

/** Render order (watermark first, behind everything). */
export const LAYER_ORDER: readonly DrawingLayer[] = ["WATERMARK", "BORDER", "HIDDEN", "VISIBLE", "DIMENSION", "ANNOTATION", "TABLE", "TITLE_BLOCK"];

export const STROKE_MM: Readonly<Record<"THIN" | "MEDIUM" | "THICK", number>> = { THIN: 0.18, MEDIUM: 0.35, THICK: 0.5 };
export const DASH_MM: readonly [number, number] = [3, 1.5];
/** Primitive text size is cap height; font size ≈ cap height / 0.7 for Helvetica-like fonts. */
export const CAP_TO_FONT = 1 / 0.7;

const LAYER_COLOUR: Readonly<Record<DrawingLayer, string>> = {
  WATERMARK: "#d9534f",
  BORDER: "#000000",
  HIDDEN: "#555555",
  VISIBLE: "#000000",
  DIMENSION: "#1f4e9c",
  ANNOTATION: "#000000",
  TABLE: "#000000",
  TITLE_BLOCK: "#000000",
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function primitiveSvg(p: DrawingPrimitive): string {
  if (p.kind === "line") {
    const dash = p.dashed ? ` stroke-dasharray="${coord(DASH_MM[0])} ${coord(DASH_MM[1])}"` : "";
    return `<line x1="${coord(p.x1)}" y1="${coord(p.y1)}" x2="${coord(p.x2)}" y2="${coord(p.y2)}" stroke-width="${coord(STROKE_MM[p.weight])}"${dash}/>`;
  }
  const rot = p.rotate === 0 ? "" : ` transform="rotate(${coord(-p.rotate)} ${coord(p.x)} ${coord(p.y)})"`;
  const weight = p.bold ? ` font-weight="bold"` : "";
  return `<text x="${coord(p.x)}" y="${coord(p.y)}" font-size="${coord(p.size * CAP_TO_FONT)}" text-anchor="${p.anchor}"${weight}${rot}>${esc(p.text)}</text>`;
}

/**
 * Deterministic SVG for one sheet (millimetre viewBox). Traceability metadata is carried as
 * data attributes so a file on disk can be checked for staleness against the live model.
 */
export function renderSvg(drawing: Drawing, sheetIndex = 0): string {
  const sheet = drawing.sheets[sheetIndex];
  if (sheet === undefined) throw new RangeError(`Drawing ${drawing.drawingId} has no sheet ${sheetIndex}`);
  const { width, height } = sheet.paper;
  const attrs = [
    `data-drawing-id="${esc(drawing.drawingId)}"`,
    `data-drawing-type="${drawing.type}"`,
    `data-status="${drawing.status}"`,
    `data-design-version="${esc(drawing.trace.designVersionId)}"`,
    `data-model-fingerprint="${drawing.modelFingerprint}"`,
    `data-classification="${drawing.trace.dataClassification}"`,
    `data-content-hash="${drawing.contentHash}"`,
    `data-sheet="${sheet.sheetNumber}/${drawing.sheets.length}"`,
  ].join(" ");
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" ${attrs}>`,
    `<title>${esc(`${drawing.titleBlock.drawingNumber} ${drawing.titleBlock.drawingTitle} (${drawing.status})`)}</title>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
  ];
  for (const layer of LAYER_ORDER) {
    const prims = sheet.primitives.filter((p) => p.layer === layer);
    if (prims.length === 0) continue;
    const colour = LAYER_COLOUR[layer];
    const style = layer === "WATERMARK" ? ` fill="${colour}" stroke="${colour}" opacity="0.25"` : ` fill="${colour}" stroke="${colour}"`;
    lines.push(`<g id="${layer}"${style} font-family="Helvetica, Arial, sans-serif" stroke-linecap="round">`);
    for (const p of prims) lines.push(p.kind === "text" ? primitiveSvg(p).replace("<text ", `<text stroke="none" `) : primitiveSvg(p).replace("<line ", `<line fill="none" `));
    lines.push(`</g>`);
  }
  lines.push(`</svg>`, "");
  return lines.join("\n");
}
