import { describe, expect, it } from "vitest";
import type { VersionEnvelope } from "../src/index.js";
import { approveSuccessor, assertEditable, contentHash, designVersionApprovalProblems, envelopeFromRow, envelopeProblems, envelopeToRow, isSha256, nextDraft, NotEditableError, transition } from "../src/index.js";

const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-26T11:00:00.000Z";
const HASH = contentHash({ values: { A: null } });

const draft = (over: Partial<VersionEnvelope> = {}): VersionEnvelope => ({
  entityId: "ent_1",
  versionId: "ver_1",
  versionNumber: 1,
  versionLabel: "0.1.0",
  status: "DRAFT",
  dataClassification: "PRODUCTION",
  source: "Pending — Lintel production team",
  sourceRef: null,
  changeReason: "Initial version",
  createdBy: "user_author",
  createdAt: T0,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  effectiveFrom: null,
  lockedBy: null,
  lockedAt: null,
  supersededBy: null,
  supersededAt: null,
  contentHash: HASH,
  ...over,
});

const ok = (r: ReturnType<typeof transition>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const submitted = () => ok(transition(draft(), { action: "SUBMIT", actorUserId: "user_author", at: T0, reason: "ready for review" })).next;

describe("content hash (SHA-256)", () => {
  it("is sha256-prefixed hex and independent of key order", () => {
    const a = contentHash({ b: 1, a: [1, { y: 2, x: null }] });
    expect(isSha256(a)).toBe(true);
    expect(contentHash({ a: [1, { x: null, y: 2 }], b: 1 })).toBe(a);
    expect(contentHash({ a: [1, { x: null, y: 3 }], b: 1 })).not.toBe(a);
  });
  it("distinguishes null from absent and from 0", () => {
    expect(contentHash({ v: null })).not.toBe(contentHash({}));
    expect(contentHash({ v: null })).not.toBe(contentHash({ v: 0 }));
  });
});

describe("version envelope", () => {
  it("round-trips through its row form", () => {
    const e = draft();
    expect(envelopeFromRow(envelopeToRow(e))).toEqual(e);
  });
  it("a consistent draft has no problems", () => {
    expect(envelopeProblems(draft())).toEqual([]);
  });
  it("rejects approval without approver/effectiveFrom, approver = submitter, and TEST_FIXTURE", () => {
    expect(envelopeProblems(draft({ status: "APPROVED" }))).toEqual(expect.arrayContaining([expect.stringContaining("approvedBy"), expect.stringContaining("effectiveFrom")]));
    expect(envelopeProblems(draft({ status: "APPROVED", submittedBy: "u", submittedAt: T0, approvedBy: "u", approvedAt: T1, effectiveFrom: T1 }))).toContain("approvedBy must differ from submittedBy (D8)");
    const fixture = { ...draft(), dataClassification: "TEST_FIXTURE" } as unknown as VersionEnvelope;
    expect(envelopeProblems(fixture)[0]).toContain("TEST_FIXTURE is never persisted");
  });
  it("rejects a missing source, change reason or malformed hash", () => {
    expect(envelopeProblems(draft({ source: " ", changeReason: "", contentHash: "sha256:xyz" }))).toHaveLength(3);
  });
});

describe("lifecycle transitions", () => {
  it("DRAFT → IN_REVIEW records the submitter", () => {
    const e = submitted();
    expect(e).toMatchObject({ status: "IN_REVIEW", submittedBy: "user_author", submittedAt: T0 });
    expect(envelopeProblems(e)).toEqual([]);
  });
  it("IN_REVIEW → APPROVED by a different user with the reviewed hash", () => {
    const r = ok(transition(submitted(), { action: "APPROVE", actorUserId: "user_head", at: T1, reason: "checked", expectedContentHash: HASH }));
    expect(r.next).toMatchObject({ status: "APPROVED", approvedBy: "user_head", approvedAt: T1, effectiveFrom: T1 });
    expect(r.decision).toMatchObject({ action: "APPROVE", previousStatus: "IN_REVIEW", newStatus: "APPROVED", subjectContentHash: HASH });
    expect(envelopeProblems(r.next)).toEqual([]);
  });
  it("D8: approver = submitter is always rejected (no override)", () => {
    const r = transition(submitted(), { action: "APPROVE", actorUserId: "user_author", at: T1, reason: "self", expectedContentHash: HASH });
    expect(r).toMatchObject({ ok: false, code: "APPROVER_IS_SUBMITTER" });
  });
  it("approval requires the exact reviewed content hash", () => {
    expect(transition(submitted(), { action: "APPROVE", actorUserId: "user_head", at: T1, reason: "x" })).toMatchObject({ ok: false, code: "CONTENT_HASH_REQUIRED" });
    expect(transition(submitted(), { action: "APPROVE", actorUserId: "user_head", at: T1, reason: "x", expectedContentHash: contentHash("other") })).toMatchObject({ ok: false, code: "CONTENT_HASH_MISMATCH" });
  });
  it("approval is refused while domain preconditions fail", () => {
    const r = transition(submitted(), { action: "APPROVE", actorUserId: "user_head", at: T1, reason: "x", expectedContentHash: HASH, preconditionFailures: ["validation has 26 BLOCKER(s)"] });
    expect(r).toMatchObject({ ok: false, code: "PRECONDITIONS_FAILED" });
  });
  it("D2: REQUEST_CHANGES returns to DRAFT and records requestedBy, requestedAt, reason and previous status", () => {
    const r = ok(transition(submitted(), { action: "REQUEST_CHANGES", actorUserId: "user_head", at: T1, reason: "shelf setback missing a source" }));
    expect(r.next).toMatchObject({ status: "DRAFT", submittedBy: null, submittedAt: null });
    expect(r.decision).toEqual({
      action: "REQUEST_CHANGES",
      decidedBy: "user_head",
      decidedAt: T1,
      reason: "shelf setback missing a source",
      previousStatus: "IN_REVIEW",
      newStatus: "DRAFT",
      subjectVersionId: "ver_1",
      subjectContentHash: HASH,
    });
    expect(transition(submitted(), { action: "REQUEST_CHANGES", actorUserId: "user_author", at: T1, reason: "x" })).toMatchObject({ ok: false, code: "REVIEWER_IS_SUBMITTER" });
  });
  it("content is editable only in DRAFT", () => {
    expect(() => {
      assertEditable(draft());
    }).not.toThrow();
    expect(() => {
      assertEditable(submitted());
    }).toThrow(NotEditableError);
  });
  it("every transition needs a reason and a valid source state", () => {
    expect(transition(draft(), { action: "SUBMIT", actorUserId: "u", at: T0, reason: "  " })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    for (const action of ["APPROVE", "LOCK", "REQUEST_CHANGES", "SUPERSEDE"] as const) {
      expect(transition(draft(), { action, actorUserId: "u", at: T0, reason: "x", expectedContentHash: HASH, supersededBy: "ver_2" })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    }
  });
  it("APPROVED → LOCKED → SUPERSEDED; nothing leaves SUPERSEDED", () => {
    const approved = ok(transition(submitted(), { action: "APPROVE", actorUserId: "user_head", at: T1, reason: "ok", expectedContentHash: HASH })).next;
    const locked = ok(transition(approved, { action: "LOCK", actorUserId: "user_head", at: T1, reason: "quotation issued" })).next;
    expect(locked).toMatchObject({ status: "LOCKED", lockedBy: "user_head" });
    const superseded = ok(transition(locked, { action: "SUPERSEDE", actorUserId: "user_head", at: T1, reason: "v2", supersededBy: "ver_2" })).next;
    expect(superseded).toMatchObject({ status: "SUPERSEDED", supersededBy: "ver_2" });
    expect(envelopeProblems(superseded)).toEqual([]);
    for (const action of ["SUBMIT", "APPROVE", "LOCK", "REQUEST_CHANGES", "SUPERSEDE"] as const) {
      expect(transition(superseded, { action, actorUserId: "u", at: T1, reason: "x", expectedContentHash: HASH, supersededBy: "ver_3" }).ok).toBe(false);
    }
  });
});

describe("new versions never mutate history", () => {
  it("nextDraft creates version N+1 as DRAFT and leaves N untouched", () => {
    const v1 = Object.freeze(draft({ status: "APPROVED", submittedBy: "a", submittedAt: T0, approvedBy: "b", approvedAt: T1, effectiveFrom: T1 }));
    const v2 = nextDraft(v1, { versionId: "ver_2", createdBy: "a", createdAt: T1, changeReason: "values supplied", contentHash: contentHash({ v: 2 }), versionLabel: "0.2.0" });
    expect(v2).toMatchObject({ entityId: v1.entityId, versionNumber: 2, status: "DRAFT", approvedBy: null, effectiveFrom: null });
    expect(v1.status).toBe("APPROVED");
  });
  it("approving a successor supersedes the effective version atomically", () => {
    const v1 = draft({ status: "APPROVED", submittedBy: "a", submittedAt: T0, approvedBy: "b", approvedAt: T0, effectiveFrom: T0 });
    const v2 = { ...nextDraft(v1, { versionId: "ver_2", createdBy: "a", createdAt: T1, changeReason: "c", contentHash: HASH }), status: "IN_REVIEW" as const, submittedBy: "a", submittedAt: T1 };
    const r = approveSuccessor(v2, v1, { actorUserId: "b", at: T1, reason: "approved", expectedContentHash: HASH });
    if (!r.ok) throw new Error(r.message);
    expect(r.approved.status).toBe("APPROVED");
    expect(r.superseded).toMatchObject({ status: "SUPERSEDED", supersededBy: "ver_2" });
    expect(r.decisions.map((d) => d.action)).toEqual(["APPROVE", "SUPERSEDE"]);
    expect(approveSuccessor(v2, v1, { actorUserId: "a", at: T1, reason: "self", expectedContentHash: HASH })).toMatchObject({ ok: false, code: "APPROVER_IS_SUBMITTER" });
  });
});

describe("design version approval preconditions", () => {
  const pins = (status: "APPROVED" | "DRAFT" | null) => [
    { name: "constructionStandard", required: true, status: "APPROVED" as const },
    { name: "edgeBandStandard", required: true, status },
    { name: "manufacturingStandard", required: false, status: null },
  ];
  it("passes only with approved pins and a zero-BLOCKER validation for the current inputs", () => {
    expect(designVersionApprovalProblems({ pins: pins("APPROVED"), currentInputHash: HASH, latestValidationRun: { inputHash: HASH, blockerCount: 0 } })).toEqual([]);
  });
  it("reports unapproved or missing pins, stale or blocked validation", () => {
    expect(designVersionApprovalProblems({ pins: pins("DRAFT"), currentInputHash: HASH, latestValidationRun: { inputHash: HASH, blockerCount: 0 } })).toEqual(["pin edgeBandStandard is DRAFT; it must be APPROVED or LOCKED"]);
    expect(designVersionApprovalProblems({ pins: pins(null), currentInputHash: HASH, latestValidationRun: null })).toEqual(["pin edgeBandStandard is not set", "no engine validation run exists"]);
    expect(designVersionApprovalProblems({ pins: pins("APPROVED"), currentInputHash: HASH, latestValidationRun: { inputHash: contentHash("old"), blockerCount: 0 } })[0]).toContain("different inputs");
    expect(designVersionApprovalProblems({ pins: pins("APPROVED"), currentInputHash: HASH, latestValidationRun: { inputHash: HASH, blockerCount: 26 } })).toEqual(["validation has 26 BLOCKER(s)"]);
  });
});
