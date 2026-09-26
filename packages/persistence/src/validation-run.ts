import type { ValidationResult } from "@lintel/types";
import { MappingError, TestFixturePersistenceError } from "./errors.js";
import type { Sha256 } from "./hash.js";
import { contentHash, isSha256 } from "./hash.js";

/**
 * An engine validation run as stored (M5 §4, trust boundary). The TypeScript engine is the authority for
 * validation and BLOCKERs; this record only carries its result, tied to the exact inputs it was produced
 * for. The database stamps created_by / created_at and the input revision (design_os.record_validation_run).
 */
export interface ValidationRunRecord {
  readonly designVersionId: string;
  readonly inputHash: Sha256;
  readonly engineVersion: string;
  /** The engine's own fingerprint of the validated model (e.g. the room fingerprint). */
  readonly engineHash: string;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly messages: ValidationResult["messages"];
  /** SHA-256 of the validation result. */
  readonly contentHash: Sha256;
}

/**
 * Seal an engine ValidationResult for storage. Counts come from the engine result, never recounted in SQL.
 * Results of TEST_FIXTURE inputs can never become a production validation run.
 */
export function buildValidationRun(input: {
  readonly designVersionId: string;
  readonly inputHash: Sha256;
  readonly engineVersion: string;
  readonly engineHash: string;
  readonly validation: ValidationResult;
}): ValidationRunRecord {
  if (!isSha256(input.inputHash)) throw new MappingError("inputHash must be sha256:<64 hex>");
  if (input.engineVersion.trim() === "" || input.engineHash.trim() === "") throw new MappingError("engine version and engine hash are required");
  if (input.validation.messages.some((m) => m.code === "TEST_FIXTURE_DATA_IN_USE")) {
    throw new TestFixturePersistenceError(`validation run for design version ${input.designVersionId} was produced from TEST_FIXTURE inputs`);
  }
  return {
    designVersionId: input.designVersionId,
    inputHash: input.inputHash,
    engineVersion: input.engineVersion,
    engineHash: input.engineHash,
    blockerCount: input.validation.counts.BLOCKER,
    warningCount: input.validation.counts.WARNING,
    messages: input.validation.messages,
    contentHash: contentHash({ messages: input.validation.messages, counts: input.validation.counts }),
  };
}

/** Positional arguments of design_os.record_validation_run(). */
export function recordValidationRunArgs(r: ValidationRunRecord): readonly [string, string, string, string, number, number, string, string] {
  return [r.designVersionId, r.inputHash, r.engineVersion, r.engineHash, r.blockerCount, r.warningCount, JSON.stringify(r.messages), r.contentHash];
}
