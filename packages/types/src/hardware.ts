import type { Millimetres } from "./common.js";
import type { ComponentType } from "./component.js";
import type { ValidationMessage } from "./validation.js";

export type HardwareCategory = "HINGE" | "MOUNTING_PLATE";
export type HingeMounting = "FULL_OVERLAY" | "HALF_OVERLAY" | "INSET";

/**
 * PRD §26 — built from construction context; users never pick a generic fitting first.
 * `null` = unknown (e.g. no density in the catalog → weight unknown).
 */
export interface FittingSituation {
  readonly application: "HINGED_DOOR";
  readonly cabinetType: "BASE_CABINET";
  readonly componentType: ComponentType;
  readonly mounting: HingeMounting;
  readonly doorWidth: Millimetres;
  readonly doorHeight: Millimetres;
  readonly doorThickness: Millimetres;
  readonly doorMaterialId: string;
  readonly doorWeightKg: number | null;
  readonly openingAngleRequired: number | null;
  readonly availableDepth: Millimetres;
}

export interface HardwareRequirement {
  /** Deterministic, e.g. OBJ-KIT-001-SHT-L-HINGE. */
  readonly requirementId: string;
  readonly sourceObjectId: string;
  readonly sourceComponentId: string;
  readonly hardwareRuleId: string;
  readonly category: HardwareCategory;
  readonly preferredManufacturer: string;
  readonly fittingSituation: FittingSituation;
}

export interface ResolvedArticleLine {
  readonly manufacturer: string;
  readonly articleNumber: string;
  readonly description: string;
  readonly category: HardwareCategory;
  readonly quantity: number;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string;
  readonly licenseStatus: string;
}

export interface HardwareDatasetRef {
  readonly datasetId: string;
  readonly manufacturer: string;
  readonly sourceVersion: string;
  /** Only authoritative (official/authorised) data may drive production (PRD §25). */
  readonly authoritative: boolean;
}

export interface HardwareResolution {
  readonly requirementId: string;
  readonly manufacturer: string;
  readonly status: "RESOLVED" | "UNRESOLVED";
  readonly lines: readonly ResolvedArticleLine[];
  /** Compatible article numbers considered, in ranking order. */
  readonly candidates: readonly string[];
  readonly quantityRuleId: string | null;
  readonly drillingPatternId: string | null;
  readonly dataset: HardwareDatasetRef;
  readonly messages: readonly ValidationMessage[];
}

/** PRD §24 — every manufacturer integration lives behind this adapter. */
export interface ManufacturerAdapter {
  readonly manufacturer: string;
  readonly dataset: HardwareDatasetRef;
  resolve(requirement: HardwareRequirement): HardwareResolution;
}
