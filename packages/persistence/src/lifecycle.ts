import type { RecordLifecycleStatus, VersionEnvelope } from "./envelope.js";
import type { Sha256 } from "./hash.js";

/**
 * Pure lifecycle rules (M5 §4). The application service calls these; the database
 * transition function re-checks the same rules. No I/O, no clock: time is an input.
 *
 *   DRAFT ─SUBMIT→ IN_REVIEW ─APPROVE→ APPROVED ─LOCK→ LOCKED ─SUPERSEDE→ SUPERSEDED
 *     ▲               │                    └──────────SUPERSEDE──────────┘
 *     └─REQUEST_CHANGES┘
 */
export type TransitionAction = "SUBMIT" | "REQUEST_CHANGES" | "APPROVE" | "LOCK" | "SUPERSEDE";

export type TransitionErrorCode =
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED"
  | "APPROVER_IS_SUBMITTER"
  | "REVIEWER_IS_SUBMITTER"
  | "CONTENT_HASH_REQUIRED"
  | "CONTENT_HASH_MISMATCH"
  | "PRECONDITIONS_FAILED"
  | "SUPERSEDED_BY_REQUIRED";

export interface TransitionRequest {
  readonly action: TransitionAction;
  readonly actorUserId: string;
  /** ISO timestamp supplied by the caller (deterministic). */
  readonly at: string;
  readonly reason: string;
  /** Required for APPROVE: the hash of the content the approver reviewed. */
  readonly expectedContentHash?: Sha256;
  /** APPROVE: defaults to `at`. */
  readonly effectiveFrom?: string;
  /** SUPERSEDE: the successor version id. */
  readonly supersededBy?: string;
  /** Failed domain preconditions computed by the service (e.g. `designVersionApprovalProblems`). */
  readonly preconditionFailures?: readonly string[];
}

/** Approval/audit history entry (D2: request-changes records requestedBy, requestedAt, reason, previous status). */
export interface TransitionDecision {
  readonly action: TransitionAction;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly reason: string;
  readonly previousStatus: RecordLifecycleStatus;
  readonly newStatus: RecordLifecycleStatus;
  readonly subjectVersionId: string;
  readonly subjectContentHash: Sha256;
}

export type TransitionResult =
  | { readonly ok: true; readonly next: VersionEnvelope; readonly decision: TransitionDecision }
  | { readonly ok: false; readonly code: TransitionErrorCode; readonly message: string };

const ALLOWED: Readonly<Record<TransitionAction, { readonly from: readonly RecordLifecycleStatus[]; readonly to: RecordLifecycleStatus }>> = {
  SUBMIT: { from: ["DRAFT"], to: "IN_REVIEW" },
  REQUEST_CHANGES: { from: ["IN_REVIEW"], to: "DRAFT" },
  APPROVE: { from: ["IN_REVIEW"], to: "APPROVED" },
  LOCK: { from: ["APPROVED"], to: "LOCKED" },
  SUPERSEDE: { from: ["APPROVED", "LOCKED"], to: "SUPERSEDED" },
};

const fail = (code: TransitionErrorCode, message: string): TransitionResult => ({ ok: false, code, message });

export function transition(current: VersionEnvelope, req: TransitionRequest): TransitionResult {
  const rule = ALLOWED[req.action];
  if (!rule.from.includes(current.status)) {
    return fail("INVALID_TRANSITION", `${req.action} is not allowed from ${current.status} (allowed from ${rule.from.join(", ")})`);
  }
  if (req.reason.trim() === "") return fail("REASON_REQUIRED", `${req.action} requires a reason`);
  const failures = req.preconditionFailures ?? [];
  if ((req.action === "SUBMIT" || req.action === "APPROVE") && failures.length > 0) {
    return fail("PRECONDITIONS_FAILED", `${req.action} preconditions failed: ${failures.join("; ")}`);
  }

  let next: VersionEnvelope;
  switch (req.action) {
    case "SUBMIT":
      next = { ...current, status: rule.to, submittedBy: req.actorUserId, submittedAt: req.at };
      break;
    case "REQUEST_CHANGES":
      if (req.actorUserId === current.submittedBy) return fail("REVIEWER_IS_SUBMITTER", "The submitter cannot review their own submission");
      next = { ...current, status: rule.to, submittedBy: null, submittedAt: null };
      break;
    case "APPROVE":
      // D8: mandatory, no override.
      if (req.actorUserId === current.submittedBy) return fail("APPROVER_IS_SUBMITTER", "Approver must differ from the submitter (D8)");
      if (req.expectedContentHash === undefined) return fail("CONTENT_HASH_REQUIRED", "APPROVE requires the content hash that was reviewed");
      if (req.expectedContentHash !== current.contentHash) {
        return fail("CONTENT_HASH_MISMATCH", `Reviewed content ${req.expectedContentHash} does not match stored content ${current.contentHash}`);
      }
      next = { ...current, status: rule.to, approvedBy: req.actorUserId, approvedAt: req.at, effectiveFrom: req.effectiveFrom ?? req.at };
      break;
    case "LOCK":
      next = { ...current, status: rule.to, lockedBy: req.actorUserId, lockedAt: req.at };
      break;
    case "SUPERSEDE":
      if (req.supersededBy === undefined || req.supersededBy === current.versionId) return fail("SUPERSEDED_BY_REQUIRED", "SUPERSEDE requires a different successor version id");
      next = { ...current, status: rule.to, supersededBy: req.supersededBy, supersededAt: req.at };
      break;
  }
  return {
    ok: true,
    next,
    decision: {
      action: req.action,
      decidedBy: req.actorUserId,
      decidedAt: req.at,
      reason: req.reason,
      previousStatus: current.status,
      newStatus: next.status,
      subjectVersionId: current.versionId,
      subjectContentHash: current.contentHash,
    },
  };
}

