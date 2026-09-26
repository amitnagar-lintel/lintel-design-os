import type { BinaryOperator, FormulaNode } from "./ast.js";
import { FormulaError } from "./errors.js";

type Token =
  | { readonly kind: "number"; readonly value: number; readonly pos: number }
  | { readonly kind: "ident"; readonly value: string; readonly pos: number }
  | { readonly kind: "op"; readonly value: string; readonly pos: number }
  | { readonly kind: "end"; readonly pos: number };

const OPERATORS = ["<=", ">=", "==", "!=", "+", "-", "*", "/", "<", ">", "(", ")", ","] as const;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const numMatch = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (numMatch) {
      tokens.push({ kind: "number", value: Number(numMatch[0]), pos: i });
      i += numMatch[0].length;
      continue;
    }
    const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (identMatch) {
      tokens.push({ kind: "ident", value: identMatch[0], pos: i });
      i += identMatch[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op !== undefined) {
      tokens.push({ kind: "op", value: op, pos: i });
      i += op.length;
      continue;
    }
    throw new FormulaError("PARSE_ERROR", `Unexpected character '${ch}' at ${i}`, src, i);
  }
  tokens.push({ kind: "end", pos: src.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly src: string,
    private readonly tokens: readonly Token[],
  ) {}

  parse(): FormulaNode {
    const node = this.comparison();
    const next = this.peek();
    if (next.kind !== "end") {
      throw this.error(`Unexpected token at ${next.pos}`, next.pos);
    }
    return node;
  }

  private peek(): Token {
    const t = this.tokens[this.index];
    if (t === undefined) throw this.error("Unexpected end of input", this.src.length);
    return t;
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.value === value;
  }

  private expectOp(value: string): void {
    const t = this.peek();
    if (t.kind !== "op" || t.value !== value) throw this.error(`Expected '${value}' at ${t.pos}`, t.pos);
    this.index++;
  }

  private error(message: string, pos: number): FormulaError {
    return new FormulaError("PARSE_ERROR", message, this.src, pos);
  }

  /** Comparisons are non-associative: `a < b < c` is rejected. */
  private comparison(): FormulaNode {
    const left = this.additive();
    const t = this.peek();
    if (t.kind === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(t.value)) {
      this.index++;
      const right = this.additive();
      const after = this.peek();
      if (after.kind === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(after.value)) {
        throw this.error(`Chained comparison at ${after.pos}; use AND()`, after.pos);
      }
      return { type: "binary", operator: t.value as BinaryOperator, left, right };
    }
    return left;
  }

  private additive(): FormulaNode {
    let node = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.value === "+" || t.value === "-")) {
        this.index++;
        node = { type: "binary", operator: t.value, left: node, right: this.multiplicative() };
      } else {
        return node;
      }
    }
  }

  private multiplicative(): FormulaNode {
    let node = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.value === "*" || t.value === "/")) {
        this.index++;
        node = { type: "binary", operator: t.value, left: node, right: this.unary() };
      } else {
        return node;
      }
    }
  }

  private unary(): FormulaNode {
    if (this.isOp("-")) {
      this.index++;
      return { type: "negate", operand: this.unary() };
    }
    if (this.isOp("+")) {
      this.index++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): FormulaNode {
    const t = this.peek();
    if (t.kind === "number") {
      this.index++;
      return { type: "number", value: t.value };
    }
    if (t.kind === "ident") {
      this.index++;
      if (this.isOp("(")) {
        this.index++;
        const args: FormulaNode[] = [];
        if (!this.isOp(")")) {
          args.push(this.comparison());
          while (this.isOp(",")) {
            this.index++;
            args.push(this.comparison());
          }
        }
        this.expectOp(")");
        return { type: "call", name: t.value, args };
      }
      if (t.value === "TRUE") return { type: "boolean", value: true };
      if (t.value === "FALSE") return { type: "boolean", value: false };
      return { type: "variable", name: t.value };
    }
    if (t.kind === "op" && t.value === "(") {
      this.index++;
      const node = this.comparison();
      this.expectOp(")");
      return node;
    }
    throw this.error(t.kind === "end" ? "Unexpected end of expression" : `Unexpected token at ${t.pos}`, t.pos);
  }
}

const cache = new Map<string, FormulaNode>();

/** Parse an expression into an immutable AST. Results are memoised per expression string. */
export function parseFormula(expression: string): FormulaNode {
  const cached = cache.get(expression);
  if (cached !== undefined) return cached;
  if (expression.trim() === "") throw new FormulaError("PARSE_ERROR", "Empty expression", expression, 0);
  const node = new Parser(expression, tokenize(expression)).parse();
  cache.set(expression, node);
  return node;
}

/** All variable names referenced anywhere in the expression (sorted, unique). */
export function referencedVariables(expression: string): string[] {
  const names = new Set<string>();
  const walk = (n: FormulaNode): void => {
    switch (n.type) {
      case "variable":
        names.add(n.name);
        return;
      case "negate":
        walk(n.operand);
        return;
      case "binary":
        walk(n.left);
        walk(n.right);
        return;
      case "call":
        n.args.forEach(walk);
        return;
      case "number":
      case "boolean":
        return;
    }
  };
  walk(parseFormula(expression));
  return [...names].sort();
}
