import type { DataStatus, Millimetres } from "./common.js";

/**
 * Substrate board. Kept separate from finish and edge band (PRD §19 — never collapse them).
 * `null` means "not yet defined in the catalog" — engines must not substitute a value.
 */
export interface Material {
  readonly materialId: string;
  readonly category: "BOARD";
  readonly name: string;
  readonly substrate: string | null;
  readonly thickness: Millimetres;
  readonly sheetSize: { readonly width: Millimetres; readonly height: Millimetres } | null;
  /** `null` = not yet defined for this material. */
  readonly grain: boolean | null;
  /** kg/m³. Needed for door-weight based hardware rules. */
  readonly densityKgPerM3: number | null;
  readonly status: DataStatus;
  readonly source: string;
}

export interface Finish {
  readonly finishId: string;
  readonly type: "LAMINATE" | "VENEER" | "PAINT" | "ACRYLIC" | "PU";
  readonly name: string;
  readonly thickness: Millimetres | null;
  readonly status: DataStatus;
  readonly source: string;
}

export interface EdgeBand {
  readonly edgeBandId: string;
  readonly name: string;
  readonly material: "ABS" | "PVC" | "VENEER" | null;
  readonly thickness: Millimetres;
  readonly width: Millimetres | null;
  readonly status: DataStatus;
  readonly source: string;
}
