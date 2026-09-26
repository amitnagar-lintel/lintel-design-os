import { z } from "zod";
import { LifecycleStatus, PageQuery, Sha256Hash, Uuid } from "../../common/http/schemas.js";

/**
 * The reference-data types the read API exposes: every versioned standard, catalog item, catalog and Hettich dataset
 * of the existing architecture (design_os.versioned_table), except design versions (their own API) and the
 * ManufacturingStandard (Phase 2). A database test asserts the list against the registry.
 */
export const REFERENCE_TYPES = [
  "construction_standard", "planning_standard", "edge_band_standard",
  "material", "edge_band", "finish", "hardware_item", "hardware_rule_set", "appliance", "construction_recipe", "product",
  "material_catalog", "finish_catalog", "hardware_catalog", "appliance_catalog", "product_catalog",
  "hettich_dataset", "pricing_standard", "quotation_policy",
] as const;
export const ReferenceType = z.enum(REFERENCE_TYPES);
export type ReferenceType = z.infer<typeof ReferenceType>;

export const TypeParam = z.strictObject({ type: ReferenceType });
export const VersionParams = z.strictObject({ type: ReferenceType, versionId: Uuid });
export const HettichVersionParams = z.strictObject({ versionId: Uuid });

const Code = z.string().trim().min(1).max(100);
/** Comma-separated lifecycle statuses, e.g. `APPROVED,LOCKED` (exact statuses; never collapsed). */
const StatusList = z.string().trim().transform((s, ctx) => {
  const parts = [...new Set(s.split(",").map((p) => p.trim()).filter((p) => p !== ""))].sort();
  for (const p of parts) {
    if (!LifecycleStatus.safeParse(p).success) {
      ctx.addIssue({ code: "custom", message: `unknown status ${p}` });
      return z.NEVER;
    }
  }
  if (parts.length === 0) {
    ctx.addIssue({ code: "custom", message: "at least one status" });
    return z.NEVER;
  }
  return parts as z.infer<typeof LifecycleStatus>[];
});

export const EntityListQuery = PageQuery.extend({ code: Code.optional() }).strict();
export type EntityListQuery = z.infer<typeof EntityListQuery>;
export const VersionListQuery = PageQuery.extend({ entityCode: Code.optional(), entityId: Uuid.optional(), status: StatusList.optional() }).strict();
export type VersionListQuery = z.infer<typeof VersionListQuery>;
export const ArticleListQuery = PageQuery.extend({ category: z.enum(["HINGE", "MOUNTING_PLATE"]).optional() }).strict();
export type ArticleListQuery = z.infer<typeof ArticleListQuery>;

export const ReferenceTypeInfo = z.strictObject({
  type: ReferenceType,
  authorAction: z.string(),
  approveAction: z.string(),
  /** An extra action needed to read the content (PricingStandard rates: `output.read.cost`); null when `reference.read` suffices. */
  contentAction: z.string().nullable(),
});
export const ReferenceTypeList = z.strictObject({ items: z.array(ReferenceTypeInfo) });
export type ReferenceTypeList = z.infer<typeof ReferenceTypeList>;

const SourceRef = z.record(z.string(), z.unknown()).nullable();
const VersionSummary = z.strictObject({ id: Uuid, versionNumber: z.number().int(), versionLabel: z.string().nullable(), status: LifecycleStatus });

export const ReferenceEntity = z.strictObject({
  type: ReferenceType,
  id: Uuid,
  code: z.string(),
  createdAt: z.string(),
  versionCount: z.number().int(),
  latestVersion: VersionSummary.nullable(),
  /** APPROVED or LOCKED versions, newest first: the candidates for an exact pin. */
  usableVersions: z.array(VersionSummary),
});
export type ReferenceEntity = z.infer<typeof ReferenceEntity>;

/** The version envelope: identity, lifecycle, effective metadata and provenance (M5 §2.1). */
export const ReferenceVersion = z.strictObject({
  type: ReferenceType,
  id: Uuid,
  entityId: Uuid,
  entityCode: z.string(),
  versionNumber: z.number().int(),
  versionLabel: z.string().nullable(),
  status: LifecycleStatus,
  /** Always PRODUCTION: TEST_FIXTURE data can never be stored (database CHECK). */
  dataClassification: z.literal("PRODUCTION"),
  source: z.string(),
  sourceRef: SourceRef,
  changeReason: z.string(),
  contentHash: Sha256Hash,
  rowVersion: z.number().int(),
  createdBy: Uuid,
  createdAt: z.string(),
  submittedBy: Uuid.nullable(),
  submittedAt: z.string().nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  lockedBy: Uuid.nullable(),
  lockedAt: z.string().nullable(),
  supersededBy: Uuid.nullable(),
  supersededAt: z.string().nullable(),
});
export type ReferenceVersion = z.infer<typeof ReferenceVersion>;

export const ReferenceVersionDetail = ReferenceVersion.extend({
  /** The type's own columns, exactly as stored (NULL = NULL / UNVERIFIED; never defaulted). */
  content: z.record(z.string(), z.unknown()),
  /** The version's content rows per child table (values, rules, catalog members…), in their natural order. */
  children: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** Row counts of large child collections that are read through their own paginated routes (Hettich). */
  counts: z.record(z.string(), z.number().int()),
}).strict();
export type ReferenceVersionDetail = z.infer<typeof ReferenceVersionDetail>;

export const HettichArticle = z.record(z.string(), z.unknown());
export const HettichRule = z.record(z.string(), z.unknown());
