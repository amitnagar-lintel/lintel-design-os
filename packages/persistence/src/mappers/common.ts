import type { DataStatus } from "@lintel/types";
import type { EnvelopeRow, VersionEnvelope } from "../envelope.js";
import { engineStatus, envelopeFromRow, envelopeToRow } from "../envelope.js";
import { MappingError } from "../errors.js";
import { assertNotTestFixture } from "../fixture-guard.js";
import type { Sha256 } from "../hash.js";
import { contentHash } from "../hash.js";

/**
 * Envelope fields the caller controls. Source, label, classification and content hash are
 * always derived from the content by the mapper — never supplied (the server computes them).
 */
export type VersionMeta = Omit<VersionEnvelope, "source" | "contentHash" | "dataClassification" | "versionLabel">;

/** Every versioned row: tenant, entity code and the envelope columns. */
export interface VersionRow extends EnvelopeRow {
  readonly org_id: string;
  /** Stable business code of the entity (e.g. LINTEL_CONSTRUCTION_STANDARD). */
  readonly entity_code: string;
}

export interface MapContext {
  readonly orgId: string;
}

/** Status handshake: the record status is authoritative and must agree with the engine object; fixtures are refused. */
export function checkEngineStatus(what: string, engine: DataStatus, meta: Pick<VersionMeta, "status">): void {
  assertNotTestFixture(what, engine);
  const expected = engineStatus(meta.status);
  if (engine !== expected) throw new MappingError(`${what}: engine status ${engine} does not match record status ${meta.status} (expected ${expected})`);
}

export function versionRow(ctx: MapContext, entityCode: string, meta: VersionMeta, source: string, versionLabel: string, content: unknown): VersionRow {
  const hash: Sha256 = contentHash(content);
  return {
    org_id: ctx.orgId,
    entity_code: entityCode,
    ...envelopeToRow({ ...meta, source, versionLabel, dataClassification: "PRODUCTION", contentHash: hash }),
  };
}

export function readEnvelope(row: VersionRow): VersionEnvelope {
  if ((row.data_classification as string) !== "PRODUCTION") throw new MappingError(`row ${row.id}: only PRODUCTION rows exist`);
  return envelopeFromRow(row);
}

/** Copy without the given keys (used to hash content without status / row plumbing). */
export function omit<T extends object, K extends keyof T>(obj: T, ...keys: readonly K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !(keys as readonly PropertyKey[]).includes(k))) as Omit<T, K>;
}

export const byKey = <T>(rows: readonly T[], key: (r: T) => string): T[] => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function requireLabel(row: VersionRow): string {
  if (row.version_label === null) throw new MappingError(`row ${row.id}: version_label is required for engine data`);
  return row.version_label;
}
