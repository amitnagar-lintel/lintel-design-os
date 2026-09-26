import { z } from "zod";
import { OutputPurpose, Sha256Hash, Uuid } from "../../common/http/schemas.js";
import { Pins, ValidationMessage } from "../design-versions/design-versions.schemas.js";

/**
 * Output generation requests (Step 6 plan revision 4 §16). A request names only the purpose, the exact commercial
 * versions it wants (Pricing / Quotation) and, to reproduce an earlier output, exact upstream snapshots. It can never
 * carry quantities, prices, rates, tax, totals, hashes, engine fields, blocker counts, createdAt, or anything that
 * means "latest": the server resolves every dependency by exact natural identity.
 */
const Base = z.strictObject({ purpose: OutputPurpose.default("PRELIMINARY") });
export const BomGenerateRequest = Base.extend({ sources: z.strictObject({}).optional() });
export const BoqGenerateRequest = Base.extend({ sources: z.strictObject({ bomSnapshotId: Uuid.optional() }).optional() });
export const PricingGenerateRequest = Base.extend({
  pricingStandardVersionId: Uuid,
  sources: z.strictObject({ bomSnapshotId: Uuid.optional(), boqSnapshotId: Uuid.optional() }).optional(),
});
export const QuotationGenerateRequest = Base.extend({
  pricingStandardVersionId: Uuid,
  quotationPolicyVersionId: Uuid,
  sources: z.strictObject({ boqSnapshotId: Uuid.optional(), pricingSnapshotId: Uuid.optional() }).optional(),
});
export type GenerateRequest = z.infer<typeof BomGenerateRequest> | z.infer<typeof BoqGenerateRequest> | z.infer<typeof PricingGenerateRequest> | z.infer<typeof QuotationGenerateRequest>;

export const SnapshotIdParam = z.strictObject({ snapshotId: Uuid });

const Kind = z.enum(["BOM", "BOQ", "PRICING", "QUOTATION"]);
const StalenessReason = z.enum(["ENGINEERING_INPUTS_CHANGED", "DEPENDENCY_CONTENT_CHANGED", "COMMERCIAL_CONTENT_CHANGED", "ENGINE_CHANGED", "SOURCE_STALE"]);
const Newer = z.strictObject({ pin: z.string(), versionId: Uuid });
export const Staleness = z.strictObject({
  stale: z.boolean(),
  reasons: z.array(StalenessReason),
  advisories: z.strictObject({ designSuperseded: z.boolean(), newerSurveyAvailable: z.boolean(), newerDependencyVersions: z.array(Newer), newerCommercialVersions: z.array(Newer) }),
});
export const Engine = z.strictObject({
  name: z.string(), version: z.string(), build: z.string(), fingerprint: Sha256Hash,
  closure: z.strictObject({ packages: z.record(z.string(), Sha256Hash), externals: z.record(z.string(), z.string()), entry: Sha256Hash, runtime: z.string() }),
});
export const SnapshotSummary = z.strictObject({ kind: Kind, id: Uuid, purpose: OutputPurpose, contentHash: Sha256Hash });

/** Every generated output's provenance envelope (plan §16). The payload is the engine result verbatim. */
export const SnapshotEnvelope = z.strictObject({
  id: Uuid,
  kind: Kind,
  purpose: OutputPurpose,
  designVersionId: Uuid,
  designVersionStatus: z.string(),
  designVersionContentHash: Sha256Hash,
  input: z.strictObject({ hash: Sha256Hash, revision: z.number().int() }),
  engineeringPins: Pins,
  commercial: z.strictObject({ pricingStandardVersionId: Uuid, quotationPolicyVersionId: Uuid.nullable(), inputHash: Sha256Hash }).nullable(),
  dependencyHashes: z.record(z.string(), Sha256Hash),
  dependencySetHash: Sha256Hash,
  validationRun: z.strictObject({ id: Uuid, purpose: z.literal("OUTPUT_GENERATION"), blockerCount: z.number().int(), warningCount: z.number().int(), engine: Engine }),
  sources: z.strictObject({ bomSnapshotId: Uuid.optional(), boqSnapshotId: Uuid.optional(), pricingSnapshotId: Uuid.optional() }),
  engine: Engine.extend({ seal: z.string().nullable() }),
  contentHash: Sha256Hash,
  blockerCount: z.number().int(),
  warningCount: z.number().int(),
  outputComplete: z.boolean(),
  dataClassification: z.literal("PRODUCTION"),
  qualifiesForIssue: z.boolean(),
  qualifiesForRelease: z.boolean(),
  revisionNumber: z.number().int().optional(),
  staleness: Staleness,
  createdBy: Uuid,
  createdAt: z.string(),
});
export type SnapshotEnvelope = z.infer<typeof SnapshotEnvelope>;
/** Payload: the engine output type (RoomBOM, RoomBOQ, RoomPriceSnapshot, QuotationSnapshot). Zod mirrors come with OpenAPI (checkpoint 3). */
export const Snapshot = SnapshotEnvelope.extend({ payload: z.unknown() });
export type Snapshot = z.infer<typeof Snapshot>;

export const GenerateResponse = z.strictObject({ status: z.literal("AVAILABLE"), snapshot: Snapshot, reused: z.boolean(), dependencies: z.array(SnapshotSummary) });
export const UnavailableResponse = z.strictObject({ status: z.literal("UNAVAILABLE"), kind: Kind, blockers: z.array(ValidationMessage), snapshot: z.null(), dependencies: z.array(SnapshotSummary) });

export const DetailedStaleness = Staleness.extend({
  /** Engine comparators on the current model (compareRoomTrace / checkQuotationStaleness). */
  model: z.strictObject({ stale: z.boolean(), reasons: z.array(z.string()), changedObjectIds: z.array(z.string()) }),
});
