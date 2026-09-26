/**
 * Test world for database tests: an organization with one user per role, a second tenant, and builders that
 * write versioned records through the @lintel/persistence mappers (the same rows the API will write).
 *
 * Approval requires complete, sourced values. Where a test needs an APPROVED standard, the builders use
 * clearly labelled SYNTHETIC values that exist only inside a rolled-back test transaction. They are not
 * Lintel values, are never committed, and are never used outside tests/db.
 */
import { randomUUID } from "node:crypto";
import type { ConstructionStandard, PlanningStandard, PricingRuleSet, QuotationPolicy, RateCard } from "@lintel/types";
import {
  KIT_BASE_STANDARD,
  KITCHEN_BASE_STANDARD_V1,
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  LINTEL_PLANNING_STANDARD_DRAFT,
} from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET } from "@lintel/hettich-engine";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_RATE_CARD } from "@lintel/pricing-engine";
import type { RecordLifecycleStatus, ValueProvenance, VersionMeta } from "@lintel/persistence";
import {
  constructionStandardToRows,
  contentHash,
  edgeBandStandardToRows,
  edgeBandToRow,
  finishToRow,
  hardwareRuleSetToRows,
  hettichDatasetToRows,
  materialToRow,
  planningStandardToRows,
  pricingStandardToRows,
  productToRow,
  quotationPolicyToRows,
  recipeToRow,
} from "@lintel/persistence";
import type { Actor, Tx } from "./db.js";
import { actAs, insertRow, one } from "./db.js";

export const SYNTHETIC_SOURCE = "DB TEST ONLY — synthetic value inside a rolled-back transaction; not a Lintel value";

export type Role = "ADMIN" | "DESIGNER" | "DESIGN_HEAD" | "SALES" | "COSTING" | "FINANCE" | "PROCUREMENT" | "PRODUCTION" | "SITE_ENGINEER" | "CLIENT";
export const ROLES: readonly Role[] = ["ADMIN", "DESIGNER", "DESIGN_HEAD", "SALES", "COSTING", "FINANCE", "PROCUREMENT", "PRODUCTION", "SITE_ENGINEER", "CLIENT"];

export interface World {
  readonly org: string;
  readonly users: Readonly<Record<Role, string>>;
  readonly actor: (role: Role) => Actor;
}

export async function createUser(c: Tx, email: string, kind: "INTERNAL" | "CLIENT"): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
  await c.query("INSERT INTO design_os.app_user (id, email, display_name, identity_kind) VALUES ($1, $2, $2, $3)", [id, email, kind]);
  return id;
}

/** Organization + one member per internal role (+ a CLIENT identity with a CLIENT membership). */
export async function createWorld(c: Tx, code = `ORG_${randomUUID().slice(0, 8)}`): Promise<World> {
  await actAs(c, null);
  const org = (await one<{ id: string }>(c, "INSERT INTO design_os.organization (code, name) VALUES ($1, $1) RETURNING id", [code])).id;
  const users = {} as Record<Role, string>;
  for (const role of ROLES) {
    const id = await createUser(c, `${role.toLowerCase()}.${code.toLowerCase()}@example.test`, role === "CLIENT" ? "CLIENT" : "INTERNAL");
    users[role] = id;
    await c.query("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, $3)", [org, id, role]);
  }
  return { org, users, actor: (role) => ({ userId: users[role], orgId: org }) };
}

export function meta(w: World, author: Role, over: Partial<VersionMeta> = {}): VersionMeta {
  return {
    entityId: randomUUID(),
    versionId: randomUUID(),
    versionNumber: 1,
    status: "DRAFT",
    sourceRef: null,
    changeReason: "DB test version",
    createdBy: w.users[author],
    createdAt: "2026-09-26T10:00:00.000Z",
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    effectiveFrom: null,
    lockedBy: null,
    lockedAt: null,
    supersededBy: null,
    supersededAt: null,
    ...over,
  };
}

/** Version rows carry the entity code for convenience; the column lives on the entity table. */
function strip<T extends { entity_code?: string }>(row: T): Omit<T, "entity_code"> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.entity_code;
  return copy as Omit<T, "entity_code">;
}