export class NotEditableError extends Error {
  constructor(e: VersionEnvelope) {
    super(`Version ${e.versionId} is ${e.status}; content is editable only in DRAFT`);
    this.name = "NotEditableError";
  }
}

/** Content (values, rules, objects, pins) may change only while DRAFT. */
export function assertEditable(e: VersionEnvelope): void {
  if (e.status !== "DRAFT") throw new NotEditableError(e);
}

/** Start version N+1 from version N: a new DRAFT. The previous version is never mutated. */
export function nextDraft(
  previous: VersionEnvelope,
  init: { readonly versionId: string; readonly createdBy: string; readonly createdAt: string; readonly changeReason: string; readonly contentHash: Sha256; readonly versionLabel?: string | null },
): VersionEnvelope {
  return {
    entityId: previous.entityId,
    versionId: init.versionId,
    versionNumber: previous.versionNumber + 1,
    versionLabel: init.versionLabel ?? null,
    status: "DRAFT",
    dataClassification: "PRODUCTION",
    source: previous.source,
    sourceRef: previous.sourceRef,
    changeReason: init.changeReason,
    createdBy: init.createdBy,
    createdAt: init.createdAt,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    effectiveFrom: null,
    lockedBy: null,
    lockedAt: null,
    supersededBy: null,
    supersededAt: null,
    contentHash: init.contentHash,
  };
}

/**
 * Approve version N+1 and supersede the currently effective version in one step
 * (the service runs both in one transaction). Fails without changing anything if either fails.
 */
export function approveSuccessor(
  successor: VersionEnvelope,
  effective: VersionEnvelope | null,
  req: Omit<TransitionRequest, "action" | "supersededBy">,
): { readonly ok: true; readonly approved: VersionEnvelope; readonly superseded: VersionEnvelope | null; readonly decisions: readonly TransitionDecision[] } | Extract<TransitionResult, { ok: false }> {
  if (effective !== null && effective.entityId !== successor.entityId) {
    return { ok: false, code: "INVALID_TRANSITION", message: "The superseded version must belong to the same entity" };
  }
  const approved = transition(successor, { ...req, action: "APPROVE" });
  if (!approved.ok) return approved;
  if (effective === null) return { ok: true, approved: approved.next, superseded: null, decisions: [approved.decision] };
  const superseded = transition(effective, { actorUserId: req.actorUserId, at: req.at, reason: `Superseded by version ${successor.versionNumber}: ${req.reason}`, action: "SUPERSEDE", supersededBy: successor.versionId });
  if (!superseded.ok) return superseded;
  return { ok: true, approved: approved.next, superseded: superseded.next, decisions: [approved.decision, superseded.decision] };
}

/** Pin names a design version carries (M5 §2.3); `required` pins must be set to approve. */
export interface PinState {
  readonly name: string;
  readonly required: boolean;
  /** Status of the pinned version, or null when the pin is not set. */
  readonly status: RecordLifecycleStatus | null;
}

/**
 * Design-version approval preconditions (M5 §4): every required pin is set, every set pin is
 * APPROVED or LOCKED, and the latest engine validation run for the current inputs has zero BLOCKERs.
 * Eligibility itself is proven by the engine's validation run — nothing is recomputed here.
 */
export function designVersionApprovalProblems(input: {
  readonly pins: readonly PinState[];
  readonly currentInputHash: Sha256;
  readonly latestValidationRun: { readonly inputHash: Sha256; readonly blockerCount: number } | null;
}): string[] {
  const out: string[] = [];
  for (const p of input.pins) {
    if (p.status === null) {
      if (p.required) out.push(`pin ${p.name} is not set`);
    } else if (p.status !== "APPROVED" && p.status !== "LOCKED") {
      out.push(`pin ${p.name} is ${p.status}; it must be APPROVED or LOCKED`);
    }
  }
  const run = input.latestValidationRun;
  if (run === null) out.push("no engine validation run exists");
  else if (run.inputHash !== input.currentInputHash) out.push("the latest validation run is for different inputs; validate again");
  else if (run.blockerCount > 0) out.push(`validation has ${run.blockerCount} BLOCKER(s)`);
  return out;
}
