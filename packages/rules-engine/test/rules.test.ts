import { describe, expect, it } from "vitest";
import type { RuleDefinition, ValidationMessage } from "@lintel/types";
import { buildValidationResult, evaluateRules, interpolate } from "../src/index.js";

const ctx = { sourceObjectId: "obj_001" };

describe("evaluateRules", () => {
  const rules: RuleDefinition[] = [
    { ruleId: "R_POS", description: "", assert: "W > 2*T", severity: "BLOCKER", message: "W {W} too small" },
    { ruleId: "R_WHEN", description: "", when: "INSET", assert: "SS >= TF", severity: "BLOCKER", message: "setback" },
  ];

  it("passes when assertions hold", () => {
    expect(evaluateRules(rules, { W: 600, T: 18, INSET: false }, ctx)).toEqual([]);
  });
  it("emits the rule severity with interpolated message on violation", () => {
    const out = evaluateRules(rules, { W: 30, T: 18, INSET: false }, ctx);
    expect(out).toEqual([{ code: "RULE_VIOLATION", severity: "BLOCKER", message: "W 30 too small", ruleId: "R_POS", sourceObjectId: "obj_001" }]);
  });
  it("skips rules whose `when` is false, applies when true", () => {
    expect(evaluateRules(rules, { W: 600, T: 18, INSET: true, SS: 10, TF: 18 }, ctx).map((m) => m.ruleId)).toEqual(["R_WHEN"]);
  });
  it("turns unevaluable rules into BLOCKERs rather than silently passing", () => {
    const out = evaluateRules(rules, { W: 600, T: 18, INSET: true }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.code).toBe("RULE_NOT_EVALUABLE");
    expect(out[0]?.severity).toBe("BLOCKER");
  });
});

describe("interpolate", () => {
  it("replaces known placeholders only", () => {
    expect(interpolate("{A} and {B}", { A: 1 })).toBe("1 and {B}");
  });
});

describe("buildValidationResult", () => {
  const m = (severity: ValidationMessage["severity"], code: string): ValidationMessage => ({ severity, code, message: code });
  it("sorts by severity then code, de-duplicates and counts", () => {
    const r = buildValidationResult([m("INFO", "B"), m("BLOCKER", "Z"), m("WARNING", "A"), m("BLOCKER", "A"), m("INFO", "B")]);
    expect(r.messages.map((x) => `${x.severity}:${x.code}`)).toEqual(["BLOCKER:A", "BLOCKER:Z", "WARNING:A", "INFO:B"]);
    expect(r.counts).toEqual({ BLOCKER: 2, ERROR: 0, WARNING: 1, INFO: 1 });
    expect(r.canApprove).toBe(false);
  });
  it("can approve when there are no blockers", () => {
    expect(buildValidationResult([m("ERROR", "E"), m("WARNING", "W")]).canApprove).toBe(true);
  });
});
