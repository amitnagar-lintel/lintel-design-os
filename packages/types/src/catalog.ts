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

/**
 * Design Studio Slice 5 step 2 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md` §5/§6): a
 * generic clearance a cabinet/appliance bay/countertop opening must respect. Reusable across zones — never a
 * one-off field on `Appliance` itself.
 */
export interface ClearanceRule {
  readonly ruleId: string;
  readonly zone: "INSTALLATION" | "VENTILATION" | "STRUCTURAL_EXCLUSION";
  readonly axis: "TOP" | "BOTTOM" | "LEFT" | "RIGHT" | "FRONT" | "BACK";
  /** `null` = not yet sourced (never invented). */
  readonly minMm: Millimetres | null;
  /** `null` = no upper bound. */
  readonly maxMm: Millimetres | null;
}

/** The opening an appliance needs (already clearance-inclusive) — not the appliance's own physical size. */
export interface InstallationEnvelope {
  readonly widthMm: Millimetres;
  readonly heightMm: Millimetres;
  readonly depthMm: Millimetres;
  readonly clearances: readonly ClearanceRule[];
}

/**
 * A first-class, versioned reference-data entity (§5), independent of any cabinet — a cabinet references an
 * appliance by id/version, exactly the way it references a material by catalog code, never by embedding
 * appliance data inline. Every field stays `null`/`TEST_FIXTURE` until Lintel or a real manufacturer feed
 * supplies real values (same discipline as `Material`/`Finish`/`EdgeBand`); no real appliance dimensions are
 * ever invented (CLAUDE.md).
 */
export interface Appliance {
  readonly applianceId: string;
  readonly category: "HOB" | "OVEN" | "MICROWAVE" | "DISHWASHER" | "REFRIGERATOR" | "SINK";
  readonly make: string | null;
  readonly model: string | null;
  /** The appliance's own physical size — distinct from `installation`, the opening it needs. */
  readonly dimensions: { readonly widthMm: Millimetres; readonly heightMm: Millimetres; readonly depthMm: Millimetres } | null;
  readonly installation: InstallationEnvelope | null;
  readonly ventilation: readonly ClearanceRule[] | null;
  /** `null` until sourced. */
  readonly frontAlignment: "FLUSH" | "RECESSED" | "PROUD" | null;
  readonly status: DataStatus;
  readonly source: string;
}
