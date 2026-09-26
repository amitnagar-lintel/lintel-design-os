/**
 * Pure geometry metadata for parametric panels. No rendering, no Three.js
 * (CLAUDE.md: never couple Three.js to business calculations). Visualisation
 * layers consume these boxes; they never compute them.
 *
 * Cabinet-local axes: X = width (left→right), Y = height (up), Z = depth
 * (back→front). Origin = rear-left-bottom corner of the carcass.
 */
import type { Box3, EdgeSide, GrainDirection, PanelPlane, Transform, Vector3 } from "@lintel/types";

interface PlaneAxes {
  readonly width: "x" | "y" | "z";
  readonly height: "x" | "y" | "z";
  readonly thickness: "x" | "y" | "z";
}

export const PLANE_AXES: Readonly<Record<PanelPlane, PlaneAxes>> = {
  YZ: { width: "z", height: "y", thickness: "x" },
  XZ: { width: "x", height: "z", thickness: "y" },
  XY: { width: "x", height: "y", thickness: "z" },
};

/**
 * Edge sides of a panel by plane. `width` edges run along the face width axis
 * (their length is the panel width); `height` edges run along the face height axis.
 */
export const PLANE_EDGES: Readonly<Record<PanelPlane, { readonly widthEdges: readonly EdgeSide[]; readonly heightEdges: readonly EdgeSide[] }>> = {
  YZ: { widthEdges: ["TOP", "BOTTOM"], heightEdges: ["FRONT", "BACK"] },
  XZ: { widthEdges: ["FRONT", "BACK"], heightEdges: ["LEFT", "RIGHT"] },
  XY: { widthEdges: ["TOP", "BOTTOM"], heightEdges: ["LEFT", "RIGHT"] },
};

export function edgeSidesForPlane(plane: PanelPlane): readonly EdgeSide[] {
  const e = PLANE_EDGES[plane];
  return [...e.widthEdges, ...e.heightEdges];
}

/** Length of a panel edge, or null when the side does not exist on that plane. */
export function edgeLength(plane: PanelPlane, side: EdgeSide, face: { readonly width: number; readonly height: number }): number | null {
  const e = PLANE_EDGES[plane];
  if (e.widthEdges.includes(side)) return face.width;
  if (e.heightEdges.includes(side)) return face.height;
  return null;
}

/** Cabinet axis that grain runs along, or null for NONE. */
export function grainAxis(grain: GrainDirection): "x" | "y" | "z" | null {
  switch (grain) {
    case "WIDTH":
      return "x";
    case "HEIGHT":
      return "y";
    case "DEPTH":
      return "z";
    case "NONE":
      return null;
  }
}

/** True when the grain direction lies in the panel face (i.e. is physically possible). */
export function grainLiesInFace(plane: PanelPlane, grain: GrainDirection): boolean {
  const axis = grainAxis(grain);
  if (axis === null) return true;
  const a = PLANE_AXES[plane];
  return axis === a.width || axis === a.height;
}

/** Axis-aligned box of a panel placed at `position` (its minimum corner). */
export function panelBox(plane: PanelPlane, face: { readonly width: number; readonly height: number; readonly thickness: number }, position: Vector3): Box3 {
  const a = PLANE_AXES[plane];
  const size: Record<"x" | "y" | "z", number> = { x: 0, y: 0, z: 0 };
  size[a.width] = face.width;
  size[a.height] = face.height;
  size[a.thickness] = face.thickness;
  return { min: position, size };
}

export function boxMax(b: Box3): Vector3 {
  return { x: b.min.x + b.size.x, y: b.min.y + b.size.y, z: b.min.z + b.size.z };
}

/** Bounding box of several boxes, or null for none. */
export function envelope(boxes: readonly Box3[]): Box3 | null {
  const first = boxes[0];
  if (first === undefined) return null;
  let min = first.min;
  let max = boxMax(first);
  for (const b of boxes.slice(1)) {
    const bm = boxMax(b);
    min = { x: Math.min(min.x, b.min.x), y: Math.min(min.y, b.min.y), z: Math.min(min.z, b.min.z) };
    max = { x: Math.max(max.x, bm.x), y: Math.max(max.y, bm.y), z: Math.max(max.z, bm.z) };
  }
  return { min, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
}

/** Rotation about X or Z is not supported for floor-standing base cabinets in V1. */
export function isSupportedTransform(t: Transform): boolean {
  return t.rotationX === 0 && t.rotationZ === 0;
}

function round9(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
}

/**
 * Transform a cabinet-local point into room/world coordinates: rotate about the
 * vertical (Y) axis by `rotationY` degrees (counter-clockwise seen from above),
 * then translate. Results are rounded to 1e-9 mm to keep output deterministic.
 */
export function toWorld(p: Vector3, t: Transform): Vector3 {
  const rad = (t.rotationY * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: round9(t.x + p.x * cos + p.z * sin),
    y: round9(t.y + p.y),
    z: round9(t.z - p.x * sin + p.z * cos),
  };
}

/** The 8 world-space corners of a local box. */
export function worldCorners(b: Box3, t: Transform): Vector3[] {
  const mx = boxMax(b);
  const out: Vector3[] = [];
  for (const x of [b.min.x, mx.x]) for (const y of [b.min.y, mx.y]) for (const z of [b.min.z, mx.z]) out.push(toWorld({ x, y, z }, t));
  return out;
}

/** Positive overlap volume between two boxes (0 when merely touching). */
export function overlapVolume(a: Box3, b: Box3): number {
  const am = boxMax(a);
  const bm = boxMax(b);
  const dx = Math.min(am.x, bm.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(am.y, bm.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(am.z, bm.z) - Math.max(a.min.z, b.min.z);
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

export { asQuarterTurn, BACK_WALL, containment, placeBox, planDistance, QUARTER_TURNS, relativeToWall, roomWalls, wallFrame } from "./room.js";
export type { ContainmentViolation, WallFrame } from "./room.js";
