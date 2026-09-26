import type { ValidationResult } from "@lintel/types";
import { MappingError, TestFixturePersistenceError } from "./errors.js";
import type { Sha256 } from "./hash.js";
import { contentHash, isSha256 } from "./hash.js";
import type { EngineProvenance } from "./provenance.js";
import { assertEngineProvenance } from "./provenance.js";

/** A build identity as design_os.validation_run and the snapshot tables accept it (0016 / 0017). */
export const ENGINE_BUILD = /^[0-9A-Za-z][0-9A-Za-z._+-]{6,127}$/;

/**
 * Why a validation run was recorded (Step 6 plan revision 4 §5):
 * - APPROVAL: SUBMIT / APPROVE evidence; recorded only for DRAFT or IN_REVIEW design versions.
 * - OUTPUT_GENERATION: evidence for one output-generation context; any design status; never changes the design.
 *   Recorded only together with the snapshot(s) that use it.
 */
export type ValidationPurpose = "APPROVAL" | "OUTPUT_GENERATION";

/**
 * An engine validation run as stored (M5 §4, trust boundary). The TypeScript engine is the authority for validation
 * and BLOCKERs; this record only carries its result, tied to the exact engineering inputs it was produced for. The
 * database stamps created_by / created_at, the input revision and the engineering dependency-set hash.
 */
export interface ValidationRunRecord {
  readonly purpose: ValidationPurpose;
  readonly designVersionId: string;
  readonly inputHash: Sha256;
  /** Which exact validation engine ran: name, semantic version, build, fingerprint and closure. */
  readonly engine: EngineProvenance;
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
  readonly purpose: ValidationPurpose;
  readonly designVersionId: string;
  readonly inputHash: Sha256;
  readonly engine: EngineProvenance;
  readonly validation: ValidationResult;
}): ValidationRunRecord {
  if (!isSha256(input.inputHash)) throw new MappingError("inputHash must be sha256:<64 hex>");
  const purpose: string = input.purpose;
  if (purpose !== "APPROVAL" && purpose !== "OUTPUT_GENERATION") throw new MappingError(`unknown validation purpose ${purpose}`);
  assertEngineProvenance(input.engine, "validation");
  if (input.validation.messages.some((m) => m.code === "TEST_FIXTURE_DATA_IN_USE")) {
    throw new TestFixturePersistenceError(`validation run for design version ${input.designVersionId} was produced from TEST_FIXTURE inputs`);
  }
  return {
    purpose: input.purpose,
    designVersionId: input.designVersionId,
    inputHash: input.inputHash,
    engine: input.engine,
    blockerCount: input.validation.counts.BLOCKER,
    warningCount: input.validation.counts.WARNING,
    messages: input.validation.messages,
    contentHash: contentHash({ messages: input.validation.messages, counts: input.validation.counts }),
  };
}

/** Positional arguments of design_os.record_validation_run() (migration 0017). */
export function recordValidationRunArgs(r: ValidationRunRecord): readonly [string, string, string, string, string, string, string, string, number, number, string, string] {
  return [
    r.purpose, r.designVersionId, r.inputHash, r.engine.name, r.engine.version, r.engine.build, r.engine.fingerprint, JSON.stringify(r.engine.closure),
    r.blockerCount, r.warningCount, JSON.stringify(r.messages), r.contentHash,
  ];
}

/** SQL of the call matching recordValidationRunArgs. */
export const RECORD_VALIDATION_RUN_SQL = "SELECT design_os.record_validation_run($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)";
