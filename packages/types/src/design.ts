import type { Currency, Millimetres, UnitSystem } from "./common.js";

/** PRD §10. */
export interface Project {
  readonly id: string;
  readonly projectCode: string;
  readonly name: string;
  readonly clientId: string;
  readonly propertyId: string;
  readonly status: string;
  readonly unitSystem: UnitSystem;
  readonly currency: Currency;
}

/** PRD §11. */
export interface Room {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: "KITCHEN";
  readonly length: Millimetres;
  readonly width: Millimetres;
  readonly height: Millimetres;
  readonly wallThickness: Millimetres;
}

/** PRD §35. */
export type DesignState = "DRAFT" | "IN_REVIEW" | "CHANGES_REQUIRED" | "APPROVED" | "LOCKED" | "SUPERSEDED";

export interface DesignVersion {
  readonly designVersionId: string;
  readonly designId: string;
  readonly projectId: string;
  readonly versionNumber: number;
  readonly status: DesignState;
}

export interface Transform {
  readonly x: Millimetres;
  readonly y: Millimetres;
  readonly z: Millimetres;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
}

export type ParameterValue = number | string;

/** PRD §12 — an intelligent object, not a mesh. */
export interface DesignObject {
  readonly objectId: string;
  /** Human-readable code used for deterministic component ids, e.g. OBJ-KIT-001. */
  readonly objectCode: string;
  readonly projectId: string;
  readonly roomId: string;
  readonly objectType: "BASE_CABINET";
  readonly productId: string;
  readonly transform: Transform;
  readonly dimensions: {
    readonly width: Millimetres;
    readonly height: Millimetres;
    readonly depth: Millimetres;
  };
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly status: "DRAFT" | "APPROVED";
}
