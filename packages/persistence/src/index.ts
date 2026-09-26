/**
 * @lintel/persistence — pure persistence adapter (M5 step 2).
 *
 * Maps engine types to database rows and back, owns the version envelope and lifecycle
 * rules, seals snapshots with SHA-256 and full provenance, and refuses TEST_FIXTURE data.
 * It has no database client: repositories (step 4) use these functions. Engines never
 * import this package; the database never calculates.
 */
export type { Sha256 } from "./hash.js";
export { contentHash, isSha256 } from "./hash.js";
export { MappingError, TestFixturePersistenceError } from "./errors.js";
export { assertNoTestFixture, assertNotTestFixture, findTestFixtureMarker } from "./fixture-guard.js";
export type { EngineCalculationStatus, EnvelopeRow, RecordLifecycleStatus, SourceRef, VersionEnvelope } from "./envelope.js";
export { engineCalculationStatus, engineVersionString, envelopeFromRow, envelopeProblems, envelopeToRow, RECORD_LIFECYCLE_STATUSES } from "./envelope.js";
export type { PinState, TransitionAction, TransitionDecision, TransitionErrorCode, TransitionRequest, TransitionResult } from "./lifecycle.js";
export { approveSuccessor, assertEditable, designVersionApprovalProblems, nextDraft, NotEditableError, transition } from "./lifecycle.js";
export type { MapContext, Versioned, VersionMeta, VersionRow } from "./mappers/common.js";
export { metaOf } from "./mappers/common.js";
export * from "./mappers/standards.js";
export * from "./mappers/pricing.js";
export * from "./mappers/catalog.js";
export * from "./mappers/hettich.js";
export * from "./mappers/design.js";
export type { AssembledCatalog, CatalogVersionRef, PinnedCatalogReleases } from "./catalog-assembly.js";
export { assembleCatalogSnapshot } from "./catalog-assembly.js";
export type {
  ChosenVersions, DependencyHashes, DependencyPin, DesignVersionRef, DrawingIdentity, DrawingType, EngineClosure, EngineName, EngineProvenance, SnapshotFile,
  SnapshotKind, SnapshotProvenance, SnapshotRecord, SnapshotRow, SnapshotSources,
} from "./provenance.js";
export {
  COMMERCIAL_PINS, ENGINE_OF_KIND, NO_CHOSEN_VERSIONS, ROOM_DRAWING_TYPES, SOURCES_OF_KIND, assertEngineProvenance, buildSnapshotProvenance, buildSnapshotRecord,
  commercialInputHash, dependencySetHash, engineeringDependencyHashes, fileManifestHash, snapshotFromRow, snapshotIdentity, snapshotToRow, verifySnapshotRecord,
} from "./provenance.js";
export type { OutputPurpose, OutputPurposeProblem, OutputPurposeProblemCode, OutputPurposeRule } from "./output-purpose.js";
export { OUTPUT_PURPOSE_RULES, OUTPUT_PURPOSES, outputPurposeProblems, outputPurposeRule, purposeChangeDecision, qualifiesForIssue, qualifiesForRelease } from "./output-purpose.js";
export type { ValidationPurpose, ValidationRunRecord } from "./validation-run.js";
export { ENGINE_BUILD, RECORD_VALIDATION_RUN_SQL, buildValidationRun, recordValidationRunArgs } from "./validation-run.js";
