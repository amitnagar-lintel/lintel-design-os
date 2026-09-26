/**
 * Minimal, dependency-free PDF 1.4 writer for drawing sheets: vector lines and standard
 * Helvetica text. Output is ASCII and fully deterministic (no clock, fixed metadata).
 */
import type { Drawing, DrawingLayer, DrawingPrimitive, RoomDrawing } from "@lintel/types";
import { coord } from "./format.js";
import { CAP_TO_FONT, DASH_MM, LAYER_ORDER, STROKE_MM } from "./svg.js";
import { DRAWING_ENGINE_VERSION } from "./version.js";

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number): string => coord(mm * PT_PER_MM);

const LAYER_RGB: Readonly<Record<DrawingLayer, string>> = {
  WATERMARK: "0.95 0.75 0.74",
  BORDER: "0 0 0",
  HIDDEN: "0.333 0.333 0.333",
  VISIBLE: "0 0 0",
  DIMENSION: "0.122 0.306 0.612",
  ANNOTATION: "0 0 0",
  TABLE: "0 0 0",
  TITLE_BLOCK: "0 0 0",
};

/**
 * Approximate Helvetica advance widths (1/1000 em) by character class, used only to
 * position centred / right-aligned text. Presentation only.
 */
function textWidthEm(s: string, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 278;
    else if (/[0-9]/.test(ch)) w += 556;
    else if (/[A-Z]/.test(ch)) w += ch === "I" ? 278 : ch === "M" || ch === "W" ? 833 : 667;
    else if (/[a-z]/.test(ch)) w += ch === "i" || ch === "l" || ch === "j" ? 222 : ch === "m" || ch === "w" ? 833 : 500;
    else if (".,:;!|'".includes(ch)) w += 278;
    else w += 333;
  }
  return (w * (bold ? 1.06 : 1)) / 1000;
}

const pdfString = (s: string): string => `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

function content(primitives: readonly DrawingPrimitive[], pageHeightMm: number): string {
  const ops: string[] = ["1 J 1 j"];
  for (const layer of LAYER_ORDER) {
    const rgb = LAYER_RGB[layer];
    for (const p of primitives.filter((x) => x.layer === layer)) {
      if (p.kind === "line") {
        ops.push(`${rgb} RG ${pt(STROKE_MM[p.weight])} w ${p.dashed ? `[${pt(DASH_MM[0])} ${pt(DASH_MM[1])}] 0 d` : "[] 0 d"} ${pt(p.x1)} ${pt(pageHeightMm - p.y1)} m ${pt(p.x2)} ${pt(pageHeightMm - p.y2)} l S`);
      } else {
        const fontMm = p.size * CAP_TO_FONT;
        const widthMm = textWidthEm(p.text, p.bold) * fontMm;
        const shift = p.anchor === "middle" ? widthMm / 2 : p.anchor === "end" ? widthMm : 0;
        const rad = (p.rotate * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        // Shift the start point back along the (rotated) baseline for anchoring.
        const x = p.x - shift * cos;
        const y = pageHeightMm - p.y - shift * sin;
        ops.push(`${rgb} rg BT /${p.bold ? "F2" : "F1"} ${pt(fontMm)} Tf ${coord(cos)} ${coord(sin)} ${coord(-sin)} ${coord(cos)} ${pt(x)} ${pt(y)} Tm ${pdfString(p.text)} Tj ET`);
      }
    }
  }
  return ops.join("\n");
}

/** Render one or more drawings (all sheets) into a single PDF. Returns the file as an ASCII string. */
export function renderPdf(drawings: readonly (Drawing | RoomDrawing)[]): string {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(""); // placeholder, filled later
  const pagesId = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const d of drawings) {
    for (const sheet of d.sheets) {
      const stream = content(sheet.primitives, sheet.paper.height);
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      pageIds.push(
        add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pt(sheet.paper.width)} ${pt(sheet.paper.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`),
      );
    }
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const first = drawings[0];
  const title = first === undefined ? "Lintel drawings" : drawings.map((d) => d.titleBlock.drawingNumber).join(", ");
  const info = add(`<< /Title ${pdfString(title)} /Producer ${pdfString(`Lintel Design OS drawing-engine ${DRAWING_ENGINE_VERSION}`)} /Subject ${pdfString(drawings.map((d) => `${d.drawingId} fp=${d.modelFingerprint} hash=${d.contentHash}`).join(" | "))} >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
