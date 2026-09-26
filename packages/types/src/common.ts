/**
 * Shared primitives. All internal lengths are millimetres (PRD §11).
 */

/** Length in millimetres. */
export type Millimetres = number;

export type UnitSystem = "MM";
export type Currency = "INR";

/** Lifecycle of versioned catalog / rule data (PRD §6.8). */
export type DataStatus =
  /** Synthetic values used only to exercise engine mechanics in tests. Never approvable. */
  | "TEST_FIXTURE"
  /** Authored but not yet verified for production. Never approvable. */
  | "DRAFT"
  /** Verified for production use. */
  | "APPROVED"
  | "RETIRED";

/**
 * Whether a data set may ever drive production. TEST_FIXTURE data is synthetic and
 * must never be silently substituted for PRODUCTION data (production safety rule).
 */
export type DataClassification = "PRODUCTION" | "TEST_FIXTURE";

/** Reference to a specific version of versioned data, carried for traceability (PRD §17). */
export interface VersionRef {
  readonly id: string;
  readonly version: string;
  readonly status: DataStatus;
}

/** Cabinet-local axes: X = width (left→right), Y = height (up), Z = depth (back→front; front face at Z = D). */
export type Axis = "X" | "Y" | "Z";

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
