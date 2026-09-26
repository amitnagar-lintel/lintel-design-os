import type { FormulaDefinition, ScalarValue } from "@lintel/types";
import type { FormulaNode } from "./ast.js";
import { FormulaError } from "./errors.js";
import { parseFormula, referencedVariables } from "./parser.js";

export type Scope = Readonly<Record<string, ScalarValue>>;

export type EvaluationResult<T extends ScalarValue = ScalarValue> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FormulaError };

/** Functions required by PRD §15, plus NOT. Names are upper-case only. */
export const FORMULA_FUNCTIONS = ["MIN", "MAX", "ROUND", "CEIL", "FLOOR", "ABS", "IF", "AND", "OR", "NOT", "CLAMP"] as const;

const MAX_ROUND_DIGITS = 6;

/** Round half away from zero (Math.round rounds -2.5 to -2). */
function roundHalfAwayFromZero(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  // Guard against binary representation error (e.g. 1.005 * 100 = 100.49999…).
  const rounded = Math.round(Number(scaled.toPrecision(15)));
  const result = (Math.sign(value) * rounded) / factor;
  return result === 0 ? 0 : result;
}

class Evaluator {
  constructor(
    private readonly expression: string,
    private readonly scope: Scope,
  ) {}

  private fail(code: FormulaError["code"], message: string, variables: readonly string[] = []): never {
    throw new FormulaError(code, message, this.expression, null, variables);
  }

  private num(node: FormulaNode, context: string): number {
    const v = this.eval(node);
    if (typeof v !== "number") this.fail("TYPE_ERROR", `${context} expects a number, got boolean`);
    return v;
  }

  private bool(node: FormulaNode, context: string): boolean {
    const v = this.eval(node);
    if (typeof v !== "boolean") this.fail("TYPE_ERROR", `${context} expects a boolean, got number`);
    return v;
  }

