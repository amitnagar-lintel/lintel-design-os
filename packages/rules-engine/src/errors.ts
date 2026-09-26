export type FormulaErrorCode =
  | "PARSE_ERROR"
  | "UNKNOWN_VARIABLE"
  | "UNKNOWN_FUNCTION"
  | "ARITY_ERROR"
  | "TYPE_ERROR"
  | "DIVISION_BY_ZERO"
  | "NON_FINITE_RESULT"
  | "CYCLIC_DEPENDENCY";

export class FormulaError extends Error {
  readonly code: FormulaErrorCode;
  readonly expression: string;
  /** Character offset in the expression, when known. */
  readonly position: number | null;
  /** Variables that were missing from scope (for UNKNOWN_VARIABLE). */
  readonly variables: readonly string[];

  constructor(code: FormulaErrorCode, message: string, expression: string, position: number | null = null, variables: readonly string[] = []) {
    super(message);
    this.name = "FormulaError";
    this.code = code;
    this.expression = expression;
    this.position = position;
    this.variables = variables;
  }
}
