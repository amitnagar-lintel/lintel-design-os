import { describe, expect, it } from "vitest";
import {
  evaluate,
  evaluateBoolean,
  evaluateFormulaSet,
  evaluateNumber,
  FormulaError,
  parseFormula,
  referencedVariables,
} from "../src/index.js";

const num = (expr: string, scope: Record<string, number | boolean> = {}): number => {
  const r = evaluateNumber(expr, scope);
  if (!r.ok) throw r.error;
  return r.value;
};
const errorCode = (expr: string, scope: Record<string, number | boolean> = {}): string => {
  const r = evaluate(expr, scope);
  if (r.ok) throw new Error(`expected failure for ${expr}`);
  return r.error.code;
};

describe("arithmetic (PRD §15: + - * /)", () => {
  it("evaluates the PRD example INTERNAL_WIDTH = W - (2*T)", () => {
    expect(num("W - (2*T)", { W: 600, T: 18 })).toBe(564);
  });
  it("respects precedence and associativity", () => {
    expect(num("2 + 3 * 4")).toBe(14);
    expect(num("(2 + 3) * 4")).toBe(20);
    expect(num("10 - 4 - 3")).toBe(3);
    expect(num("100 / 10 / 2")).toBe(5);
    expect(num("-3 * -2")).toBe(6);
    expect(num("--4")).toBe(4);
    expect(num("+5")).toBe(5);
  });
  it("parses decimals", () => {
    expect(num("0.5 + .25")).toBe(0.75);
  });
  it("rejects division by zero", () => {
    expect(errorCode("W / 0", { W: 1 })).toBe("DIVISION_BY_ZERO");
    expect(errorCode("W / (T - T)", { W: 1, T: 18 })).toBe("DIVISION_BY_ZERO");
  });
});

describe("functions (PRD §15)", () => {
  it("MIN / MAX are variadic", () => {
    expect(num("MIN(3, 1, 2)")).toBe(1);
    expect(num("MAX(3, 1, 2)")).toBe(3);
    expect(num("MIN(7)")).toBe(7);
  });
  it("ROUND rounds half away from zero, with optional digits", () => {
    expect(num("ROUND(2.5)")).toBe(3);
    expect(num("ROUND(-2.5)")).toBe(-3);
    expect(num("ROUND(2.4)")).toBe(2);
    expect(num("ROUND(1.005, 2)")).toBe(1.01);
    expect(num("ROUND(296.55, 1)")).toBe(296.6);
    expect(Object.is(num("ROUND(-0.4)"), 0)).toBe(true);
    expect(errorCode("ROUND(1, 1.5)")).toBe("TYPE_ERROR");
    expect(errorCode("ROUND(1, 7)")).toBe("TYPE_ERROR");
  });
  it("CEIL / FLOOR / ABS", () => {
    expect(num("CEIL(1.2)")).toBe(2);
    expect(num("FLOOR(1.8)")).toBe(1);
    expect(num("ABS(-4)")).toBe(4);
    expect(Object.is(num("CEIL(-0.5)"), 0)).toBe(true);
  });
  it("CLAMP", () => {
    expect(num("CLAMP(5, 0, 3)")).toBe(3);
    expect(num("CLAMP(-5, 0, 3)")).toBe(0);
    expect(num("CLAMP(2, 0, 3)")).toBe(2);
    expect(errorCode("CLAMP(2, 3, 0)")).toBe("TYPE_ERROR");
  });
  it("IF is lazy: the unselected branch is never evaluated", () => {
    expect(num("IF(W > 500, 2, MISSING)", { W: 600 })).toBe(2);
    expect(num("IF(W > 500, 1 / 0, 7)", { W: 100 })).toBe(7);
    expect(errorCode("IF(1, 2, 3)")).toBe("TYPE_ERROR");
  });
  it("AND / OR / NOT short-circuit and require booleans", () => {
    expect(evaluateBoolean("AND(W > 1, T > 1)", { W: 2, T: 2 })).toEqual({ ok: true, value: true });
    expect(evaluateBoolean("AND(W > 5, MISSING)", { W: 2 })).toEqual({ ok: true, value: false });
    expect(evaluateBoolean("OR(W > 1, MISSING)", { W: 2 })).toEqual({ ok: true, value: true });
    expect(evaluateBoolean("NOT(FALSE)", {})).toEqual({ ok: true, value: true });
    expect(errorCode("AND(1, TRUE)")).toBe("TYPE_ERROR");
  });
  it("enforces arity and known function names", () => {
    expect(errorCode("ABS(1, 2)")).toBe("ARITY_ERROR");
    expect(errorCode("MIN()")).toBe("ARITY_ERROR");
    expect(errorCode("SQRT(4)")).toBe("UNKNOWN_FUNCTION");
    expect(errorCode("min(1, 2)")).toBe("UNKNOWN_FUNCTION");
  });
});

