import type { Millimetres } from "./common.js";
import type { ClearanceRule } from "./catalog.js";
import type { EdgeSide } from "./component.js";

/**
 * Design Studio Slice 5 step 6 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md` §1/§3 Option B):
 * a semantic opening — geometry is a DERIVED OUTPUT (never authored directly) and is never a boolean
 * subtraction on any real component. `target: "COUNTERTOP"` describes a hole that conceptually belongs to a
 * countertop object this repository does not build yet; this slice defines the vocabulary and derives one
 * `CutoutFeature` per sink/hob cabinet from its own referenced `Appliance`, ready for a future countertop
 * system to consume, render for real, and eventually cut.
 */
export type CutoutTarget = "COUNTERTOP" | "CABINET_TOP" | "CABINET_BACK";
/** "RECTANGLE" is the only shape any cabinet in this repository needs for V1 (design doc §1). */
export type CutoutShape = "RECTANGLE";

export interface CutoutFeature {
  readonly cutoutId: string;
  readonly target: CutoutTarget;
  readonly shape: CutoutShape;
  readonly widthMm: Millimetres;
  readonly depthMm: Millimetres;
  /**
   * Offset from the cabinet footprint's own centre, in the cabinet's local frame. `{ xMm: 0, zMm: 0 }`
   * (centred) is the only value this slice ever produces — a real offset (e.g. a hob set back from the
   * cabinet front) needs real positioning data no future countertop system has supplied yet, so none is
   * invented here (CLAUDE.md).
   */
  readonly position: { readonly xMm: Millimetres; readonly zMm: Millimetres };
  /** `null` until a real value is sourced — never invented, per CLAUDE.md. */
  readonly cornerRadiusMm: Millimetres | null;
  readonly clearance: readonly ClearanceRule[];
  /** The `Appliance` this opening exists for, or `null` for a purely structural cutout. */
  readonly sourceApplianceId: string | null;
  /** Per `EdgeSide` of the opening. `null` until sourced — never invented, exactly like every other edge-band value. */
  readonly edgeTreatment: Readonly<Partial<Record<EdgeSide, string>>> | null;
}
