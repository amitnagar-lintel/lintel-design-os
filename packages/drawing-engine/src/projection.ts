/**
 * Orthographic front projection with exact hidden-line removal for axis-aligned
 * panels. Viewer looks along −Z (front face of the carcass is at Z = D). Pure maths:
 * no rendering library (CLAUDE.md: never couple rendering to business calculations).
 */
import type { CabinetComponent } from "@lintel/types";

export interface Rect2 {
  readonly id: string;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  /** Front-most depth of the panel (larger = nearer the viewer). */
  readonly z: number;
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly hidden: boolean;
}

const EPS = 1e-6;
const r6 = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

export function frontRects(components: readonly CabinetComponent[]): Rect2[] {
  return components.map((c) => {
    const { min, size } = c.geometry.local;
    return { id: c.componentId, x0: r6(min.x), x1: r6(min.x + size.x), y0: r6(min.y), y1: r6(min.y + size.y), z: r6(min.z + size.z) };
  });
}

type Interval = readonly [number, number];

function union(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter(([a, b]) => b - a > EPS).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  let pieces: Interval[] = union(base);
  for (const [c0, c1] of union(cut)) {
    const next: Interval[] = [];
    for (const [a, b] of pieces) {
      if (c1 <= a + EPS || c0 >= b - EPS) next.push([a, b]);
      else {
        if (c0 > a + EPS) next.push([a, c0]);
        if (c1 < b - EPS) next.push([c1, b]);
      }
    }
    pieces = next;
  }
  return pieces;
}

function intersect(a: Interval, b: Interval): Interval | null {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return hi - lo > EPS ? [lo, hi] : null;
}

/**
 * Visible and hidden segments of every panel outline. An edge portion is hidden when a
 * panel nearer the viewer covers it strictly (edges lying on an occluder's boundary stay
 * visible). Coincident edges are merged; hidden never duplicates visible.
 */
export function projectEdges(rects: readonly Rect2[]): Segment[] {
  // key: "H|<y>" horizontal lines, "V|<x>" vertical lines
  const vis = new Map<string, Interval[]>();
  const hid = new Map<string, Interval[]>();
  const push = (m: Map<string, Interval[]>, k: string, iv: Interval): void => {
    const list = m.get(k);
    if (list === undefined) m.set(k, [iv]);
    else list.push(iv);
  };

  for (const r of rects) {
    const front = rects.filter((o) => o.z > r.z + EPS);
    const edges: { key: string; fixed: number; span: Interval; horizontal: boolean }[] = [
      { key: `H|${r.y0}`, fixed: r.y0, span: [r.x0, r.x1], horizontal: true },
      { key: `H|${r.y1}`, fixed: r.y1, span: [r.x0, r.x1], horizontal: true },
      { key: `V|${r.x0}`, fixed: r.x0, span: [r.y0, r.y1], horizontal: false },
      { key: `V|${r.x1}`, fixed: r.x1, span: [r.y0, r.y1], horizontal: false },
    ];
    for (const e of edges) {
      const covers: Interval[] = [];
      for (const o of front) {
        const [p0, p1] = e.horizontal ? [o.y0, o.y1] : [o.x0, o.x1];
        if (e.fixed > p0 + EPS && e.fixed < p1 - EPS) {
          const hit = intersect(e.span, e.horizontal ? [o.x0, o.x1] : [o.y0, o.y1]);
          if (hit !== null) covers.push(hit);
        }
      }
      for (const iv of subtract([e.span], covers)) push(vis, e.key, iv);
      for (const iv of union(covers)) push(hid, e.key, iv);
    }
  }

  const out: Segment[] = [];
  const keys = [...new Set([...vis.keys(), ...hid.keys()])].sort((a, b) => {
    const [ka, va] = a.split("|") as [string, string];
    const [kb, vb] = b.split("|") as [string, string];
    return ka < kb ? -1 : ka > kb ? 1 : Number(va) - Number(vb);
  });
  for (const k of keys) {
    const [dir, v] = k.split("|") as [string, string];
    const fixed = Number(v);
    const visible = union(vis.get(k) ?? []);
    const hidden = subtract(hid.get(k) ?? [], visible);
    for (const [iv, isHidden] of [...visible.map((x) => [x, false] as const), ...hidden.map((x) => [x, true] as const)]) {
      const [a, b] = iv;
      out.push(dir === "H" ? { x1: a, y1: fixed, x2: b, y2: fixed, hidden: isHidden } : { x1: fixed, y1: a, x2: fixed, y2: b, hidden: isHidden });
    }
  }
  return out;
}