  private arity(name: string, args: readonly FormulaNode[], min: number, max: number): void {
    if (args.length < min || args.length > max) {
      const expected = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min}-${max}`;
      this.fail("ARITY_ERROR", `${name} expects ${expected} argument(s), got ${args.length}`);
    }
  }

  eval(node: FormulaNode): ScalarValue {
    switch (node.type) {
      case "number":
      case "boolean":
        return node.value;
      case "variable": {
        if (!Object.prototype.hasOwnProperty.call(this.scope, node.name)) {
          this.fail("UNKNOWN_VARIABLE", `Unknown variable '${node.name}'`, [node.name]);
        }
        const v = this.scope[node.name];
        if (v === undefined) this.fail("UNKNOWN_VARIABLE", `Unknown variable '${node.name}'`, [node.name]);
        return v;
      }
      case "negate":
        return -this.num(node.operand, "unary '-'");
      case "binary":
        return this.binary(node);
      case "call":
        return this.call(node.name, node.args);
    }
  }

  private binary(node: Extract<FormulaNode, { type: "binary" }>): ScalarValue {
    const op = node.operator;
    if (op === "==" || op === "!=") {
      const l = this.eval(node.left);
      const r = this.eval(node.right);
      if (typeof l !== typeof r) this.fail("TYPE_ERROR", `'${op}' compares values of different types`);
      return op === "==" ? l === r : l !== r;
    }
    const l = this.num(node.left, `'${op}'`);
    const r = this.num(node.right, `'${op}'`);
    switch (op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        if (r === 0) this.fail("DIVISION_BY_ZERO", "Division by zero");
        return l / r;
      case "<":
        return l < r;
      case "<=":
        return l <= r;
      case ">":
        return l > r;
      case ">=":
        return l >= r;
    }
  }

  private call(name: string, args: readonly FormulaNode[]): ScalarValue {
    switch (name) {
      case "MIN":
      case "MAX": {
        this.arity(name, args, 1, Infinity);
        const values = args.map((a) => this.num(a, name));
        return name === "MIN" ? Math.min(...values) : Math.max(...values);
      }
      case "ROUND": {
        this.arity(name, args, 1, 2);
        const [valueNode, digitsNode] = args as [FormulaNode, FormulaNode | undefined];
        const digits = digitsNode === undefined ? 0 : this.num(digitsNode, "ROUND digits");
        if (!Number.isInteger(digits) || digits < 0 || digits > MAX_ROUND_DIGITS) {
          this.fail("TYPE_ERROR", `ROUND digits must be an integer 0-${MAX_ROUND_DIGITS}`);
        }
        return roundHalfAwayFromZero(this.num(valueNode, name), digits);
      }
      case "CEIL":
      case "FLOOR":
      case "ABS": {
        this.arity(name, args, 1, 1);
        const v = this.num(args[0] as FormulaNode, name);
        const r = name === "CEIL" ? Math.ceil(v) : name === "FLOOR" ? Math.floor(v) : Math.abs(v);
        return r === 0 ? 0 : r;
      }
      case "CLAMP": {
        this.arity(name, args, 3, 3);
        const [v, lo, hi] = args.map((a) => this.num(a, name)) as [number, number, number];
        if (lo > hi) this.fail("TYPE_ERROR", "CLAMP lower bound exceeds upper bound");
        return Math.min(Math.max(v, lo), hi);
      }
      case "IF": {
        this.arity(name, args, 3, 3);
        const [c, a, b] = args as [FormulaNode, FormulaNode, FormulaNode];
        // Lazy: only the selected branch is evaluated.
        return this.bool(c, "IF condition") ? this.eval(a) : this.eval(b);
      }
      case "AND": {
        this.arity(name, args, 1, Infinity);
        for (const a of args) if (!this.bool(a, "AND")) return false;
        return true;
      }
      case "OR": {
        this.arity(name, args, 1, Infinity);
        for (const a of args) if (this.bool(a, "OR")) return true;
        return false;
      }
      case "NOT":
        this.arity(name, args, 1, 1);
        return !this.bool(args[0] as FormulaNode, "NOT");
      default:
        return this.fail("UNKNOWN_FUNCTION", `Unknown function '${name}'`);
    }
  }
}

function toError(expression: string, e: unknown): FormulaError {
  if (e instanceof FormulaError) return e;
  return new FormulaError("PARSE_ERROR", e instanceof Error ? e.message : String(e), expression);
}

/** Evaluate any expression. Never throws. */
export function evaluate(expression: string, scope: Scope): EvaluationResult {
  try {
    const value = new Evaluator(expression, scope).eval(parseFormula(expression));
    if (typeof value === "number" && !Number.isFinite(value)) {
      return { ok: false, error: new FormulaError("NON_FINITE_RESULT", "Result is not a finite number", expression) };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: toError(expression, e) };
  }
}

export function evaluateNumber(expression: string, scope: Scope): EvaluationResult<number> {
  const r = evaluate(expression, scope);
  if (!r.ok) return r;
  if (typeof r.value !== "number") {
    return { ok: false, error: new FormulaError("TYPE_ERROR", "Expected a numeric result", expression) };
  }
  return { ok: true, value: r.value };
}

export function evaluateBoolean(expression: string, scope: Scope): EvaluationResult<boolean> {
  const r = evaluate(expression, scope);
  if (!r.ok) return r;
  if (typeof r.value !== "boolean") {
    return { ok: false, error: new FormulaError("TYPE_ERROR", "Expected a boolean result", expression) };
  }
  return { ok: true, value: r.value };
}

export interface FormulaSetResult {
  readonly values: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, FormulaError>>;
}

/**
 * Evaluate a set of named formulas that may reference each other (by formulaId) and the
 * base scope. Evaluated in dependency order; cycles are reported, not looped.
 * A formula depending on a failed formula fails with UNKNOWN_VARIABLE for that id.
 */
export function evaluateFormulaSet(formulas: readonly FormulaDefinition[], base: Scope): FormulaSetResult {
  const byId = new Map(formulas.map((f) => [f.formulaId, f]));
  const values: Record<string, number> = {};
  const errors: Record<string, FormulaError> = {};
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, stack: readonly string[]): void => {
    const s = state.get(id);
    if (s === "done") return;
    const f = byId.get(id);
    if (f === undefined) return;
    if (s === "visiting") {
      errors[id] = new FormulaError("CYCLIC_DEPENDENCY", `Cyclic formula dependency: ${[...stack, id].join(" → ")}`, f.expression);
      return;
    }
    state.set(id, "visiting");
    let deps: string[];
    try {
      deps = referencedVariables(f.expression).filter((v) => byId.has(v));
    } catch (e) {
      errors[id] = toError(f.expression, e);
      state.set(id, "done");
      return;
    }
    for (const d of deps) visit(d, [...stack, id]);
    if (errors[id] === undefined) {
      const r = evaluateNumber(f.expression, { ...base, ...values });
      if (r.ok) values[id] = r.value;
      else errors[id] = r.error;
    }
    state.set(id, "done");
  };

  for (const f of formulas) visit(f.formulaId, []);
  return { values, errors };
}
