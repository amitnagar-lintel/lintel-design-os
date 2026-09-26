/**
 * API contract for output purposes: what the API may generate, issue and release, mirroring
 * design_os.output_purpose_rule (the database test asserts the two tables are identical).
 */
import { describe, expect, it } from "vitest";
import type { OutputPurpose, RecordLifecycleStatus, SnapshotKind } from "../src/index.js";
import {
  buildSnapshotRecord,
  MappingError,
  OUTPUT_PURPOSE_RULES,
  OUTPUT_PURPOSES,
  outputPurposeProblems,
  purposeChangeDecision,
  qualifiesForIssue,
  qualifiesForRelease,
  RECORD_LIFECYCLE_STATUSES,
  snapshotFromRow,
  snapshotToRow,
} from "../src/index.js";
import { provenance } from "./support/provenance.js";

const KINDS: readonly SnapshotKind[] = ["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING", "MANUFACTURING_DOCUMENT"];

function record(kind: SnapshotKind, purpose: OutputPurpose, status: RecordLifecycleStatus, blockerCount: number) {
  return buildSnapshotRecord({
    snapshotId: "snap", kind, purpose, provenance: provenance(kind, status), payload: { items: [] }, blockerCount, warningCount: 0, outputComplete: true,
    validationBlockerCount: blockerCount, createdBy: "u", createdAt: "2026-09-26T10:00:00.000Z",
    ...(kind === "QUOTATION" ? { revisionNumber: 1 } : {}),
  });
}

describe("the purpose rules are explicit per kind", () => {
  it("every kind has exactly PRELIMINARY, FOR_REVIEW and FOR_PRODUCTION", () => {
    expect(OUTPUT_PURPOSE_RULES).toHaveLength(18);
    for (const k of KINDS) expect(OUTPUT_PURPOSE_RULES.filter((r) => r.kind === k).map((r) => r.purpose)).toEqual([...OUTPUT_PURPOSES]);
  });
  it("FOR_REVIEW is its own purpose: IN_REVIEW / APPROVED / LOCKED (and SUPERSEDED for reproduction / review), BLOCKERs allowed, never issued or released", () => {
    for (const r of OUTPUT_PURPOSE_RULES.filter((x) => x.purpose === "FOR_REVIEW")) {
      expect(r).toMatchObject({ designStatuses: ["IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"], requiresZeroBlockers: false, qualifiesForIssue: false, qualifiesForRelease: false });
    }
  });
  it("only FOR_PRODUCTION quotations / drawings can be issued and only FOR_PRODUCTION manufacturing documents released", () => {
    for (const k of KINDS) for (const p of OUTPUT_PURPOSES) {
      expect([k, p, qualifiesForIssue(k, p)]).toEqual([k, p, p === "FOR_PRODUCTION" && (k === "QUOTATION" || k === "DRAWING")]);
      expect([k, p, qualifiesForRelease(k, p)]).toEqual([k, p, p === "FOR_PRODUCTION" && k === "MANUFACTURING_DOCUMENT"]);
    }
  });
});

describe("which design states allow which purpose (API pre-check)", () => {
  const allowed: Readonly<Record<OutputPurpose, readonly RecordLifecycleStatus[]>> = {
    PRELIMINARY: ["DRAFT", "IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"],
    FOR_REVIEW: ["IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"],
    FOR_PRODUCTION: ["APPROVED", "LOCKED"],
  };
  it("SUPERSEDED designs: PRELIMINARY and FOR_REVIEW (reproduction / review) only; never FOR_PRODUCTION", () => {
    for (const k of KINDS) {
      expect(outputPurposeProblems(k, "PRELIMINARY", "SUPERSEDED", 3)).toEqual([]);
      expect(outputPurposeProblems(k, "FOR_REVIEW", "SUPERSEDED", 3)).toEqual([]);
      expect(outputPurposeProblems(k, "FOR_PRODUCTION", "SUPERSEDED", 0).map((p) => p.code)).toEqual(["PRODUCTION_GUARD_FAILED"]);
    }
  });
  it.each(KINDS.map((k) => [k]))("%s: the full purpose × lifecycle matrix", (kind) => {
    for (const p of OUTPUT_PURPOSES) for (const s of RECORD_LIFECYCLE_STATUSES) {
      const problems = outputPurposeProblems(kind, p, s, 0);
      if (allowed[p].includes(s)) expect([p, s, problems]).toEqual([p, s, []]);
      else expect([p, s, problems.map((x) => x.code)]).toEqual([p, s, [p === "FOR_PRODUCTION" ? "PRODUCTION_GUARD_FAILED" : "OUTPUT_PURPOSE_NOT_ALLOWED"]]);
    }
  });
  it("BLOCKERs: FOR_PRODUCTION refuses them, FOR_REVIEW and PRELIMINARY show them", () => {
    expect(outputPurposeProblems("DRAWING", "FOR_PRODUCTION", "APPROVED", 1).map((p) => p.code)).toEqual(["VALIDATION_BLOCKERS"]);
    expect(outputPurposeProblems("DRAWING", "FOR_REVIEW", "IN_REVIEW", 5)).toEqual([]);
    expect(outputPurposeProblems("DRAWING", "PRELIMINARY", "DRAFT", 5)).toEqual([]);
  });
  it("buildSnapshotRecord enforces the same contract and keeps the purpose through the row mapping", () => {
    expect(() => record("BOQ", "FOR_REVIEW", "DRAFT", 0)).toThrow(MappingError);
    expect(() => record("BOQ", "FOR_PRODUCTION", "IN_REVIEW", 0)).toThrow(/PRODUCTION_GUARD_FAILED/);
    expect(() => record("BOM", "FOR_PRODUCTION", "APPROVED", 2)).toThrow(/VALIDATION_BLOCKERS/);
    expect(() => record("QUOTATION", "FOR_PRODUCTION", "SUPERSEDED", 0)).toThrow(/PRODUCTION_GUARD_FAILED/);
    expect(record("BOQ", "FOR_REVIEW", "SUPERSEDED", 2).purpose).toBe("FOR_REVIEW");
    const r = record("MANUFACTURING_DOCUMENT", "FOR_REVIEW", "IN_REVIEW", 3);
    expect(snapshotFromRow(snapshotToRow(r, { orgId: "org" }))).toEqual(r);
    expect(snapshotToRow(r, { orgId: "org" }).purpose).toBe("FOR_REVIEW");
  });
});

describe("purposes never change", () => {
  it("every change between purposes is refused (RECORD_IMMUTABLE): no upgrade to FOR_PRODUCTION, no downgrade", () => {
    const pairs = OUTPUT_PURPOSES.flatMap((from) => OUTPUT_PURPOSES.filter((to) => to !== from).map((to) => [from, to] as const));
    expect(pairs).toHaveLength(6);
    for (const [from, to] of pairs) expect(purposeChangeDecision(from, to)).toMatchObject({ allowed: false, code: "RECORD_IMMUTABLE" });
  });
});
