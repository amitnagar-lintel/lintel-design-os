import { SEVERITY_ORDER } from "@lintel/types";
import type { Severity, ValidationMessage, ValidationResult } from "@lintel/types";

function compareStrings(a: string | undefined, b: string | undefined): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Deterministic message order: severity, code, component, path, rule, message. */
export function compareMessages(a: ValidationMessage, b: ValidationMessage): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    compareStrings(a.code, b.code) ||
    compareStrings(a.componentId, b.componentId) ||
    compareStrings(a.path, b.path) ||
    compareStrings(a.ruleId, b.ruleId) ||
    compareStrings(a.message, b.message)
  );
}

function messageKey(m: ValidationMessage): string {
  return JSON.stringify([m.severity, m.code, m.componentId ?? "", m.path ?? "", m.ruleId ?? "", m.message]);
}

/** Sort, de-duplicate and summarise. `canApprove` is false when any BLOCKER exists (PRD §18). */
export function buildValidationResult(messages: readonly ValidationMessage[]): ValidationResult {
  const unique = new Map<string, ValidationMessage>();
  for (const m of messages) {
    const k = messageKey(m);
    if (!unique.has(k)) unique.set(k, m);
  }
  const sorted = [...unique.values()].sort(compareMessages);
  const counts: Record<Severity, number> = { BLOCKER: 0, ERROR: 0, WARNING: 0, INFO: 0 };
  for (const m of sorted) counts[m.severity]++;
  return { messages: sorted, counts, canApprove: counts.BLOCKER === 0 };
}
