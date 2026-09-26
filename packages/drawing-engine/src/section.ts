import type { CabinetComponent, DrawingPrimitive } from "@lintel/types";
import { fmt } from "./format.js";
import { projectEdges } from "./projection.js";
import type { Rect2 } from "./projection.js";
import { DRAWING_AREA, line, text } from "./sheet.js";
import { projectBox, SECTION_VIEW_FROM_LEFT } from "./views.js";
import { dimensioner, fitViewport } from "./viewport.js";

const HATCH_SPACING = 1.5;
const EPS = 1e-6;

/** 45° hatch lines clipped to an axis-aligned sheet rectangle (pure geometry). */
export function hatch(x0: number, y0: number, x1: number, y1: number, spacing = HATCH_SPACING): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  // Lines x − y = k. For each k, clip to the rectangle.
  const kMin = x0 - y1;
  const kMax = x1 - y0;
  const start = Math.ceil(kMin / spacing) * spacing;
  for (let k = start; k <= kMax + EPS; k += spacing) {
    const ax = Math.max(x0, y0 + k);
    const bx = Math.min(x1, y1 + k);
    if (bx - ax > EPS) out.push([ax, ax - k, bx, bx - k]);
  }
  return out;
}

export interface SectionLayout {
  readonly primitives: DrawingPrimitive[];
  readonly scale: string;
  /** Cut position along the cabinet width (cabinet-local X, mm). */
  readonly cutX: number;
  readonly cutComponentIds: readonly string[];
}

/** Default cut: through the centre of the leftmost front if any, otherwise mid-width. */
export function defaultCutX(components: readonly CabinetComponent[]): number {
  const fronts = components.filter((c) => c.componentType === "SHUTTER").sort((a, b) => a.geometry.local.min.x - b.geometry.local.min.x);
  const f = fronts[0];
  if (f !== undefined) return f.geometry.local.min.x + f.geometry.local.size.x / 2;
  const xs = components.flatMap((c) => [c.geometry.local.min.x, c.geometry.local.min.x + c.geometry.local.size.x]);
  return xs.length === 0 ? 0 : (Math.min(...xs) + Math.max(...xs)) / 2;
}

const shortId = (id: string, objectCode: string): string => (id.startsWith(`${objectCode}-`) ? id.slice(objectCode.length + 1) : id);

/**
 * PRD §33 Side Section: vertical cut at `cutX`, viewed from the left (back on the left, front on
 * the right). Components crossing the plane are drawn cut (heavy outline + hatch); components
 * beyond are projected with hidden-line removal (hidden edges omitted, as usual in sections).
 */
