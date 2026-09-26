import { Inject, Injectable } from "@nestjs/common";
import type { Assessment, Migration } from "@lintel/db-tools/migrations";
import { assess, loadMigrations } from "@lintel/db-tools/migrations";
import type { RequestScope } from "../../common/auth/context.js";
import { Database } from "../../common/db/database.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import { API_CONFIG, ENGINE_MANIFEST } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import type { EngineManifest } from "../../infrastructure/engines/engine-manifest.js";
import type { AuditRow, VersionStateRow } from "../../infrastructure/persistence/readiness.repository.js";
import { readinessRepository as repo } from "../../infrastructure/persistence/readiness.repository.js";
import type { AuditChainResponse, AuditEntry, AuditQuery, ReadinessCheck, ReadinessReport, ReadyResponse } from "./readiness.schemas.js";

/**
 * The reference data the V1 pilot needs APPROVED (M6 plan §4.3): every engineering pin of a design version, the
 * Hettich dataset, and the commercial versions of pricing and quotation. Appliances and the ManufacturingStandard are
 * not required for V1. Catalog items are covered through their catalogs' dependency checks.
 */
export const PILOT_REQUIRED_TYPES = [
  "construction_standard", "planning_standard", "edge_band_standard",
  "material_catalog", "finish_catalog", "hardware_catalog", "product_catalog",
  "hettich_dataset", "pricing_standard", "quotation_policy",
] as const;

const NIL = "00000000-0000-0000-0000-000000000000";
const USABLE = new Set(["APPROVED", "LOCKED"]);

function check(id: string, level: ReadinessCheck["level"], ok: boolean | null, message: string, details: Record<string, unknown> = {}): ReadinessCheck {
  return { id, level, status: ok === null ? "SKIPPED" : ok ? "PASS" : "FAIL", message, details };
}

/**
 * Readiness and audit read (M6 G7). No mutation (READ ONLY transactions), no secrets, deterministic output (sorted,
 * no timestamps), tenant-safe (RLS and the 0020 wrappers use the caller's verified organization).
 */
