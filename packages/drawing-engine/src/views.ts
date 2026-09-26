/**
 * Orthographic view framework shared by every drawing (front elevation, side section,
 * cabinet internal elevation, wall internal elevation). A view maps world axes to sheet
 * axes; `toward` points from the scene to the viewer (larger depth = nearer).
 */
import type { Box3 } from "@lintel/types";
import type { Rect2 } from "./projection.js";

export type SignedAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";

export interface ViewSpec {
  readonly name: string;
  readonly right: SignedAxis;
  readonly up: SignedAxis;
  readonly toward: SignedAxis;
}

/** Cabinet front: viewer in front (+Z), X to the right. */
export const FRONT_VIEW: ViewSpec = { name: "FRONT", right: "+X", up: "+Y", toward: "+Z" };
/** Section looking from the left towards +X: cabinet back on the left, front on the right. */
export const SECTION_VIEW_FROM_LEFT: ViewSpec = { name: "SECTION_FROM_LEFT", right: "+Z", up: "+Y", toward: "-X" };

const r6 = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

function range(box: Box3, axis: SignedAxis): [number, number] {
  const k = axis[1] === "X" ? "x" : axis[1] === "Y" ? "y" : "z";
  const lo = box.min[k];
  const hi = box.min[k] + box.size[k];
  return axis[0] === "+" ? [lo, hi] : [-hi, -lo];
}

/** Project an axis-aligned box: sheet-plane rectangle plus its nearest depth. */
export function projectBox(id: string, box: Box3, view: ViewSpec): Rect2 {
  const [x0, x1] = range(box, view.right);
  const [y0, y1] = range(box, view.up);
  const [, z] = range(box, view.toward);
  return { id, x0: r6(x0), x1: r6(x1), y0: r6(y0), y1: r6(y1), z: r6(z) };
}
