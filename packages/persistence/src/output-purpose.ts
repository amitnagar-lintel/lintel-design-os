import type { RecordLifecycleStatus } from "./envelope.js";
import type { SnapshotKind } from "./provenance.js";

/**
 * Output purposes (M5 Step 4). Mirrors `design_os.output_purpose_rule` (migration 0012) exactly; a database test
 * asserts the two are identical. This is the contract the API applies before writing; the database is the final check.
 *
 * - PRELIMINARY: work-in-progress output from any lifecycle state; never issued, never released.
 * - FOR_REVIEW: engineering / client review output from an IN_REVIEW, APPROVED or LOCKED design. BLOCKERs are shown,
 *   not hidden. It never qualifies as FOR_PRODUCTION and never satisfies issue or production-release requirements.
 * - FOR_PRODUCTION: APPROVED or LOCKED design, 0 BLOCKERs and every production guard. The only purpose that can be
 *   issued (quotations, drawings) or released to manufacturing (manufacturing documents).
 *
 * A snapshot's purpose never changes: snapshots are insert-only, so a different purpose is always a new snapshot
 * that must meet its own rule.
 */
export type OutputPurpose = "PRELIMINARY" | "FOR_REVIEW" | "FOR_PRODUCTION";

export const OUTPUT_PURPOSES: readonly OutputPurpose[] = ["PRELIMINARY", "FOR_REVIEW", "FOR_PRODUCTION"];

export interface OutputPurposeRule {
  readonly kind: SnapshotKind;
  readonly purpose: OutputPurpose;
  readonly designStatuses: readonly RecordLifecycleStatus[];
  readonly requiresZeroBlockers: boolean;
  readonly qualifiesForIssue: boolean;
  readonly qualifiesForRelease: boolean;
}

const KINDS: readonly SnapshotKind[] = ["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING", "MANUFACTURING_DOCUMENT"];
const ISSUABLE: ReadonlySet<SnapshotKind> = new Set(["QUOTATION", "DRAWING"]);

/** Every allowed (kind, purpose) pair, explicit per snapshot kind. */
export const OUTPUT_PURPOSE_RULES: readonly OutputPurposeRule[] = KINDS.flatMap((kind): OutputPurposeRule[] => [
  { kind, purpose: "PRELIMINARY", designStatuses: ["DRAFT", "IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"], requiresZeroBlockers: false, qualifiesForIssue: false, qualifiesForRelease: false },
  { kind, purpose: "FOR_REVIEW", designStatuses: ["IN_REVIEW", "APPROVED", "LOCKED"], requiresZeroBlockers: false, qualifiesForIssue: false, qualifiesForRelease: false },
  { kind, purpose: "FOR_PRODUCTION", designStatuses: ["APPROVED", "LOCKED"], requiresZeroBlockers: true, qualifiesForIssue: ISSUABLE.has(kind), qualifiesForRelease: kind === "MANUFACTURING_DOCUMENT" },
]);

export function outputPurposeRule(kind: SnapshotKind, purpose: OutputPurpose): OutputPurposeRule | undefined {
  return OUTPUT_PURPOSE_RULES.find((r) => r.kind === kind && r.purpose === purpose);
}

/** API error codes (the same codes the database raises as LD024 / LD021 / LD011). */
export type OutputPurposeProblemCode = "OUTPUT_PURPOSE_NOT_ALLOWED" | "PRODUCTION_GUARD_FAILED" | "VALIDATION_BLOCKERS";

export interface OutputPurposeProblem {
  readonly code: OutputPurposeProblemCode;
  readonly message: string;
}

/** Why an output of this kind and purpose may not be generated from a design in this state (empty = allowed). */
export function outputPurposeProblems(kind: SnapshotKind, purpose: OutputPurpose, designStatus: RecordLifecycleStatus, blockerCount: number): OutputPurposeProblem[] {
  const rule = outputPurposeRule(kind, purpose);
  if (rule === undefined) return [{ code: "OUTPUT_PURPOSE_NOT_ALLOWED", message: `purpose ${purpose} is not allowed for ${kind} outputs` }];
  const out: OutputPurposeProblem[] = [];
  if (!rule.designStatuses.includes(designStatus)) {
    out.push({
      code: purpose === "FOR_PRODUCTION" ? "PRODUCTION_GUARD_FAILED" : "OUTPUT_PURPOSE_NOT_ALLOWED",
      message: `${purpose} requires a design version that is ${rule.designStatuses.join(" / ")} (design version is ${designStatus})`,
    });
  }
  if (rule.requiresZeroBlockers && blockerCount > 0) out.push({ code: "VALIDATION_BLOCKERS", message: `${purpose} requires 0 BLOCKERs (${String(blockerCount)} BLOCKER(s))` });
  return out;
}

/** Only FOR_PRODUCTION quotations and drawings can be issued. */
export function qualifiesForIssue(kind: SnapshotKind, purpose: OutputPurpose): boolean {
  return outputPurposeRule(kind, purpose)?.qualifiesForIssue === true;
}

/** Only a FOR_PRODUCTION manufacturing document can satisfy production release. */
export function qualifiesForRelease(kind: SnapshotKind, purpose: OutputPurpose): boolean {
  return outputPurposeRule(kind, purpose)?.qualifiesForRelease === true;
}

/**
 * A stored output's purpose can never change — not upgraded (PRELIMINARY / FOR_REVIEW → FOR_PRODUCTION) and not
 * downgraded. The API answers every such request with RECORD_IMMUTABLE; the caller generates a new snapshot instead.
 */
export function purposeChangeDecision(from: OutputPurpose, to: OutputPurpose): { readonly allowed: false; readonly code: "RECORD_IMMUTABLE"; readonly message: string } {
  return { allowed: false, code: "RECORD_IMMUTABLE", message: `a ${from} output cannot become ${to}; generate a new ${to} snapshot that meets its own rule` };
}
