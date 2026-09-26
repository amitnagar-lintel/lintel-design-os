import type { DesignVersion, ValidationResult } from "@lintel/types";

export class ProductionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionGuardError";
  }
}

const PRODUCTION_STATES = new Set<DesignVersion["status"]>(["APPROVED", "LOCKED"]);

/**
 * Must be called before any production output (manufacturing release, CNC, final
 * drawings). Never generate production output from a non-approved design version
 * or while BLOCKERs exist (CLAUDE.md; PRD §18, §35).
 */
export function assertProductionEligible(designVersion: DesignVersion, validation: ValidationResult): void {
  if (!PRODUCTION_STATES.has(designVersion.status)) {
    throw new ProductionGuardError(`DesignVersion ${designVersion.designVersionId} is ${designVersion.status}; production output requires APPROVED or LOCKED`);
  }
  if (!validation.canApprove) {
    throw new ProductionGuardError(`DesignVersion ${designVersion.designVersionId} has ${validation.counts.BLOCKER} BLOCKER(s)`);
  }
}