@Injectable()
export class ReadinessService {
  private expected: { readonly migrations: readonly Migration[] } | { readonly error: string } | undefined;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(ENGINE_MANIFEST) private readonly manifest: EngineManifest,
  ) {}

  /** The migrations this build ships (the same loader and checksums as the migration runner). */
  private expectedMigrations(): { readonly migrations: readonly Migration[] } | { readonly error: string } {
    if (this.expected === undefined) {
      try {
        this.expected = { migrations: loadMigrations() };
      } catch (e) {
        this.expected = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return this.expected;
  }

  /** The migration state, or null when the ledger cannot be read (e.g. before 0020, or no database). */
  private async migrationState(requestId: string): Promise<Assessment | null> {
    const expected = this.expectedMigrations();
    if ("error" in expected) return null;
    try {
      const ledger = await this.db.transaction({ claims: { sub: NIL }, requestId, readOnly: true }, (tx) => repo.ledger(tx));
      return assess(expected.migrations, ledger);
    } catch {
      return null;
    }
  }

  async ready(requestId: string): Promise<{ readonly ok: boolean; readonly body: ReadyResponse }> {
    let database: boolean;
    try {
      database = await this.db.transaction({ claims: { sub: NIL }, requestId, readOnly: true }, (tx) => repo.ping(tx));
    } catch {
      database = false;
    }
    const m = database ? await this.migrationState(requestId) : null;
    const migrations = m?.state === "UP_TO_DATE";
    const engineManifest = Object.keys(this.manifest.engines).length > 0;
    const ok = database && migrations && engineManifest;
    return { ok, body: { status: ok ? "ready" : "not_ready", checks: { database: database ? "pass" : "fail", migrations: migrations ? "pass" : "fail", engineManifest: engineManifest ? "pass" : "fail" } } };
  }

  async readiness(scope: RequestScope): Promise<ReadinessReport> {
    if (!scope.org.permissions.has("reference.read")) throw new ApiProblem("PERMISSION_DENIED", "readiness also needs reference.read");
    const checks: ReadinessCheck[] = [];
    const engines: Record<string, string> = {};
    for (const [k, e] of Object.entries(this.manifest.engines).sort(([a], [b]) => (a < b ? -1 : 1))) engines[k] = e.fingerprint;
    checks.push(check("build.engine_manifest", "INFO", Object.keys(engines).length > 0, "engine manifest loaded and verified at startup", { engines: Object.keys(engines).length }));

    const expected = this.expectedMigrations();
    const m = await this.migrationState(scope.requestId);
    if ("error" in expected) checks.push(check("database.migrations", "BLOCKING", false, "the build's migration files cannot be read", {}));
    else if (m === null) checks.push(check("database.migrations", "BLOCKING", false, "the migration ledger cannot be read", { expectedLatest: expected.migrations.at(-1)?.version ?? null }));
    else {
      checks.push(check("database.migrations", "BLOCKING", m.state === "UP_TO_DATE", `migrations are ${m.state}`, {
        state: m.state, expectedLatest: expected.migrations.at(-1)?.version ?? null, appliedLatest: m.applied.at(-1) ?? null,
        pending: m.pending.map((x) => `${x.version}_${x.name}`), drift: m.drift.map((d) => ({ version: d.version, kind: d.kind })),
      }));
    }

    await this.uow.run(scope, { action: "audit.read", readOnly: true }, async (tx) => {
      const chain = await repo.auditChain(tx);
      checks.push(check("audit.chain", "BLOCKING", chain?.ok ?? false, chain?.ok === true ? "the organization's audit hash chain verifies" : "the organization's audit hash chain does not verify",
        { checked: chain?.checked ?? 0, firstBadId: chain?.first_bad_id ?? null }));

      for (const type of PILOT_REQUIRED_TYPES) {
        const versions = await repo.versions(tx, type);
        const byEntity = new Map<string, VersionStateRow[]>();
        for (const v of versions) byEntity.set(v.entity_code, [...(byEntity.get(v.entity_code) ?? []), v]);
        const usable: VersionStateRow[] = [];
        const newerPending: { entityCode: string; versionNumber: number; status: string }[] = [];
        for (const [code, vs] of [...byEntity.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
          const latestUsable = [...vs].reverse().find((v) => USABLE.has(v.status));
          if (latestUsable !== undefined) usable.push(latestUsable);
          for (const v of vs) {
            if (v.status === "IN_REVIEW" && (latestUsable === undefined || v.version_number > latestUsable.version_number)) newerPending.push({ entityCode: code, versionNumber: v.version_number, status: v.status });
          }
        }
        const counts = Object.fromEntries(["DRAFT", "IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"].map((s) => [s, versions.filter((v) => v.status === s).length]));
        checks.push(check(`data.${type}.approved`, "BLOCKING", usable.length > 0,
          usable.length > 0 ? `${type}: an APPROVED / LOCKED version exists` : `${type}: no APPROVED / LOCKED version — the pilot cannot use it`,
          { usable: usable.map((v) => ({ entityCode: v.entity_code, versionNumber: v.version_number, status: v.status })), counts }));

        const problems: { entityCode: string; versionNumber: number; code: string; message: string }[] = [];
        for (const v of usable) for (const p of await repo.approvalProblems(tx, type, v.id)) problems.push({ entityCode: v.entity_code, versionNumber: v.version_number, ...p });
        checks.push(check(`data.${type}.dependencies`, "BLOCKING", usable.length === 0 ? null : problems.length === 0,
          usable.length === 0 ? `${type}: no usable version to check` : problems.length === 0 ? `${type}: usable versions still meet every approval precondition` : `${type}: a usable version no longer meets its approval preconditions`,
          { problems }));
        checks.push(check(`data.${type}.pending`, "WARNING", newerPending.length === 0,
          newerPending.length === 0 ? `${type}: no newer version awaiting approval` : `${type}: a newer version is awaiting approval; outputs still use the current usable version`,
          { pending: newerPending }));
      }
    });

    checks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const blockingFailures = checks.filter((c) => c.level === "BLOCKING" && c.status === "FAIL").length;
    const warnings = checks.filter((c) => c.level === "WARNING" && c.status === "FAIL").length;
    return { status: blockingFailures === 0 ? "READY" : "NOT_READY", build: { revision: this.config.buildRevision, engines }, summary: { blockingFailures, warnings, checks: checks.length }, checks };
  }

  audit(scope: RequestScope, q: AuditQuery) {
    const f = { table: q.table ?? null, rowId: q.rowId ?? null, actorUserId: q.actorUserId ?? null, from: q.from ?? null, to: q.to ?? null };
    return this.uow.run(scope, { action: "audit.read", readOnly: true }, (tx) => keysetList(tx, {
      codec: this.cursors, collection: `audit:${JSON.stringify(f)}`, orgId: scope.org.orgId, sort: SORTS.sequenceDesc, query: q, firstParam: 6,
      fetch: (t, page, params) => repo.audit(t, f, page, params), key: (r): number => r.seq, id: (r) => r.id, map: toAuditEntry,
    }));
  }

  auditChain(scope: RequestScope): Promise<AuditChainResponse> {
    return this.uow.run(scope, { action: "audit.read", readOnly: true }, async (tx) => {
      const c = await repo.auditChain(tx);
      return { ok: c?.ok ?? false, checked: c?.checked ?? 0, firstBadId: c?.first_bad_id ?? null };
    });
  }
}

function toAuditEntry(r: AuditRow): AuditEntry {
  return {
    id: r.seq, occurredAt: iso(r.occurred_at), actorUserId: r.actor_user_id, action: r.action, table: r.table_name, rowId: r.row_id,
    oldValue: r.old_value, newValue: r.new_value, reason: r.reason, requestId: r.request_id, prevHash: r.prev_hash, rowHash: r.row_hash,
  };
}
