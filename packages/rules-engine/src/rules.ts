import type { RuleDefinition, ScalarValue, ValidationMessage } from "@lintel/types";
import { evaluateBoolean } from "./evaluator.js";
import type { Scope } from "./evaluator.js";

/** Replace `{NAME}` placeholders with scope values; unknown names are left as-is. */
export function interpolate(template: string, scope: Readonly<Record<string, ScalarValue | string>>): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const v = scope[name];
    return v === undefined ? whole : String(v);
  });
}

export interface RuleContext {
  readonly sourceObjectId: string;
}

/**
 * Evaluate data-driven rules. A rule that cannot be evaluated (e.g. references an
 * undefined construction value) yields a BLOCKER: the condition could not be verified.
 */
export function evaluateRules(rules: readonly RuleDefinition[], scope: Scope, context: RuleContext): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  for (const rule of rules) {
    if (rule.when !== undefined) {
      const w = evaluateBoolean(rule.when, scope);
      if (!w.ok) {
        out.push(unverifiable(rule, w.error.message, context));
        continue;
      }
      if (!w.value) continue;
    }
    const r = evaluateBoolean(rule.assert, scope);
    if (!r.ok) {
      out.push(unverifiable(rule, r.error.message, context));
    } else if (!r.value) {
      out.push({
        code: "RULE_VIOLATION",
        severity: rule.severity,
        message: interpolate(rule.message, scope),
        ruleId: rule.ruleId,
        sourceObjectId: context.sourceObjectId,
      });
    }
  }
  return out;
}

function unverifiable(rule: RuleDefinition, reason: string, context: RuleContext): ValidationMessage {
  return {
    code: "RULE_NOT_EVALUABLE",
    severity: "BLOCKER",
    message: `Rule ${rule.ruleId} could not be evaluated: ${reason}`,
    ruleId: rule.ruleId,
    sourceObjectId: context.sourceObjectId,
  };
}
