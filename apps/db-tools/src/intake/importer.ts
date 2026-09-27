/**
 * The database phase of a reference-data intake (M6 G2). It writes ONE new DRAFT version, as the named author, through
 * the API role and its row-level security — never as the owner — so the existing authorisation applies unchanged:
 * the author must be an ACTIVE internal member of the organization holding the type's author action. Every row is
 * written in one transaction and lands in the hash-chained audit log with the author as actor and a reason naming the
 * operator and the file hash. Nothing is ever approved here.
 */
import { createHash } from "node:crypto";
import type { Appliance, ConstructionRecipe, ConstructionStandard, EdgeBand, EdgeBandStandard, Finish, HardwareRuleSet, Material, PlanningStandard, PricingRuleSet, ProductDefinition, QuotationPolicy, RateCard } from "@lintel/types";
import type { HettichProductionDataset } from "@lintel/hettich-engine";
import type { VersionMeta } from "@lintel/persistence";
import {
  applianceToRow, constructionStandardToRows, contentHash, edgeBandStandardToRows, edgeBandToRow, finishToRow, hardwareRuleSetToRows, hettichDatasetToRows, materialToRow, planningStandardToRows,
  pricingStandardToRows, productToRow, quotationPolicyToRows, recipeToRow,
} from "@lintel/persistence";
import type pg from "pg";
import type { Migration } from "../migrations.js";
import { status as migrationStatus } from "../runner.js";
import type { CatalogData, Finding, IntakeType, Validated } from "./spec.js";
import { CATALOG_MEMBERS, sortFindings } from "./spec.js";

/** Version table and entity table of each type (the existing schema; a test asserts them against design_os.versioned_table). */
export const TABLES: Readonly<Record<IntakeType | "hardware_item", { readonly version: string; readonly entity: string }>> = {
  construction_standard: { version: "construction_standard_version", entity: "construction_standard" },
  planning_standard: { version: "planning_standard_version", entity: "planning_standard" },
  edge_band_standard: { version: "edge_band_standard_version", entity: "edge_band_standard" },
  material: { version: "material_version", entity: "material" },
  edge_band: { version: "edge_band_version", entity: "edge_band" },
  finish: { version: "finish_version", entity: "finish" },
  hardware_item: { version: "hardware_item_version", entity: "hardware_item" },
  hardware_rule_set: { version: "hardware_rule_set_version", entity: "hardware_rule_set" },
  appliance: { version: "appliance_version", entity: "appliance" },
  construction_recipe: { version: "recipe_version", entity: "construction_recipe" },
  product: { version: "product_version", entity: "product" },
  material_catalog: { version: "material_catalog_version", entity: "material_catalog" },
  finish_catalog: { version: "finish_catalog_version", entity: "finish_catalog" },
  hardware_catalog: { version: "hardware_catalog_version", entity: "hardware_catalog" },
  appliance_catalog: { version: "appliance_catalog_version", entity: "appliance_catalog" },
  product_catalog: { version: "product_catalog_version", entity: "product_catalog" },
  hettich_dataset: { version: "hettich_dataset_version", entity: "hettich_dataset" },
  pricing_standard: { version: "pricing_standard_version", entity: "pricing_standard" },
  quotation_policy: { version: "quotation_policy_version", entity: "quotation_policy" },
};

export interface Actor {
  readonly orgId: string;
  readonly userId: string;
  readonly email: string;
}

export type ImportOutcome = "CREATED" | "WOULD_CREATE" | "UNCHANGED" | "REFUSED";

export interface ImportSummary {
  readonly outcome: ImportOutcome;
  readonly type: IntakeType;
  readonly entityCode: string;
  readonly versionNumber: number;
  readonly intent: string;
  readonly entityId: string | null;
  readonly versionId: string | null;
  readonly contentHash: string | null;
  readonly fileHash: string;
  readonly author: string | null;
  readonly operator: string;
  /** Rows written (or that would be written), per table, in write order. */
  readonly rows: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
}

