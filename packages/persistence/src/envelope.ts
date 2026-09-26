import type { DataStatus } from "@lintel/types";
import type { Sha256 } from "./hash.js";
import { isSha256 } from "./hash.js";

/** Persisted lifecycle (M5 §4). CHANGES_REQUIRED is a decision, never a status (D2). */
export type RecordStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED" | "SUPERSEDED";

export const RECORD_STATUSES: readonly RecordStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"];

/** Structured source reference (document, drawing, supplier sheet or official URL). */
export interface SourceRef {
  readonly url: string | null;
  readonly documentTitle: string | null;
  readonly documentVersion: string | null;
  readonly sourceDate: string | null;
}

/**
 * Immutable version identity (M5 §2.1, requirement A). Every versioned production record
 * carries exactly these fields. Persisted records are always PRODUCTION (requirement E).
 */
export interface VersionEnvelope {
  readonly entityId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  /** Optional human label, e.g. "0.2.0"; the engine version string when present. */
  readonly versionLabel: string | null;
  readonly status: RecordStatus;
  readonly dataClassification: "PRODUCTION";
  readonly source: string;
  readonly sourceRef: SourceRef | null;
  readonly changeReason: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly effectiveFrom: string | null;
  readonly lockedBy: string | null;
  readonly lockedAt: string | null;
  readonly supersededBy: string | null;
  readonly supersededAt: string | null;
  readonly contentHash: Sha256;
}

/** Column form of the envelope (snake_case, one column per field). */
export interface EnvelopeRow {
  readonly entity_id: string;
  readonly id: string;
  readonly version_number: number;
  readonly version_label: string | null;
  readonly status: RecordStatus;
  readonly data_classification: "PRODUCTION";
  readonly source: string;
  readonly source_ref: SourceRef | null;
  readonly change_reason: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly effective_from: string | null;
  readonly locked_by: string | null;
  readonly locked_at: string | null;
  readonly superseded_by: string | null;
  readonly superseded_at: string | null;
  readonly content_hash: Sha256;
}

export function envelopeToRow(e: VersionEnvelope): EnvelopeRow {
  return {
    entity_id: e.entityId,
    id: e.versionId,
    version_number: e.versionNumber,
    version_label: e.versionLabel,
    status: e.status,
    data_classification: e.dataClassification,
    source: e.source,
    source_ref: e.sourceRef,
    change_reason: e.changeReason,
    created_by: e.createdBy,
    created_at: e.createdAt,
    submitted_by: e.submittedBy,
    submitted_at: e.submittedAt,
    approved_by: e.approvedBy,
    approved_at: e.approvedAt,
    effective_from: e.effectiveFrom,
    locked_by: e.lockedBy,
    locked_at: e.lockedAt,
    superseded_by: e.supersededBy,
    superseded_at: e.supersededAt,
    content_hash: e.contentHash,
  };
}

export function envelopeFromRow(r: EnvelopeRow): VersionEnvelope {
  return {
    entityId: r.entity_id,
    versionId: r.id,
    versionNumber: r.version_number,
    versionLabel: r.version_label,
    status: r.status,
    dataClassification: r.data_classification,
    source: r.source,
    sourceRef: r.source_ref,
    changeReason: r.change_reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    effectiveFrom: r.effective_from,
    lockedBy: r.locked_by,
    lockedAt: r.locked_at,
    supersededBy: r.superseded_by,
    supersededAt: r.superseded_at,
    contentHash: r.content_hash,
  };
}

const APPROVED_OR_LATER = new Set<RecordStatus>(["APPROVED", "LOCKED", "SUPERSEDED"]);

/**
 * Invariants of a stored envelope — the same rules the database enforces with CHECK constraints.
 * Returns human-readable problems; empty means consistent.
 */
export function envelopeProblems(e: VersionEnvelope): string[] {
  const out: string[] = [];
  if (!Number.isInteger(e.versionNumber) || e.versionNumber < 1) out.push("versionNumber must be a positive integer");
  if ((e.dataClassification as string) !== "PRODUCTION") out.push("dataClassification must be PRODUCTION (TEST_FIXTURE is never persisted)");
  if (e.source.trim() === "") out.push("source is required");
  if (e.changeReason.trim() === "") out.push("changeReason is required");
  if (!isSha256(e.contentHash)) out.push("contentHash must be sha256:<64 hex>");
  const approved = APPROVED_OR_LATER.has(e.status);
  if (approved !== (e.approvedBy !== null && e.approvedAt !== null)) out.push("approvedBy/approvedAt must be set exactly when APPROVED, LOCKED or SUPERSEDED");
  if (approved !== (e.effectiveFrom !== null)) out.push("effectiveFrom must be set exactly when APPROVED, LOCKED or SUPERSEDED");
  if (e.approvedBy !== null && e.approvedBy === e.submittedBy) out.push("approvedBy must differ from submittedBy (D8)");
  if (e.status === "IN_REVIEW" && (e.submittedBy === null || e.submittedAt === null)) out.push("IN_REVIEW requires submittedBy/submittedAt");
  if (e.status === "DRAFT" && (e.submittedBy !== null || e.submittedAt !== null)) out.push("DRAFT must not carry submittedBy/submittedAt");
  if ((e.status === "LOCKED") !== (e.lockedBy !== null && e.lockedAt !== null) && e.status !== "SUPERSEDED") out.push("lockedBy/lockedAt must be set exactly when LOCKED");
  if ((e.status === "SUPERSEDED") !== (e.supersededBy !== null && e.supersededAt !== null)) out.push("supersededBy/supersededAt must be set exactly when SUPERSEDED");
  if (e.supersededBy !== null && e.supersededBy === e.versionId) out.push("a version cannot supersede itself");
  return out;
}

/** Engine view of a persisted status (M5 §3.9). SUPERSEDED is usable only to reproduce an existing snapshot. */
export function engineStatus(s: RecordStatus): Exclude<DataStatus, "TEST_FIXTURE"> {
  switch (s) {
    case "APPROVED":
    case "LOCKED":
      return "APPROVED";
    case "DRAFT":
    case "IN_REVIEW":
      return "DRAFT";
    case "SUPERSEDED":
      return "RETIRED";
  }
}

/** Engine version string for a persisted version: its label, else the version number. */
export function engineVersionString(e: Pick<VersionEnvelope, "versionLabel" | "versionNumber">): string {
  return e.versionLabel ?? String(e.versionNumber);
}