async function entity(c: Tx, table: string, org: string, id: string, code: string): Promise<void> {
  await c.query(`INSERT INTO design_os.${table} (id, org_id, code) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [id, org, code]);
}

/** Who authors / approves each subject type (default grants, M5 §9). Author ≠ approver person (D8). */
export const AUTHOR: Readonly<Record<string, readonly [Role, Role]>> = {
  construction_standard: ["PRODUCTION", "DESIGN_HEAD"],
  planning_standard: ["PRODUCTION", "DESIGN_HEAD"],
  edge_band_standard: ["PRODUCTION", "DESIGN_HEAD"],
  manufacturing_standard: ["PRODUCTION", "DESIGN_HEAD"],
  pricing_standard: ["COSTING", "FINANCE"],
  quotation_policy: ["COSTING", "FINANCE"],
  material: ["PROCUREMENT", "DESIGN_HEAD"],
  edge_band: ["PROCUREMENT", "DESIGN_HEAD"],
  material_catalog: ["PROCUREMENT", "DESIGN_HEAD"],
  finish: ["PROCUREMENT", "DESIGN_HEAD"],
  finish_catalog: ["PROCUREMENT", "DESIGN_HEAD"],
  hardware_item: ["PROCUREMENT", "PRODUCTION"],
  hardware_rule_set: ["PROCUREMENT", "PRODUCTION"],
  hardware_catalog: ["PROCUREMENT", "PRODUCTION"],
  appliance: ["PROCUREMENT", "DESIGN_HEAD"],
  appliance_catalog: ["PROCUREMENT", "DESIGN_HEAD"],
  construction_recipe: ["DESIGN_HEAD", "PRODUCTION"],
  product: ["DESIGN_HEAD", "PRODUCTION"],
  product_catalog: ["DESIGN_HEAD", "PRODUCTION"],
  hettich_dataset: ["PROCUREMENT", "PRODUCTION"],
  design: ["DESIGNER", "DESIGN_HEAD"],
};

export async function transition(c: Tx, w: World, role: Role, subject: string, id: string, action: string, reason = `${action} in DB test`, hash?: string): Promise<RecordLifecycleStatus> {
  await actAs(c, w.actor(role));
  const r = await one<{ s: RecordLifecycleStatus }>(c, "SELECT design_os.transition($1, $2, $3, $4, $5) AS s", [subject, id, action, reason, hash ?? null]);
  await actAs(c, null);
  return r.s;
}

export async function statusOf(c: Tx, subject: string, id: string): Promise<RecordLifecycleStatus> {
  await actAs(c, null);
  const t = (await one<{ t: string }>(c, "SELECT version_table::text AS t FROM design_os.versioned_table WHERE subject_type = $1", [subject])).t;
  return (await one<{ status: RecordLifecycleStatus }>(c, `SELECT status FROM ${t} WHERE id = $1`, [id])).status;
}

export async function hashOf(c: Tx, subject: string, id: string): Promise<string> {
  await actAs(c, null);
  const t = (await one<{ t: string }>(c, "SELECT version_table::text AS t FROM design_os.versioned_table WHERE subject_type = $1", [subject])).t;
  return (await one<{ h: string }>(c, `SELECT content_hash AS h FROM ${t} WHERE id = $1`, [id])).h;
}

/** SUBMIT by the author, APPROVE by the approver (a different person). */
export async function approve(c: Tx, w: World, subject: string, id: string): Promise<void> {
  const roles = AUTHOR[subject];
  if (roles === undefined) throw new Error(`no author/approver for ${subject}`);
  await transition(c, w, roles[0], subject, id, "SUBMIT");
  await transition(c, w, roles[1], subject, id, "APPROVE", "approved in DB test", await hashOf(c, subject, id));
}

/* ------------------------------------------------------------ standards */

const syntheticValues = (codes: readonly string[]): Record<string, ValueProvenance> =>
  Object.fromEntries(codes.map((k) => [k, { unit: "MM", source: SYNTHETIC_SOURCE, evidenceRef: null, note: "synthetic" }]));

export interface VersionOpts {
  readonly entityId?: string;
  readonly versionNumber?: number;
  /** Fill every value with a synthetic number so the version can be approved (tests only). */
  readonly complete?: boolean;
  /** A different entity code (for a second entity of the same domain in one organization). */
  readonly code?: string;
}

export async function constructionStandard(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "PRODUCTION", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const s: ConstructionStandard = o.complete === true
    ? { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, variables: Object.fromEntries(Object.keys(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables).map((k) => [k, 1])) }
    : LINTEL_CONSTRUCTION_STANDARD_DRAFT;
  const rows = constructionStandardToRows(o.code === undefined ? s : { ...s, standardId: o.code }, m, { orgId: w.org }, o.complete === true ? syntheticValues(Object.keys(s.variables)) : {});
  await entity(c, "construction_standard", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "construction_standard_version", strip(rows.version));
  for (const v of rows.values) await insertRow(c, "construction_standard_value", v);
  return m.versionId;
}

export async function planningStandard(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "PRODUCTION", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const s: PlanningStandard = o.complete === true
    ? { ...LINTEL_PLANNING_STANDARD_DRAFT, variables: Object.fromEntries(Object.keys(LINTEL_PLANNING_STANDARD_DRAFT.variables).map((k) => [k, 1])) }
    : LINTEL_PLANNING_STANDARD_DRAFT;
  const rows = planningStandardToRows(o.code === undefined ? s : { ...s, standardId: o.code }, m, { orgId: w.org }, o.complete === true ? syntheticValues(Object.keys(s.variables)) : {});
  await entity(c, "planning_standard", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "planning_standard_version", strip(rows.version));
  for (const v of rows.values) await insertRow(c, "planning_standard_value", v);
  return m.versionId;
}

export async function edgeBandStandard(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "PRODUCTION", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const rows = edgeBandStandardToRows(LINTEL_EDGE_BAND_STANDARD_DRAFT, m, { orgId: w.org });
  await entity(c, "edge_band_standard", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "edge_band_standard_version", strip(rows.version));
  for (const s of rows.ruleSets) await insertRow(c, "edge_band_rule_set", s);
  for (const r of rows.rules) await insertRow(c, "edge_band_rule", r);
  return m.versionId;
}

/** ManufacturingStandard: the variable registry is empty, so a version has no values (none are invented). */
export async function manufacturingStandard(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "PRODUCTION", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  await entity(c, "manufacturing_standard", w.org, m.entityId, "LINTEL_MANUFACTURING_STANDARD");
  await insertRow(c, "manufacturing_standard_version", {
    id: m.versionId, org_id: w.org, entity_id: m.entityId, description: "No manufacturing variables defined yet", version_number: m.versionNumber,
    source: "Pending — Lintel production team", change_reason: m.changeReason, created_by: m.createdBy, content_hash: contentHash({ values: [] }),
  });
  return m.versionId;
}

export async function pricingStandard(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "COSTING", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const rateCard: RateCard = o.complete === true
    ? { ...LINTEL_PRODUCTION_RATE_CARD, source: SYNTHETIC_SOURCE, boardPerM2: { BOARD_X: 1 }, edgeBandPerM: {}, finishPerM2: {}, hardwarePerUnit: {} }
    : LINTEL_PRODUCTION_RATE_CARD;
  const rules: PricingRuleSet = o.complete === true
    ? { ...LINTEL_PRODUCTION_PRICING_RULES, source: SYNTHETIC_SOURCE, manufacturingCost: "0", wastagePercent: { board: 1, edgeBand: 1, finish: 1 }, overheadPercent: 1, marginBasis: "MARKUP_ON_COST", marginPercent: 1, gstPercent: 1 }
    : LINTEL_PRODUCTION_PRICING_RULES;
  const rows = pricingStandardToRows("LINTEL_PRICING_STANDARD", { rateCard, rules }, m, { orgId: w.org });
  await entity(c, "pricing_standard", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "pricing_standard_version", strip(rows.version));
  for (const l of rows.rateLines) await insertRow(c, "rate_card_line", l);
  return m.versionId;
}

export async function quotationPolicy(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "COSTING", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const p: QuotationPolicy = o.complete === true
    ? { ...LINTEL_PRODUCTION_QUOTATION_POLICY, source: SYNTHETIC_SOURCE, taxRates: { RATE_X: 1 }, taxRateByProductCategory: { KITCHEN_BASE: "RATE_X" }, taxPolicy: "PER_RATE_GROUP",
        rounding: { tax: { mode: "HALF_UP", incrementPaise: 1 }, grandTotal: { mode: "HALF_UP", incrementPaise: 100 } }, discountPolicy: { mode: "NONE" } }
    : LINTEL_PRODUCTION_QUOTATION_POLICY;
  const rows = quotationPolicyToRows(p, m, { orgId: w.org });
  await entity(c, "quotation_policy", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "quotation_policy_version", strip(rows.version));
  for (const t of rows.taxRates) await insertRow(c, "tax_rate", t);
  for (const t of rows.taxRateMappings) await insertRow(c, "tax_rate_mapping", t);
  return m.versionId;
}

/* ------------------------------------------------------------ catalog items and catalog versions */

async function catalogVersion(c: Tx, w: World, domain: string, members: readonly (readonly [string, string, string])[], o: VersionOpts = {}): Promise<string> {
  const author = AUTHOR[`${domain}_catalog`]?.[0] ?? "PROCUREMENT";
  const m = meta(w, author, { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  await entity(c, `${domain}_catalog`, w.org, m.entityId, `LINTEL_${domain.toUpperCase()}_CATALOG`);
  await insertRow(c, `${domain}_catalog_version`, {
    id: m.versionId, org_id: w.org, entity_id: m.entityId, description: `${domain} catalog`, version_number: m.versionNumber, version_label: `${domain}-${m.versionNumber}`,
    source: "Lintel catalog", change_reason: m.changeReason, created_by: m.createdBy, content_hash: contentHash({ domain, members }),
  });
  for (const [item, entityId, versionId] of members) {
    await insertRow(c, `${domain}_catalog_version_${item}`, { org_id: w.org, catalog_version_id: m.versionId, [`${item}_id`]: entityId, [`${item}_version_id`]: versionId });
  }
  return m.versionId;
}

export interface Item {
  readonly entityId: string;
  readonly versionId: string;
}

export async function materialItem(c: Tx, w: World, o: VersionOpts = {}): Promise<Item> {
  const mat = LINTEL_CATALOG.materials[0];
  if (mat === undefined) throw new Error("no material");
  const m = meta(w, "PROCUREMENT", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const row = materialToRow(mat, m, { orgId: w.org });
  await entity(c, "material", w.org, m.entityId, row.entity_code);
  await insertRow(c, "material_version", strip(row));
  return { entityId: m.entityId, versionId: m.versionId };
}

export async function edgeBandItem(c: Tx, w: World): Promise<Item> {
  const band = LINTEL_CATALOG.edgeBands[0];
  if (band === undefined) throw new Error("no edge band");
  const m = meta(w, "PROCUREMENT");
  const row = edgeBandToRow(band, m, { orgId: w.org });
  await entity(c, "edge_band", w.org, m.entityId, row.entity_code);
  await insertRow(c, "edge_band_version", strip(row));
  return { entityId: m.entityId, versionId: m.versionId };
}

export async function finishItem(c: Tx, w: World): Promise<Item> {
  const f = LINTEL_CATALOG.finishes[0];
  if (f === undefined) throw new Error("no finish");
  const m = meta(w, "PROCUREMENT");
  const row = finishToRow(f, m, { orgId: w.org });
  await entity(c, "finish", w.org, m.entityId, row.entity_code);
  await insertRow(c, "finish_version", strip(row));
  return { entityId: m.entityId, versionId: m.versionId };
}

export async function hardwareRuleSetItem(c: Tx, w: World): Promise<Item> {
  const h = LINTEL_CATALOG.hardwareRuleSets[0];
  if (h === undefined) throw new Error("no hardware rule set");
  const m = meta(w, "PROCUREMENT");
  const rows = hardwareRuleSetToRows(h, m, { orgId: w.org }, "Lintel catalog");
  await entity(c, "hardware_rule_set", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "hardware_rule_set_version", strip(rows.version));
  for (const r of rows.rules) await insertRow(c, "hardware_rule", r);
  return { entityId: m.entityId, versionId: m.versionId };
}

export async function recipeAndProduct(c: Tx, w: World): Promise<{ recipe: Item; product: Item }> {
  const rm = meta(w, "DESIGN_HEAD");
  const recipeRow = recipeToRow(KITCHEN_BASE_STANDARD_V1, rm, { orgId: w.org }, "Lintel catalog");
  await entity(c, "construction_recipe", w.org, rm.entityId, recipeRow.entity_code);
  await insertRow(c, "recipe_version", strip(recipeRow));
  const pm = meta(w, "DESIGN_HEAD");
  const productRow = productToRow(KIT_BASE_STANDARD, pm, { orgId: w.org, recipeVersionId: rm.versionId }, "Lintel catalog");
  await entity(c, "product", w.org, pm.entityId, productRow.entity_code);
  await insertRow(c, "product_version", strip(productRow));
  return { recipe: { entityId: rm.entityId, versionId: rm.versionId }, product: { entityId: pm.entityId, versionId: pm.versionId } };
}

export async function hettichDataset(c: Tx, w: World, o: VersionOpts = {}): Promise<string> {
  const m = meta(w, "PROCUREMENT", { ...(o.entityId === undefined ? {} : { entityId: o.entityId }), versionNumber: o.versionNumber ?? 1 });
  const rows = hettichDatasetToRows(HETTICH_PRODUCTION_DATASET, m, { orgId: w.org }, "Hettich intake (no verified records yet)");
  await entity(c, "hettich_dataset", w.org, m.entityId, rows.version.entity_code);
  await insertRow(c, "hettich_dataset_version", strip(rows.version));
  return m.versionId;
}

/* ------------------------------------------------------------ the 12 pins */

export interface Pins {
  readonly construction_standard_version_id: string;
  readonly planning_standard_version_id: string;
  readonly edge_band_standard_version_id: string;
  readonly manufacturing_standard_version_id: string | null;
  readonly pricing_standard_version_id: string | null;
  readonly quotation_policy_version_id: string | null;
  readonly material_catalog_version_id: string;
  readonly finish_catalog_version_id: string;
  readonly hardware_catalog_version_id: string;
  readonly appliance_catalog_version_id: string | null;
  readonly product_catalog_version_id: string;
  readonly hettich_dataset_version_id: string;
}

export const PIN_SUBJECT: Readonly<Record<keyof Pins, string>> = {
  construction_standard_version_id: "construction_standard",
  planning_standard_version_id: "planning_standard",
  edge_band_standard_version_id: "edge_band_standard",
  manufacturing_standard_version_id: "manufacturing_standard",
  pricing_standard_version_id: "pricing_standard",
  quotation_policy_version_id: "quotation_policy",
  material_catalog_version_id: "material_catalog",
  finish_catalog_version_id: "finish_catalog",
  hardware_catalog_version_id: "hardware_catalog",
  appliance_catalog_version_id: "appliance_catalog",
  product_catalog_version_id: "product_catalog",
  hettich_dataset_version_id: "hettich_dataset",
};

export interface Dependencies {
  readonly pins: Pins;
  readonly items: Readonly<Record<string, Item>>;
}

/** Every dependency version (all 12 pins), each APPROVED via the transition function unless `approveAll` is false. */
export async function dependencies(c: Tx, w: World, opts: { readonly approveAll?: boolean } = {}): Promise<Dependencies> {
  const doApprove = opts.approveAll !== false;
  const material = await materialItem(c, w);
  const edgeBand = await edgeBandItem(c, w);
  const finish = await finishItem(c, w);
  const rules = await hardwareRuleSetItem(c, w);
  const { recipe, product } = await recipeAndProduct(c, w);
  if (doApprove) {
    await approve(c, w, "material", material.versionId);
    await approve(c, w, "edge_band", edgeBand.versionId);
    await approve(c, w, "finish", finish.versionId);
    await approve(c, w, "hardware_rule_set", rules.versionId);
    await approve(c, w, "construction_recipe", recipe.versionId);
    await approve(c, w, "product", product.versionId);
  }
  const pins: Pins = {
    construction_standard_version_id: await constructionStandard(c, w, { complete: true }),
    planning_standard_version_id: await planningStandard(c, w, { complete: true }),
    edge_band_standard_version_id: await edgeBandStandard(c, w),
    manufacturing_standard_version_id: await manufacturingStandard(c, w),
    pricing_standard_version_id: await pricingStandard(c, w, { complete: true }),
    quotation_policy_version_id: await quotationPolicy(c, w, { complete: true }),
    material_catalog_version_id: await catalogVersion(c, w, "material", [["material", material.entityId, material.versionId], ["edge_band", edgeBand.entityId, edgeBand.versionId]]),
    finish_catalog_version_id: await catalogVersion(c, w, "finish", [["finish", finish.entityId, finish.versionId]]),
    hardware_catalog_version_id: await catalogVersion(c, w, "hardware", [["hardware_rule_set", rules.entityId, rules.versionId]]),
    appliance_catalog_version_id: await catalogVersion(c, w, "appliance", []),
    product_catalog_version_id: await catalogVersion(c, w, "product", [["product", product.entityId, product.versionId]]),
    hettich_dataset_version_id: await hettichDataset(c, w),
  };
  if (doApprove) for (const [col, subject] of Object.entries(PIN_SUBJECT)) {
    const id = pins[col as keyof Pins];
    if (id !== null) await approve(c, w, subject, id);
  }
  return { pins, items: { material, edgeBand, finish, rules, recipe, product } };
}

export { catalogVersion };

/* ------------------------------------------------------------ project, room, design version */

export interface DesignFixture {
  readonly projectId: string;
  readonly roomId: string;
  readonly revisionId: string;
  readonly designId: string;
  readonly designVersionId: string;
  readonly inputHash: string;
  readonly clientId: string;
}

export async function project(c: Tx, w: World): Promise<{ projectId: string; clientId: string }> {
  await actAs(c, null);
  const clientId = (await one<{ id: string }>(c, "INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, $2, 'Client') RETURNING id", [w.org, `C_${randomUUID().slice(0, 6)}`])).id;
  const projectId = (await one<{ id: string }>(c, "INSERT INTO design_os.project (org_id, client_id, project_code, name) VALUES ($1, $2, $3, 'Project') RETURNING id",
    [w.org, clientId, `P_${randomUUID().slice(0, 6)}`])).id;
  return { projectId, clientId };
}

export async function designVersion(c: Tx, w: World, deps: Dependencies, o: { readonly blockers?: number; readonly withObject?: boolean } = {}): Promise<DesignFixture> {
  const { projectId, clientId } = await project(c, w);
  await actAs(c, null);
  const roomId = (await one<{ id: string }>(c, "INSERT INTO design_os.room (org_id, project_id, name, room_type) VALUES ($1, $2, 'Kitchen', 'KITCHEN') RETURNING id", [w.org, projectId])).id;
  const revisionId = (await one<{ id: string }>(c,
    "INSERT INTO design_os.room_revision (org_id, room_id, revision_number, length_mm, width_mm, height_mm, wall_thickness_mm, source, surveyed_by, surveyed_at, content_hash) VALUES ($1, $2, 1, 4200, 3200, 3000, 150, 'site survey', $3, now(), $4) RETURNING id",
    [w.org, roomId, w.users.SITE_ENGINEER, contentHash({ length: 4200, width: 3200, height: 3000, wallThickness: 150 })])).id;
  const designId = (await one<{ id: string }>(c, "INSERT INTO design_os.design (org_id, project_id, room_id, name) VALUES ($1, $2, $3, 'Kitchen design') RETURNING id", [w.org, projectId, roomId])).id;
  const designVersionId = randomUUID();
  const inputHash = contentHash({ designVersionId, pins: deps.pins });
  await insertRow(c, "design_version", {
    id: designVersionId, org_id: w.org, entity_id: designId, project_id: projectId, room_revision_id: revisionId, ...deps.pins,
    authored_engine_version: "0.1.0", input_hash: inputHash, version_number: 1, source: "designer", change_reason: "first design", created_by: w.users.DESIGNER,
    content_hash: contentHash({ designVersionId }),
  });
  const product = deps.items.product;
  if (o.withObject !== false && product !== undefined) {
    await insertRow(c, "design_object", {
      org_id: w.org, design_version_id: designVersionId, object_code: "OBJ-KIT-001", lineage_id: "obj_001", object_type: "BASE_CABINET", product_code: "KIT_BASE_STANDARD",
      product_version_id: product.versionId, x_mm: 0, y_mm: 0, z_mm: 0, rotation_y: 0, width_mm: 600, height_mm: 720, depth_mm: 560, parameters: { frontType: "OVERLAY" }, status: "DRAFT",
    });
  }
  await validationRun(c, w, designVersionId, inputHash, o.blockers ?? 0);
  return { projectId, roomId, revisionId, designId, designVersionId, inputHash, clientId };
}

/** An engine validation run as the API would record it (the blocker count comes from the engine, not SQL). */
export async function validationRun(c: Tx, w: World, designVersionId: string, inputHash: string, blockers: number): Promise<void> {
  await actAs(c, null);
  await insertRow(c, "validation_run", {
    org_id: w.org, design_version_id: designVersionId, input_hash: inputHash, engine_version: "0.1.0", blocker_count: blockers, warning_count: 0,
    messages: [], result_hash: contentHash({ blockers }), ran_by: w.users.DESIGNER,
  });
}
