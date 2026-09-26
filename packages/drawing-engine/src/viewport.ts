import type { DrawingPrimitive } from "@lintel/types";
import { fmt } from "./format.js";
import { DRAWING_AREA, line, text } from "./sheet.js";

/** Standard drawing scale denominators, largest scale first (drafting convention, not product data). */
export const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 100] as const;

export interface Margins {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
export const DEFAULT_MARGINS: Margins = { left: 26, right: 26, top: 22, bottom: 22 };

export interface Viewport {
  readonly denom: number;
  readonly scale: string;
  /** View-plane (mm) → sheet (mm). */
  sx(u: number): number;
  sy(v: number): number;
}

/** Choose the largest standard scale that fits the bounds, centred in the drawing area. */
export function fitViewport(bounds: { x0: number; x1: number; y0: number; y1: number }, margins: Margins = DEFAULT_MARGINS): Viewport {
  const availW = DRAWING_AREA.x1 - DRAWING_AREA.x0 - margins.left - margins.right;
  const availH = DRAWING_AREA.y1 - DRAWING_AREA.y0 - margins.top - margins.bottom;
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  const denom: number = STANDARD_SCALES.find((d) => w / d <= availW && h / d <= availH) ?? 100;
  const s = 1 / denom;
  const left = DRAWING_AREA.x0 + margins.left + (availW - w * s) / 2;
  const top = DRAWING_AREA.y0 + margins.top + (availH - h * s) / 2;
  return { denom, scale: `1:${denom}`, sx: (u) => left + (u - bounds.x0) * s, sy: (v) => top + (bounds.y1 - v) * s };
}

const TICK = 1.2;
/** Sheet-mm span below which dimension text is placed beside the dimension line. */
const SHORT_SPAN = 8;

/** Dimension builders in view-plane units (values are read from the model, never measured). */
export function dimensioner(out: DrawingPrimitive[], vp: Viewport) {
  return {
    /** Horizontal dimension a..b at view height `vRef`, offset in sheet mm (+ = down). */
    h(a: number, b: number, vRef: number, offset: number, value: number): void {
      const y0 = vp.sy(vRef);
      const y = y0 + offset;
      const dir = Math.sign(offset);
      for (const x of [vp.sx(a), vp.sx(b)]) {
        out.push(line("DIMENSION", x, y0 + dir * 1, x, y + dir * 1.5));
        out.push(line("DIMENSION", x - TICK, y + TICK, x + TICK, y - TICK, "MEDIUM"));
      }
      out.push(line("DIMENSION", vp.sx(a), y, vp.sx(b), y));
      const span = Math.abs(vp.sx(b) - vp.sx(a));
      // Short spans: text beside the dimension instead of on top of the ticks.
      if (span < SHORT_SPAN) out.push(text("DIMENSION", Math.max(vp.sx(a), vp.sx(b)) + 2.5, y + 1, fmt(value), 2.5, { anchor: "start" }));
      else out.push(text("DIMENSION", (vp.sx(a) + vp.sx(b)) / 2, y - 1, fmt(value), 2.5, { anchor: "middle" }));
    },
    /** Vertical dimension a..b at view position `uRef`, offset in sheet mm (+ = right). */
    v(a: number, b: number, uRef: number, offset: number, value: number): void {
      const x0 = vp.sx(uRef);
      const x = x0 + offset;
      const dir = Math.sign(offset);
      for (const y of [vp.sy(a), vp.sy(b)]) {
        out.push(line("DIMENSION", x0 + dir * 1, y, x + dir * 1.5, y));
        out.push(line("DIMENSION", x - TICK, y + TICK, x + TICK, y - TICK, "MEDIUM"));
      }
      out.push(line("DIMENSION", x, vp.sy(a), x, vp.sy(b)));
      if (Math.abs(vp.sy(b) - vp.sy(a)) < SHORT_SPAN) out.push(text("DIMENSION", x + 1.5, Math.min(vp.sy(a), vp.sy(b)) - 2.5, fmt(value), 2.5, { anchor: "start" }));
      else out.push(text("DIMENSION", x - 1, (vp.sy(a) + vp.sy(b)) / 2, fmt(value), 2.5, { anchor: "middle", rotate: 90 }));
    },
  };
}