/** A stable UUID derived from its parts, so the same intake always produces the same ids (deterministic re-import). */
export function stableUuid(...parts: readonly string[]): string {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

function refused(v: Validated, operator: string, author: string | null, findings: readonly Finding[]): ImportSummary {
  return {
    outcome: "REFUSED", type: v.file.type, entityCode: v.file.entityCode, versionNumber: v.file.versionNumber, intent: v.file.intent,
    entityId: null, versionId: null, contentHash: null, fileHash: v.fileHash, author, operator, rows: {}, findings: sortFindings([...v.findings, ...findings]),
  };
}

const f = (code: string, path: string, message: string): Finding => ({ level: "ERROR", code, path, message });

/** Resolve an active internal member of an organization by email (as the owner; the only lookup that is not RLS-bounded). */
export async function resolveActor(client: pg.ClientBase, orgCode: string, email: string): Promise<Actor | null> {
  await client.query("SET LOCAL ROLE design_os_owner");
  const r = await client.query<{ org_id: string; user_id: string; email: string }>(`SELECT o.id AS org_id, u.id AS user_id, u.email
    FROM design_os.organization o JOIN design_os.org_membership m ON m.org_id = o.id JOIN design_os.app_user u ON u.id = m.user_id
    WHERE o.code = $1 AND o.status = 'ACTIVE' AND lower(u.email) = lower($2) AND u.identity_kind = 'INTERNAL' AND u.status = 'ACTIVE' AND m.status = 'ACTIVE' LIMIT 1`, [orgCode, email]);
  await client.query("RESET ROLE");
  const row = r.rows[0];
  return row === undefined ? null : { orgId: row.org_id, userId: row.user_id, email: row.email };
}

/** Act as a verified member through the API role: row-level security and the definer functions apply from here on. */
export async function actAs(client: pg.ClientBase, actor: Actor): Promise<void> {
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor.userId, org_id: actor.orgId })]);
  await client.query("SET LOCAL ROLE design_os_api");
}

async function authorAction(client: pg.ClientBase, type: string): Promise<string> {
  const r = await client.query<{ a: string }>("SELECT author_action AS a FROM design_os.versioned_table WHERE subject_type = $1", [type]);
  return r.rows[0]?.a ?? "";
}

interface ExistingVersion {
  readonly id: string;
  readonly version_number: number;
  readonly content_hash: string;
  readonly status: string;
}

/** The exact version ids a file depends on, or findings when they are missing (or not APPROVED / LOCKED for a production candidate). */
async function resolveVersion(client: pg.ClientBase, type: string, code: string, n: number, candidate: boolean, path: string, out: Finding[]): Promise<{ entityId: string; versionId: string } | null> {
  const t = TABLES[type as IntakeType];
  const r = await client.query<{ entity_id: string; id: string; status: string }>(
    `SELECT v.entity_id, v.id, v.status::text AS status FROM design_os.${t.version} v JOIN design_os.${t.entity} e ON e.id = v.entity_id AND e.org_id = v.org_id
     WHERE e.org_id = design_os.current_org_id() AND e.code = $1 AND v.version_number = $2`, [code, n]);
  const row = r.rows[0];
  if (row === undefined) {
    out.push(f("DEPENDENCY_MISSING", path, `${type} ${code} version ${String(n)} does not exist in this organization`));
    return null;
  }
  if (candidate && row.status !== "APPROVED" && row.status !== "LOCKED") out.push(f("DEPENDENCY_NOT_APPROVED", path, `${type} ${code} version ${String(n)} is ${row.status}; a production candidate depends only on APPROVED / LOCKED versions`));
  return { entityId: row.entity_id, versionId: row.id };
}

/** Row objects of the persistence mappers (column name → value). */
type Row = object;
interface Built {
  readonly version: Row & { readonly content_hash: string };
  readonly children: readonly { readonly table: string; readonly rows: readonly Row[] }[];
}

