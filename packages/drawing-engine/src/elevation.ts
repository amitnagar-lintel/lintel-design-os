import type { CabinetComponent, DrawingPrimitive } from "@lintel/types";
import { fmt } from "./format.js";
import { frontRects, projectEdges } from "./projection.js";
import { DRAWING_AREA, line, text } from "./sheet.js";

/** Standard drawing scale denominators, largest scale first (drafting convention, not product data). */
export const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 100] as const;

const MARGIN = { left: 26, right: 26, top: 22, bottom: 22 };
const TICK = 1.2;

export interface ElevationLayout {
  readonly primitives: DrawingPrimitive[];
  /** e.g. "1:5", or "N/A" when nothing could be drawn. */
  readonly scale: string;
}

/** Front elevation of the generated components. Dimensions are read from the model, never recomputed. */
export function layoutElevation(components: readonly CabinetComponent[], objectCode: string): ElevationLayout {
  const rects = frontRects(components);
  if (rects.length === 0) {
    const cx = (DRAWING_AREA.x0 + DRAWING_AREA.x1) / 2;
    return { primitives: [text("ANNOTATION", cx, 120, "NO COMPONENTS GENERATED - NOTHING TO DRAW", 5, { anchor: "middle", bold: true })], scale: "N/A" };
  }
  const bx0 = Math.min(...rects.map((r) => r.x0));
  const bx1 = Math.max(...rects.map((r) => r.x1));
  const by0 = Math.min(...rects.map((r) => r.y0));
  const by1 = Math.max(...rects.map((r) => r.y1));
  const availW = DRAWING_AREA.x1 - DRAWING_AREA.x0 - MARGIN.left - MARGIN.right;
  const availH = DRAWING_AREA.y1 - DRAWING_AREA.y0 - MARGIN.top - MARGIN.bottom;
  const denom: number = STANDARD_SCALES.find((d) => (bx1 - bx0) / d <= availW && (by1 - by0) / d <= availH) ?? 100;
  const s = 1 / denom;
  const left = DRAWING_AREA.x0 + MARGIN.left + (availW - (bx1 - bx0) * s) / 2;
  const top = DRAWING_AREA.y0 + MARGIN.top + (availH - (by1 - by0) * s) / 2;
  const sx = (x: number): number => left + (x - bx0) * s;
  const sy = (y: number): number => top + (by1 - y) * s;

  const out: DrawingPrimitive[] = [];
  for (const seg of projectEdges(rects)) {
    out.push(line(seg.hidden ? "HIDDEN" : "VISIBLE", sx(seg.x1), sy(seg.y1), sx(seg.x2), sy(seg.y2), seg.hidden ? "THIN" : "MEDIUM", seg.hidden));
  }

  // Horizontal dimension between model x-positions a..b, at model height yRef, offset in sheet mm (+ = down).
  const hDim = (a: number, b: number, yRef: number, offset: number, value: number): void => {
    const y0 = sy(yRef);
    const y = y0 + offset;
    const dir = Math.sign(offset);
    for (const x of [sx(a), sx(b)]) {
      out.push(line("DIMENSION", x, y0 + dir * 1, x, y + dir * 1.5));
      out.push(line("DIMENSION", x - TICK, y + TICK, x + TICK, y - TICK, "MEDIUM"));
    }
    out.push(line("DIMENSION", sx(a), y, sx(b), y));
    out.push(text("DIMENSION", (sx(a) + sx(b)) / 2, y - 1, fmt(value), 2.5, { anchor: "middle" }));
  };
  // Vertical dimension between model y-positions a..b, at model x xRef, offset in sheet mm (+ = right).
  const vDim = (a: number, b: number, xRef: number, offset: number, value: number): void => {
    const x0 = sx(xRef);
    const x = x0 + offset;
    const dir = Math.sign(offset);
    for (const y of [sy(a), sy(b)]) {
      out.push(line("DIMENSION", x0 + dir * 1, y, x + dir * 1.5, y));
      out.push(line("DIMENSION", x - TICK, y + TICK, x + TICK, y - TICK, "MEDIUM"));
    }
    out.push(line("DIMENSION", x, sy(a), x, sy(b)));
    out.push(text("DIMENSION", x - 1, (sy(a) + sy(b)) / 2, fmt(value), 2.5, { anchor: "middle", rotate: 90 }));
  };

  hDim(bx0, bx1, by0, 12, bx1 - bx0);
  vDim(by0, by1, bx0, -12, by1 - by0);

  const fronts = components.filter((c) => c.componentType === "SHUTTER").sort((a, b) => a.geometry.local.min.x - b.geometry.local.min.x);
  for (const f of fronts) {
    const { min } = f.geometry.local;
    hDim(min.x, min.x + f.dimensions.width, by1, -8, f.dimensions.width);
    const label = f.componentId.startsWith(`${objectCode}-`) ? f.componentId.slice(objectCode.length + 1) : f.componentId;
    const cx = sx(min.x + f.dimensions.width / 2);
    const cy = sy(min.y + f.dimensions.height / 2);
    out.push(text("ANNOTATION", cx, cy, label, 3, { anchor: "middle", bold: true }));
    out.push(text("ANNOTATION", cx, cy + 4.5, `${fmt(f.dimensions.width)} x ${fmt(f.dimensions.height)} x ${fmt(f.dimensions.thickness)}`, 2.2, { anchor: "middle" }));
  }
  const last = fronts[fronts.length - 1];
  if (last !== undefined) {
    const { min } = last.geometry.local;
    vDim(min.y, min.y + last.dimensions.height, bx1, 10, last.dimensions.height);
  }
  out.push(text("ANNOTATION", sx((bx0 + bx1) / 2), sy(by0) + 20, `FRONT ELEVATION  ${objectCode}  SCALE 1:${denom}`, 3, { anchor: "middle", bold: true }));
  return { primitives: out, scale: `1:${denom}` };
}
