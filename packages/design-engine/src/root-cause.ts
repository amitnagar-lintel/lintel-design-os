import type { ScalarValue } from "@lintel/types";
import { referencedVariables } from "@lintel/rules-engine";
import type { FormulaError } from "@lintel/rules-engine";

export interface RootCause {
  readonly undefinedConstruction: string[];
  readonly other: string[];
}

/**
 * Explains a failed expression in terms of its root causes: every construction value
 * it (transitively, through failed derived formulas) needs that is undefined.
 * Static analysis: variables in an unselected IF branch are also listed.
 */
export class RootCauseResolver {
  constructor(
    private readonly constructionKeys: ReadonlySet<string>,
    /** Derived formulas that failed, by id → expression. */
    private readonly failedFormulas: ReadonlyMap<string, string>,
    private readonly scope: Readonly<Record<string, ScalarValue>>,
  ) {}

  explain(error: FormulaError): RootCause {
    if (error.code !== "UNKNOWN_VARIABLE") return { undefinedConstruction: [], other: [`${error.code}: ${error.message}`] };
    const construction = new Set<string>();
    const other = new Set<string>();
    const seen = new Set<string>();
    const walk = (expression: string): void => {
      for (const v of referencedVariables(expression)) {
        if (seen.has(v) || Object.prototype.hasOwnProperty.call(this.scope, v)) continue;
        seen.add(v);
        const inner = this.failedFormulas.get(v);
        if (inner !== undefined) walk(inner);
        else if (this.constructionKeys.has(v)) construction.add(v);
        else if (v !== "i") other.add(`missing input ${v}`);
      }
    };
    walk(error.expression);
    return { undefinedConstruction: [...construction].sort(), other: [...other].sort() };
  }
}