export function layoutSideSection(components: readonly CabinetComponent[], objectCode: string, cutX?: number): SectionLayout {
  const cut = cutX ?? defaultCutX(components);
  const crossing = components.filter((c) => c.geometry.local.min.x < cut - EPS && c.geometry.local.min.x + c.geometry.local.size.x > cut + EPS);
  const beyond = components.filter((c) => c.geometry.local.min.x >= cut - EPS);
  if (crossing.length + beyond.length === 0) {
    const cx = (DRAWING_AREA.x0 + DRAWING_AREA.x1) / 2;
    return { primitives: [text("ANNOTATION", cx, 120, "NOTHING AT OR BEYOND THE SECTION PLANE", 5, { anchor: "middle", bold: true })], scale: "N/A", cutX: cut, cutComponentIds: [] };
  }
  const cutRects: Rect2[] = crossing.map((c) => ({ ...projectBox(c.componentId, c.geometry.local, SECTION_VIEW_FROM_LEFT), z: -cut }));
  const beyondRects: Rect2[] = beyond.map((c) => projectBox(c.componentId, c.geometry.local, SECTION_VIEW_FROM_LEFT));
  const all = [...cutRects, ...beyondRects];
  const b = { x0: Math.min(...all.map((r) => r.x0)), x1: Math.max(...all.map((r) => r.x1)), y0: Math.min(...all.map((r) => r.y0)), y1: Math.max(...all.map((r) => r.y1)) };
  const vp = fitViewport(b);
  const out: DrawingPrimitive[] = [];

  for (const seg of projectEdges(all)) {
    if (!seg.hidden) out.push(line("VISIBLE", vp.sx(seg.x1), vp.sy(seg.y1), vp.sx(seg.x2), vp.sy(seg.y2), "MEDIUM"));
  }
  for (const r of cutRects) {
    const [x0, x1, y0, y1] = [vp.sx(r.x0), vp.sx(r.x1), vp.sy(r.y1), vp.sy(r.y0)];
    out.push(line("VISIBLE", x0, y0, x1, y0, "THICK"), line("VISIBLE", x1, y0, x1, y1, "THICK"), line("VISIBLE", x1, y1, x0, y1, "THICK"), line("VISIBLE", x0, y1, x0, y0, "THICK"));
    for (const [ax, ay, bx, by] of hatch(x0, y0, x1, y1)) out.push(line("HIDDEN", ax, ay, bx, by, "THIN"));
  }

  // Dimensions (view u = cabinet Z: back → front).
  const dim = dimensioner(out, vp);
  dim.v(b.y0, b.y1, b.x0, -12, b.y1 - b.y0);
  const carcass = components.filter((c) => c.componentType !== "SHUTTER" && c.componentType !== "DRAWER_FRONT");
  const cz0 = Math.min(...carcass.map((c) => c.geometry.local.min.z));
  const cz1 = Math.max(...carcass.map((c) => c.geometry.local.min.z + c.geometry.local.size.z));
  if (carcass.length > 0) dim.h(cz0, cz1, b.y0, 10, cz1 - cz0);
  if (Math.abs(b.x0 - cz0) > EPS || Math.abs(b.x1 - cz1) > EPS) dim.h(b.x0, b.x1, b.y0, 18, b.x1 - b.x0); // overall depth incl. fronts
  const front = [...crossing, ...beyond].filter((c) => c.componentType === "SHUTTER").sort((a, c) => a.geometry.local.min.x - c.geometry.local.min.x)[0];
  if (front !== undefined && carcass.length > 0) {
    const fz0 = front.geometry.local.min.z;
    const fz1 = fz0 + front.geometry.local.size.z;
    if (fz0 - cz1 > EPS) dim.h(cz1, fz0, b.y1, -16, fz0 - cz1); // shutter back gap
    dim.h(fz0, fz1, b.y1, -8, fz1 - fz0); // front thickness
  }
  for (const c of crossing) {
    const r = projectBox(c.componentId, c.geometry.local, SECTION_VIEW_FROM_LEFT);
    const w = (r.x1 - r.x0) / vp.denom;
    const h = (r.y1 - r.y0) / vp.denom;
    if (w >= 14 && h >= 3.5) out.push(text("ANNOTATION", vp.sx((r.x0 + r.x1) / 2), vp.sy((r.y0 + r.y1) / 2) + 1, shortId(c.componentId, objectCode), 2.2, { anchor: "middle", bold: true }));
  }
  out.push(text("ANNOTATION", vp.sx((b.x0 + b.x1) / 2), vp.sy(b.y0) + 26, `SIDE SECTION A-A  ${objectCode}  CUT AT X = ${fmt(cut)}  SCALE ${vp.scale}`, 3, { anchor: "middle", bold: true }));
  out.push(text("ANNOTATION", vp.sx(b.x0), vp.sy(b.y1) - 22, "BACK", 2.2, { anchor: "start" }), text("ANNOTATION", vp.sx(b.x1), vp.sy(b.y1) - 22, "FRONT", 2.2, { anchor: "end" }));
  return { primitives: out, scale: vp.scale, cutX: cut, cutComponentIds: crossing.map((c) => c.componentId) };
}
