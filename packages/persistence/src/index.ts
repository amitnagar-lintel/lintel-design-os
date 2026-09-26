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
export type { EnvelopeRow, RecordStatus, SourceRef, VersionEnvelope } from "./envelope.js";
export { engineStatus, engineVersionString, envelopeFromRow, envelopeProblems, envelopeToRow, RECORD_STATUSES } from "./envelope.js";
export type { PinState, TransitionAction, TransitionDecision, TransitionErrorCode, TransitionRequest, TransitionResult } from "./lifecycle.js";
export { approveSuccessor, assertEditable, designVersionApprovalProblems, nextDraft, NotEditableError, transition } from "./lifecycle.js";
export type { MapContext, VersionMeta, VersionRow } from "./mappers/common.js";
export * from "./mappers/standards.js";
export * from "./mappers/pricing.js";
export * from "./mappers/catalog.js";
export * from "./mappers/hettich.js";
export * from "./mappers/design.js";
export type { AssembledCatalog, CatalogReleaseRef, PinnedCatalogReleases } from "./catalog-assembly.js";
export { assembleCatalogSnapshot } from "./catalog-assembly.js";
export type { SnapshotKind, SnapshotProvenance, SnapshotRecord, SnapshotRow } from "./provenance.js";
export { buildSnapshotProvenance, buildSnapshotRecord, provenanceMismatches, snapshotFromRow, snapshotToRow, verifySnapshotRecord } from "./provenance.js";