async function build(client: pg.ClientBase, v: Validated, meta: VersionMeta, orgId: string, out: Finding[]): Promise<Built | null> {
  const file = v.file;
  // `data` passed the strict schema of its type in validateIntake (./schemas.ts mirrors the domain types exactly).
  const data: unknown = file.data;
  const ctx = { orgId };
  const candidate = file.intent === "PRODUCTION_CANDIDATE";
  switch (file.type) {
    case "construction_standard": {
      const r = constructionStandardToRows(data as ConstructionStandard, meta, ctx, file.provenance ?? {});
      return { version: r.version, children: [{ table: "construction_standard_value", rows: r.values }] };
    }
    case "planning_standard": {
      const r = planningStandardToRows(data as PlanningStandard, meta, ctx, file.provenance ?? {});
      return { version: r.version, children: [{ table: "planning_standard_value", rows: r.values }] };
    }
    case "edge_band_standard": {
      const r = edgeBandStandardToRows(data as EdgeBandStandard, meta, ctx);
      // Every banded edge names a catalog edge band; for a production candidate it must have an APPROVED / LOCKED version.
      for (const code of [...new Set(r.rules.flatMap((x) => (x.edge_band_id === null ? [] : [x.edge_band_id])))].sort()) {
        const e = await client.query<{ usable: boolean }>(`SELECT EXISTS (SELECT 1 FROM design_os.edge_band_version v WHERE v.entity_id = e.id AND v.status IN ('APPROVED', 'LOCKED')) AS usable
          FROM design_os.edge_band e WHERE e.org_id = design_os.current_org_id() AND e.code = $1`, [code]);
        const row = e.rows[0];
        if (row === undefined) out.push(f("DEPENDENCY_MISSING", "$.data.ruleSets", `edge band ${code} does not exist in this organization`));
        else if (candidate && !row.usable) out.push(f("DEPENDENCY_NOT_APPROVED", "$.data.ruleSets", `edge band ${code} has no APPROVED / LOCKED version`));
      }
      return { version: r.version, children: [{ table: "edge_band_rule_set", rows: r.ruleSets }, { table: "edge_band_rule", rows: r.rules }] };
    }
    case "material": return { version: materialToRow(data as Material, meta, ctx), children: [] };
    case "edge_band": return { version: edgeBandToRow(data as EdgeBand, meta, ctx), children: [] };
    case "finish": return { version: finishToRow(data as Finish, meta, ctx), children: [] };
    case "appliance": return { version: applianceToRow(data as Appliance, meta, ctx), children: [] };
    case "hardware_rule_set": {
      const r = hardwareRuleSetToRows(data as HardwareRuleSet, meta, ctx, file.source);
      return { version: r.version, children: [{ table: "hardware_rule", rows: r.rules }] };
    }
    case "construction_recipe": return { version: recipeToRow(data as ConstructionRecipe, meta, ctx, file.source), children: [] };
    case "product": {
      if (file.recipe === undefined) return null;
      const recipe = await resolveVersion(client, "construction_recipe", file.recipe.entityCode, file.recipe.versionNumber, candidate, "$.recipe", out);
      if (recipe === null) return null;
      return { version: productToRow(data as ProductDefinition, meta, { orgId, recipeVersionId: recipe.versionId }, file.source), children: [] };
    }
    case "hettich_dataset": {
      const r = hettichDatasetToRows(data as HettichProductionDataset, meta, ctx, file.source);
      return { version: r.version, children: [{ table: "hettich_article", rows: r.articles }, { table: "hettich_calculation_rule", rows: r.calculationRules }] };
    }
    case "pricing_standard": {
      const p = data as { rateCard: RateCard; rules: PricingRuleSet };
      if (candidate) {
        for (const [table, rates] of [["material", p.rateCard.boardPerM2], ["edge_band", p.rateCard.edgeBandPerM], ["finish", p.rateCard.finishPerM2]] as const) {
          for (const code of Object.keys(rates).sort()) {
            const e = await client.query(`SELECT 1 FROM design_os.${table} WHERE org_id = design_os.current_org_id() AND code = $1`, [code]);
            if (e.rowCount === 0) out.push(f("DEPENDENCY_MISSING", "$.data.rateCard", `${table} ${code} has a rate but does not exist in this organization`));
          }
        }
      }
      const r = pricingStandardToRows(file.entityCode, p, meta, ctx);
      return { version: r.version, children: [{ table: "rate_card_line", rows: r.rateLines }] };
    }
    case "quotation_policy": {
      const r = quotationPolicyToRows(data as QuotationPolicy, meta, ctx);
      return { version: r.version, children: [{ table: "tax_rate", rows: r.taxRates }, { table: "tax_rate_mapping", rows: r.taxRateMappings }] };
    }
    case "material_catalog":
    case "finish_catalog":
    case "hardware_catalog":
    case "appliance_catalog":
    case "product_catalog": {
      const c = data as CatalogData;
      const domain = file.type.replace(/_catalog$/, "");
      const members = [...c.members].sort((a, b) => `${a.itemType}:${a.entityCode}:${String(a.versionNumber)}`.localeCompare(`${b.itemType}:${b.entityCode}:${String(b.versionNumber)}`));
      const rows: Record<string, Record<string, unknown>[]> = {};
      for (const [i, m] of members.entries()) {
        const dep = await resolveVersion(client, m.itemType, m.entityCode, m.versionNumber, candidate, `$.data.members.${String(i)}`, out);
        if (dep === null) continue;
        (rows[m.itemType] ??= []).push({ org_id: orgId, catalog_version_id: meta.versionId, [`${m.itemType}_id`]: dep.entityId, [`${m.itemType}_version_id`]: dep.versionId });
      }
      const version = {
        org_id: orgId, entity_code: file.entityCode, id: meta.versionId, entity_id: meta.entityId, description: c.description, version_number: meta.versionNumber, version_label: c.versionLabel,
        status: "DRAFT", data_classification: "PRODUCTION", source: file.source, source_ref: meta.sourceRef, change_reason: meta.changeReason, created_by: meta.createdBy,
        content_hash: contentHash({ type: file.type, description: c.description, versionLabel: c.versionLabel, members: members.map((m) => ({ itemType: m.itemType, entityCode: m.entityCode, versionNumber: m.versionNumber })) }),
      };
      return { version, children: CATALOG_MEMBERS[file.type].map((item) => ({ table: `${domain}_catalog_version_${item}`, rows: rows[item] ?? [] })) };
    }
  }
}

