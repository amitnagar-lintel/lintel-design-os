import type { Severity } from "./validation.js";

export type FormulaUnit = "MM" | "COUNT" | "BOOLEAN" | "RATIO" | "KG";

/** A named, data-driven formula (PRD §15). */
export interface FormulaDefinition {
  readonly formulaId: string;
  readonly expression: string;
  /** Declared inputs. Validated against the parsed expression by catalog validation. */
  readonly variables: readonly string[];
  readonly unit: FormulaUnit;
  readonly description?: string;
}

/** A value usable inside formula evaluation. */
export type ScalarValue = number | boolean;

/**
 * A data-driven rule. `assert` must evaluate to true; when it evaluates to false a
 * ValidationMessage with `severity` is emitted. `when` (optional) gates applicability.
 */
export interface RuleDefinition {
  readonly ruleId: string;
  readonly description: string;
  readonly when?: string;
  readonly assert: string;
  readonly severity: Severity;
  readonly message: string;
}
