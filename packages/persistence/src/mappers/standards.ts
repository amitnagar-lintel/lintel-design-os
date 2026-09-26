import type { ComponentType, ConstructionStandard, EdgeBandStandard, EdgeSide, PlanningStandard } from "@lintel/types";
import { engineStatus } from "../envelope.js";
import { MappingError } from "../errors.js";
import type { MapContext, VersionMeta, VersionRow } from "./common.js";
import { byKey, checkEngineStatus, omit, readEnvelope, requireLabel, versionRow } from "./common.js";

/* ------------------------------------------------------------ numeric-value standards */

/** Optional per-value provenance: a standard version is approved as a whole, but each value keeps its own source. */
export interface ValueProvenance {
  readonly unit: string | null;
  readonly source: string | null;
  readonly evidenceRef: string | null;
  readonly note: string | null;
}

/** One value of a numeric standard. `value` null = NULL / UNVERIFIED — never defaulted. */
export interface StandardValueRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly variable_code: string;
  readonly value: number | null;
  readonly unit: string | null;
  readonly source: string | null;
  readonly evidence_ref: string | null;
  readonly note: string | null;
}

export interface StandardVersionRow extends VersionRow {
  readonly description: string;
}

export interface NumericStandardRows {
  readonly version: StandardVersionRow;
  readonly values: readonly StandardValueRow[];
}

type NumericStandard = ConstructionStandard | PlanningStandard;

function numericToRows(kind: string, s: NumericStandard, meta: VersionMeta, ctx: MapContext, provenance: Readonly<Record<string, ValueProvenance>>): NumericStandardRows {
  checkEngineStatus(`${kind} ${s.standardId}`, s.status, meta);
  for (const code of Object.keys(provenance)) if (!(code in s.variables)) throw new MappingError(`${kind} ${s.standardId}: provenance for undeclared variable ${code}`);
  const values: StandardValueRow[] = byKey(Object.keys(s.variables), (k) => k).map((code) => {
    const p = provenance[code];
    return {
      org_id: ctx.orgId,
      version_id: meta.versionId,
      variable_code: code,
      value: s.variables[code] ?? null,
      unit: p?.unit ?? null,
      source: p?.source ?? null,
      evidence_ref: p?.evidenceRef ?? null,
      note: p?.note ?? null,
    };
  });
  const content = { standardId: s.standardId, version: s.version, description: s.description, source: s.source, values: values.map((v) => omit(v, "org_id", "version_id")) };
  return { version: { ...versionRow(ctx, s.standardId, meta, s.source, s.version, content), description: s.description }, values };
}

function numericFromRows(rows: NumericStandardRows): { standardId: string; version: string; status: ReturnType<typeof engineStatus>; description: string; source: string; variables: Record<string, number | null> } {
  const e = readEnvelope(rows.version);
  const variables: Record<string, number | null> = {};
  for (const v of rows.values) {
    if (v.version_id !== e.versionId) throw new MappingError(`value ${v.variable_code} belongs to version ${v.version_id}, not ${e.versionId}`);
    if (v.variable_code in variables) throw new MappingError(`duplicate value ${v.variable_code}`);
    variables[v.variable_code] = v.value;
  }
  return { standardId: rows.version.entity_code, version: requireLabel(rows.version), status: engineStatus(e.status), description: rows.version.description, source: e.source, variables };
}

export const constructionStandardToRows = (s: ConstructionStandard, meta: VersionMeta, ctx: MapContext, provenance: Readonly<Record<string, ValueProvenance>> = {}): NumericStandardRows =>
  numericToRows("construction standard", s, meta, ctx, provenance);
export const constructionStandardFromRows = (rows: NumericStandardRows): ConstructionStandard => numericFromRows(rows);

export const planningStandardToRows = (s: PlanningStandard, meta: VersionMeta, ctx: MapContext, provenance: Readonly<Record<string, ValueProvenance>> = {}): NumericStandardRows =>
  numericToRows("planning standard", s, meta, ctx, provenance);
export const planningStandardFromRows = (rows: NumericStandardRows): PlanningStandard => numericFromRows(rows);

/* ------------------------------------------------------------ edge band standard */

export interface EdgeRuleSetRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly rule_set_code: string;
}

/**
 * One edge rule. `edge_side` and `edge_band_id` both null = the component type is defined
 * with explicitly no edge banding (`{}`); an absent component type has no row at all.
 */
export interface EdgeRuleRow {
  readonly org_id: string;
  readonly version_id: string;
  readonly rule_set_code: string;
  readonly component_type: ComponentType;
  readonly edge_side: EdgeSide | null;
  readonly edge_band_id: string | null;
}

export interface EdgeBandStandardRows {
  readonly version: StandardVersionRow;
  readonly ruleSets: readonly EdgeRuleSetRow[];
  readonly rules: readonly EdgeRuleRow[];
}

export function edgeBandStandardToRows(s: EdgeBandStandard, meta: VersionMeta, ctx: MapContext): EdgeBandStandardRows {
  checkEngineStatus(`edge band standard ${s.standardId}`, s.status, meta);
  const ruleSets: EdgeRuleSetRow[] = [];
  const rules: EdgeRuleRow[] = [];
  for (const setCode of byKey(Object.keys(s.ruleSets), (k) => k)) {
    ruleSets.push({ org_id: ctx.orgId, version_id: meta.versionId, rule_set_code: setCode });
    const set = s.ruleSets[setCode] ?? {};
    for (const type of byKey(Object.keys(set) as ComponentType[], (k) => k)) {
      const rule = set[type] ?? {};
      const sides = byKey(Object.keys(rule) as EdgeSide[], (k) => k);
      const base = { org_id: ctx.orgId, version_id: meta.versionId, rule_set_code: setCode, component_type: type };
      if (sides.length === 0) rules.push({ ...base, edge_side: null, edge_band_id: null });
      for (const side of sides) rules.push({ ...base, edge_side: side, edge_band_id: rule[side] ?? null });
    }
  }
  const content = { standardId: s.standardId, version: s.version, description: s.description, source: s.source, ruleSets: s.ruleSets };
  return { version: { ...versionRow(ctx, s.standardId, meta, s.source, s.version, content), description: s.description }, ruleSets, rules };
}

export function edgeBandStandardFromRows(rows: EdgeBandStandardRows): EdgeBandStandard {
  const e = readEnvelope(rows.version);
  const sets: Record<string, Partial<Record<ComponentType, Partial<Record<EdgeSide, string>>>>> = {};
  for (const s of rows.ruleSets) sets[s.rule_set_code] = {};
  for (const r of rows.rules) {
    const set = sets[r.rule_set_code];
    if (set === undefined) throw new MappingError(`edge rule for unknown rule set ${r.rule_set_code}`);
    const rule = (set[r.component_type] ??= {});
    if ((r.edge_side === null) !== (r.edge_band_id === null)) throw new MappingError(`edge rule ${r.rule_set_code}.${r.component_type}: side and band must both be set or both null`);
    if (r.edge_side !== null && r.edge_band_id !== null) {
      if (rule[r.edge_side] !== undefined) throw new MappingError(`duplicate edge rule ${r.rule_set_code}.${r.component_type}.${r.edge_side}`);
      rule[r.edge_side] = r.edge_band_id;
    }
  }
  return {
    standardId: rows.version.entity_code,
    version: requireLabel(rows.version),
    status: engineStatus(e.status),
    description: rows.version.description,
    source: e.source,
    ruleSets: sets,
  };
}