async function insert(client: pg.ClientBase, table: string, rowObject: Row): Promise<void> {
  const row = rowObject as Readonly<Record<string, unknown>>;
  const keys = Object.keys(row).filter((k) => k !== "entity_code" && k !== "created_at");
  const values = keys.map((k) => {
    const x = row[k];
    return x !== null && typeof x === "object" ? JSON.stringify(x) : x;
  });
  await client.query(`INSERT INTO design_os.${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${String(i + 1)}`).join(", ")})`, values);
}

export interface ImportOptions {
  readonly orgCode: string;
  readonly authorEmail: string;
  readonly operator: string;
  readonly dryRun: boolean;
}

/** Import one validated intake file as a new DRAFT version. Refusals write nothing. */
export async function importIntake(client: pg.ClientBase, migrations: readonly Migration[], v: Validated, o: ImportOptions): Promise<ImportSummary> {
  if (!v.accepted) return refused(v, o.operator, null, [f("VALIDATION_FAILED", "$", "the file did not pass validation; nothing was written")]);
  const ms = await migrationStatus(client, migrations);
  if (ms.state !== "UP_TO_DATE") return refused(v, o.operator, null, [f("MIGRATIONS_NOT_CURRENT", "$", `migrations are ${ms.state}`)]);
  const file = v.file;
  const t = TABLES[file.type];

  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('design_os.reason', $1, true), set_config('design_os.request_id', $2, true)",
      [`reference-data intake ${file.type} ${file.entityCode} v${String(file.versionNumber)} (${file.intent}) file ${v.fileHash} by operator ${o.operator}`, `intake:${v.fileHash}`]);
    const actor = await resolveActor(client, o.orgCode, o.authorEmail);
    if (actor === null) {
      await client.query("ROLLBACK");
      return refused(v, o.operator, null, [f("AUTHOR_NOT_MEMBER", "--as", `${o.authorEmail} is not an active internal member of organization ${o.orgCode}`)]);
    }
    const action = await authorAction(client, file.type);
    await actAs(client, actor);
    const can = await client.query<{ ok: boolean }>("SELECT design_os.has_permission($1) AS ok", [action]);
    if (can.rows[0]?.ok !== true) {
      await client.query("ROLLBACK");
      return refused(v, o.operator, actor.email, [f("AUTHOR_NOT_PERMITTED", "--as", `${actor.email} does not hold ${action} in ${o.orgCode}`)]);
    }
    // Serialize intakes of the same entity.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('design_os.intake:' || $1 || ':' || $2 || ':' || $3, 0))", [actor.orgId, file.type, file.entityCode]);

    const entity = await client.query<{ id: string }>(`SELECT id FROM design_os.${t.entity} WHERE org_id = design_os.current_org_id() AND code = $1`, [file.entityCode]);
    const entityId = entity.rows[0]?.id ?? stableUuid(actor.orgId, file.type, file.entityCode);
    const existing = entity.rows[0] === undefined ? [] : (await client.query<ExistingVersion>(
      `SELECT id, version_number, content_hash, status::text AS status FROM design_os.${t.version} WHERE org_id = design_os.current_org_id() AND entity_id = $1 ORDER BY version_number`, [entityId])).rows;
    const versionId = existing.find((x) => x.version_number === file.versionNumber)?.id ?? stableUuid(actor.orgId, file.type, file.entityCode, String(file.versionNumber));

    const meta: VersionMeta = {
      entityId, versionId, versionNumber: file.versionNumber, status: "DRAFT", sourceRef: file.sourceRef, changeReason: file.changeReason, createdBy: actor.userId,
      createdAt: "1970-01-01T00:00:00.000Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, effectiveFrom: null, lockedBy: null, lockedAt: null, supersededBy: null, supersededAt: null,
    };
    const problems: Finding[] = [];
    const built = await build(client, v, meta, actor.orgId, problems);
    const summary = (outcome: ImportOutcome, rows: Record<string, number>, hash: string | null): ImportSummary => ({
      outcome, type: file.type, entityCode: file.entityCode, versionNumber: file.versionNumber, intent: file.intent, entityId, versionId, contentHash: hash,
      fileHash: v.fileHash, author: actor.email, operator: o.operator, rows, findings: sortFindings([...v.findings, ...problems]),
    });
    if (built === null || problems.length > 0) {
      await client.query("ROLLBACK");
      return { ...summary("REFUSED", {}, null), entityId: null, versionId: null };
    }
    const hash = built.version.content_hash;

    // Version identity: the same number with the same content is a no-op; anything else is refused.
    const same = existing.find((x) => x.version_number === file.versionNumber);
    if (same !== undefined) {
      await client.query("ROLLBACK");
      if (same.content_hash === hash) return summary("UNCHANGED", {}, hash);
      return { ...summary("REFUSED", {}, hash), findings: sortFindings([...v.findings, f("VERSION_CONFLICT", "$.versionNumber", `version ${String(file.versionNumber)} already exists with different content (${same.content_hash}); a change is a new version`)]) };
    }
    const dupe = existing.find((x) => x.content_hash === hash);
    if (dupe !== undefined) {
      await client.query("ROLLBACK");
      return { ...summary("REFUSED", {}, hash), findings: sortFindings([...v.findings, f("DUPLICATE_CONTENT", "$.data", `the same content already exists as version ${String(dupe.version_number)}`)]) };
    }
    const next = (existing.at(-1)?.version_number ?? 0) + 1;
    if (file.versionNumber !== next) {
      await client.query("ROLLBACK");
      return { ...summary("REFUSED", {}, hash), findings: sortFindings([...v.findings, f("VERSION_NOT_NEXT", "$.versionNumber", `the next version of ${file.entityCode} is ${String(next)}`)]) };
    }

    const rows: Record<string, number> = {};
    if (entity.rows[0] === undefined) {
      await client.query(`INSERT INTO design_os.${t.entity} (id, org_id, code) VALUES ($1, $2, $3)`, [entityId, actor.orgId, file.entityCode]);
      rows[t.entity] = 1;
    }
    await insert(client, t.version, built.version);
    rows[t.version] = 1;
    for (const c of built.children) {
      for (const r of c.rows) await insert(client, c.table, r);
      rows[c.table] = c.rows.length;
    }
    // Read back what the database holds: DRAFT, PRODUCTION, the computed content hash, the author.
    const back = await client.query<{ status: string; data_classification: string; content_hash: string; created_by: string }>(
      `SELECT status::text AS status, data_classification, content_hash, created_by FROM design_os.${t.version} WHERE id = $1`, [versionId]);
    const b = back.rows[0];
    if (b?.status !== "DRAFT" || b.data_classification !== "PRODUCTION" || b.content_hash !== hash || b.created_by !== actor.userId) throw new Error("read-back of the imported version does not match");
    if (o.dryRun) {
      await client.query("ROLLBACK");
      return summary("WOULD_CREATE", rows, hash);
    }
    await client.query("COMMIT");
    return summary("CREATED", rows, hash);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
