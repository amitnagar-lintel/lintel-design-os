export type BinaryOperator = "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=" | "==" | "!=";

export type FormulaNode =
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "variable"; readonly name: string }
  | { readonly type: "negate"; readonly operand: FormulaNode }
  | { readonly type: "binary"; readonly operator: BinaryOperator; readonly left: FormulaNode; readonly right: FormulaNode }
  | { readonly type: "call"; readonly name: string; readonly args: readonly FormulaNode[] };
