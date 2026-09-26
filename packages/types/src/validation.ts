/** Validation severities (PRD §18). BLOCKER prevents approval and manufacturing. */
export type Severity = "INFO" | "WARNING" | "ERROR" | "BLOCKER";

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  BLOCKER: 0,
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
};

export interface ValidationMessage {
  /** Stable machine-readable code, e.g. CONSTRUCTION_VARIABLE_UNDEFINED. */
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly sourceObjectId?: string;
  readonly componentId?: string;
  readonly ruleId?: string;
  /** Dotted path of the offending input, e.g. parameters.width. */
  readonly path?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ValidationResult {
  readonly messages: readonly ValidationMessage[];
  readonly counts: Readonly<Record<Severity, number>>;
  /** True when no BLOCKER exists (PRD §18). */
  readonly canApprove: boolean;
}
