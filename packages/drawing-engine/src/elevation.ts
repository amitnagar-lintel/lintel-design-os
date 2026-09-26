import type { CabinetComponent, DrawingPrimitive } from "@lintel/types";
import { fmt } from "./format.js";
import { projectEdges } from "./projection.js";
import { DRAWING_AREA, line, text } from "./sheet.js";
import { FRONT_VIEW, projectBox } from "./views.js";
import { dimensioner, fitViewport } from "./viewport.js";

export { STANDARD_SCALES } from "./viewport.js";

export interface ElevationLayout {
  readonly primitives: DrawingPrimitive[];
  /** e.g. "1:5", or "N/A" when nothing could be drawn. */
  readonly scale: string;
}

export interface ElevationOptions {
  /** Title under the view. */
  readonly caption: string;
  /** Component types left out of the view (e.g. fronts for a cabinet internal elevation). */
  readonly exclude?: readonly string[];
  /** Label components of these types at their centre (short id + size). */
  readonly labelTypes?: readonly string[];
  /** Dimension the width chain and height of these component types. */
  readonly chainTypes?: readonly string[];
}

const shortId = (id: string, objectCode: string): string => (id.startsWith(`${objectCode}-`) ? id.slice(objectCode.length + 1) : id);

/**
 * Front view of a cabinet's components, shared by the Front Elevation and the Cabinet
 * Internal Elevation (fronts removed). Dimensions are read from the model, never recomputed.
 */
export function layoutFrontView(all: readonly CabinetComponent[], objectCode: string, opts: ElevationOptions): ElevationLayout {
  const components = all.filter((c) => !(opts.exclude ?? []).includes(c.componentType));
  const rects = components.map((c) => projectBox(c.componentId, c.geometry.local, FRONT_VIEW));
  if (rects.length === 0) {
    const cx = (DRAWING_AREA.x0 + DRAWING_AREA.x1) / 2;
    return { primitives: [text("ANNOTATION", cx, 120, "NO COMPONENTS GENERATED - NOTHING TO DRAW", 5, { anchor: "middle", bold: true })], scale: "N/A" };
  }
  const b = { x0: Math.min(...rects.map((r) => r.x0)), x1: Math.max(...rects.map((r) => r.x1)), y0: Math.min(...rects.map((r) => r.y0)), y1: Math.max(...rects.map((r) => r.y1)) };
  const vp = fitViewport(b);
  const out: DrawingPrimitive[] = [];
  for (const seg of projectEdges(rects)) {
    out.push(line(seg.hidden ? "HIDDEN" : "VISIBLE", vp.sx(seg.x1), vp.sy(seg.y1), vp.sx(seg.x2), vp.sy(seg.y2), seg.hidden ? "THIN" : "MEDIUM", seg.hidden));
  }
  const dim = dimensioner(out, vp);
  dim.h(b.x0, b.x1, b.y0, 12, b.x1 - b.x0);
  dim.v(b.y0, b.y1, b.x0, -12, b.y1 - b.y0);

  const chainTypes = opts.chainTypes ?? [];
  const labelTypes = opts.labelTypes ?? [];
  const chain = components.filter((c) => chainTypes.includes(c.componentType)).sort((p, q) => p.geometry.local.min.x - q.geometry.local.min.x);
  const annotated = components
    .filter((c) => chainTypes.includes(c.componentType) || labelTypes.includes(c.componentType))
    .sort((p, q) => p.geometry.local.min.x - q.geometry.local.min.x || p.geometry.local.min.y - q.geometry.local.min.y);
  // Deterministic label de-collision: move a label down until it clears earlier ones.
  const placed: { x: number; y: number }[] = [];
  const clear = (x: number, y: number): number => {
    let yy = y;
    while (placed.some((p) => Math.abs(p.x - x) < 24 && Math.abs(p.y - yy) < 9)) yy += 9;
    placed.push({ x, y: yy });
    return yy;
  };
  for (const f of annotated) {
    const { min } = f.geometry.local;
    if (chainTypes.includes(f.componentType)) dim.h(min.x, min.x + f.dimensions.width, b.y1, -8, f.dimensions.width);
    if (labelTypes.includes(f.componentType)) {
      const cx = vp.sx(min.x + f.geometry.local.size.x / 2);
      const cy = clear(cx, vp.sy(min.y + f.geometry.local.size.y / 2));
      out.push(text("ANNOTATION", cx, cy, shortId(f.componentId, objectCode), 3, { anchor: "middle", bold: true }));
      out.push(text("ANNOTATION", cx, cy + 4.5, `${fmt(f.dimensions.width)} x ${fmt(f.dimensions.height)} x ${fmt(f.dimensions.thickness)}`, 2.2, { anchor: "middle" }));
    }
  }
  const last = chain[chain.length - 1];
  if (last !== undefined) dim.v(last.geometry.local.min.y, last.geometry.local.min.y + last.dimensions.height, b.x1, 10, last.dimensions.height);
  out.push(text("ANNOTATION", vp.sx((b.x0 + b.x1) / 2), vp.sy(b.y0) + 20, `${opts.caption}  ${objectCode}  SCALE ${vp.scale}`, 3, { anchor: "middle", bold: true }));
  return { primitives: out, scale: vp.scale };
}

/** PRD §33 Front Elevation (M3 behaviour). */
export function layoutElevation(components: readonly CabinetComponent[], objectCode: string): ElevationLayout {
  return layoutFrontView(components, objectCode, { caption: "FRONT ELEVATION", labelTypes: ["SHUTTER"], chainTypes: ["SHUTTER"] });
}
