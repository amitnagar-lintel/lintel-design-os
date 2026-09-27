import type { DataClassification, VersionRef } from "./common.js";
import type { CabinetComponent, Box3 } from "./component.js";
import type { DesignObject, DesignState, Transform } from "./design.js";
import type { ScalarValue } from "./formula.js";
import type { HardwareDatasetRef, HardwareRequirement, HardwareResolution } from "./hardware.js";
import type { ValidationResult } from "./validation.js";

/** Carried by every derived artifact (PRD §17, §35). */
export interface TraceInfo {
  readonly engineVersion: string;
  /** TEST_FIXTURE when any input (standard, edge band standard, hardware dataset, catalog item) is test-fixture data. */
  readonly dataClassification: DataClassification;
  /** The inputs that made this trace TEST_FIXTURE (empty for PRODUCTION). */
  readonly testFixtureSources: readonly string[];
  readonly designVersionId: string;
  readonly designVersionStatus: DesignState;
  readonly objectId: string;
  readonly product: VersionRef;
  readonly recipe: VersionRef;
  /** ConstructionStandard version. */
  readonly standard: VersionRef;
  /** EdgeBandStandard version: a different edge standard makes derived artifacts stale. */
  readonly edgeBandStandard: VersionRef;
  readonly catalogVersion: string;
  readonly hardwareDatasets: readonly HardwareDatasetRef[];
}

export type ParameterSource = "DEFAULT" | "OBJECT";

export interface ResolvedParameters {
  /** Parameter values by key (e.g. width → 600, frontType → "OVERLAY"). */
  readonly values: Readonly<Record<string, number | string>>;
  readonly provenance: Readonly<Record<string, ParameterSource>>;
}

/**
 * One successfully resolved `"appliance"` parameter (Design Studio Slice 5 step 3): the join point the bom-engine
 * uses to emit an `ApplianceBomItem` without needing catalog access of its own (design doc §8).
 */
export interface ResolvedApplianceReference {
  readonly parameterKey: string;
  readonly applianceId: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
}

export interface ResolvedCabinet {
  readonly trace: TraceInfo;
  readonly object: DesignObject;
  readonly parameters: ResolvedParameters;
  /** Every value available to formulas after resolution (symbols, flags, derived formulas, construction variables). */
  readonly scope: Readonly<Record<string, ScalarValue>>;
  readonly derived: Readonly<Record<string, number>>;
  readonly components: readonly CabinetComponent[];
  readonly appliances: readonly ResolvedApplianceReference[];
  readonly hardwareRequirements: readonly HardwareRequirement[];
  readonly hardwareResolutions: readonly HardwareResolution[];
  readonly geometry: {
    /** Bounding box of all generated components in cabinet-local coordinates. */
    readonly envelope: Box3 | null;
    readonly transform: Transform;
  };
  readonly validation: ValidationResult;
}