describe("comparisons and types", () => {
  it("compares numbers and booleans", () => {
    expect(evaluate("W >= 600", { W: 600 })).toEqual({ ok: true, value: true });
    expect(evaluate("W != 600", { W: 600 })).toEqual({ ok: true, value: false });
    expect(evaluate("F == TRUE", { F: true })).toEqual({ ok: true, value: true });
  });
  it("rejects arithmetic on booleans and mixed-type equality", () => {
    expect(errorCode("F + 1", { F: true })).toBe("TYPE_ERROR");
    expect(errorCode("F == 1", { F: true })).toBe("TYPE_ERROR");
  });
  it("rejects chained comparisons", () => {
    expect(errorCode("1 < 2 < 3")).toBe("PARSE_ERROR");
  });
  it("evaluateNumber rejects boolean results and vice versa", () => {
    expect(evaluateNumber("1 < 2", {}).ok).toBe(false);
    expect(evaluateBoolean("1 + 2", {}).ok).toBe(false);
  });
});

describe("errors", () => {
  it("reports unknown variables with their names", () => {
    const r = evaluate("W - GAP", { W: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("UNKNOWN_VARIABLE");
      expect(r.error.variables).toEqual(["GAP"]);
    }
  });
  it("does not resolve inherited object properties as variables", () => {
    expect(errorCode("toString + 1")).toBe("UNKNOWN_VARIABLE");
  });
  it("reports parse errors with position", () => {
    for (const bad of ["", "1 +", "(1", "1 2", "W $ 2", "MIN(1,)"]) {
      const r = evaluate(bad, { W: 1 });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("PARSE_ERROR");
    }
    try {
      parseFormula("W $ 2");
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      expect((e as FormulaError).position).toBe(2);
    }
  });
  it("rejects non-finite results", () => {
    expect(errorCode("W * W", { W: 1e200 })).toBe("NON_FINITE_RESULT");
  });
});

describe("referencedVariables", () => {
  it("returns sorted unique names, excluding functions and literals", () => {
    expect(referencedVariables("MAX(W, T) + W - IF(F, TRUE, B)")).toEqual(["B", "F", "T", "W"]);
  });
});

describe("evaluateFormulaSet", () => {
  it("evaluates in dependency order regardless of declaration order", () => {
    const r = evaluateFormulaSet(
      [
        { formulaId: "SHUTTER_W", expression: "INTERNAL_W / 2", variables: ["INTERNAL_W"], unit: "MM" },
        { formulaId: "INTERNAL_W", expression: "W - 2*T", variables: ["W", "T"], unit: "MM" },
      ],
      { W: 600, T: 18 },
    );
    expect(r.values).toEqual({ INTERNAL_W: 564, SHUTTER_W: 282 });
    expect(r.errors).toEqual({});
  });
  it("reports cycles without looping and propagates failures", () => {
    const r = evaluateFormulaSet(
      [
        { formulaId: "A", expression: "B + 1", variables: ["B"], unit: "MM" },
        { formulaId: "B", expression: "A + 1", variables: ["A"], unit: "MM" },
        { formulaId: "C", expression: "GAP + 1", variables: ["GAP"], unit: "MM" },
        { formulaId: "D", expression: "C + 1", variables: ["C"], unit: "MM" },
      ],
      {},
    );
    expect(r.errors.A?.code).toBe("CYCLIC_DEPENDENCY");
    expect(r.errors.B?.code).toBe("UNKNOWN_VARIABLE");
    expect(r.errors.C?.code).toBe("UNKNOWN_VARIABLE");
    expect(r.errors.D?.code).toBe("UNKNOWN_VARIABLE");
    expect(r.values).toEqual({});
  });
  it("is deterministic", () => {
    const f = [{ formulaId: "X", expression: "ROUND(W / 3, 2)", variables: ["W"], unit: "MM" as const }];
    expect(evaluateFormulaSet(f, { W: 100 })).toEqual(evaluateFormulaSet(f, { W: 100 }));
  });
});
