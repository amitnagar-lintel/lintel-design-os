import type { Sha256, SnapshotRow } from "@lintel/persistence";
import { COMMERCIAL_PINS } from "@lintel/persistence";
import type { Tx } from "../../common/db/tx.js";
import type { DesignVersionRow } from "../../infrastructure/persistence/design-versions.repository.js";
import { designVersionsRepository } from "../../infrastructure/persistence/design-versions.repository.js";
import { outputsRepository } from "../../infrastructure/persistence/outputs.repository.js";
import type { OutputKind } from "./output-context.js";
import { SNAPSHOT_TABLE, SOURCE_COLUMN, SOURCE_KIND } from "./output-generation.js";

export type StalenessReason = "ENGINEERING_INPUTS_CHANGED" | "DEPENDENCY_CONTENT_CHANGED" | "COMMERCIAL_CONTENT_CHANGED" | "ENGINE_CHANGED" | "SOURCE_STALE";

export interface Staleness {
  readonly stale: boolean;
  readonly reasons: StalenessReason[];
  readonly advisories: {
    readonly designSuperseded: boolean;
    readonly newerSurveyAvailable: boolean;
    readonly newerDependencyVersions: { pin: string; versionId: string }[];
    readonly newerCommercialVersions: { pin: string; versionId: string }[];
  };
}

const ENGINEERING_PIN_COLUMNS = [
  "construction_standard_version_id", "planning_standard_version_id", "edge_band_standard_version_id", "material_catalog_version_id", "finish_catalog_version_id",
  "hardware_catalog_version_id", "appliance_catalog_version_id", "product_catalog_version_id", "hettich_dataset_version_id",
] as const;
const REASON_ORDER: readonly StalenessReason[] = ["ENGINEERING_INPUTS_CHANGED", "DEPENDENCY_CONTENT_CHANGED", "COMMERCIAL_CONTENT_CHANGED", "ENGINE_CHANGED", "SOURCE_STALE"];

/**
 * Staleness (Step 6 plan §10): calculated, never stored. A snapshot is stale when its engineering inputs, the content
 * of its exact dependency versions, its engine or any upstream snapshot changed. A new PricingStandard /
 * QuotationPolicy version, a newer unpinned version, a newer survey or a SUPERSEDED design never make it stale —
 * they are advisories. Upstream snapshots the caller cannot read are not evaluated (RLS; no escalation).
 */
export class StalenessCalculator {
  private readonly memo = new Map<string, Promise<Staleness>>();
  private readonly versions = new Map<string, Promise<DesignVersionRow | null>>();

  constructor(private readonly tx: Tx, private readonly currentFingerprint: (engine: string) => Sha256 | undefined) {}

  of(row: SnapshotRow): Promise<Staleness> {
    let s = this.memo.get(row.id);
    if (s === undefined) {
      s = this.compute(row);
      this.memo.set(row.id, s);
    }
    return s;
  }

  private version(id: string): Promise<DesignVersionRow | null> {
    let v = this.versions.get(id);
    if (v === undefined) {
      v = designVersionsRepository.get(this.tx, id);
      this.versions.set(id, v);
    }
    return v;
  }

  private async compute(row: SnapshotRow): Promise<Staleness> {
    const dv = await this.version(row.design_version_id);
    if (dv === null) throw new Error(`design version ${row.design_version_id} of snapshot ${row.id} is not readable`);
    const reasons = new Set<StalenessReason>();
    const pinsChanged = ENGINEERING_PIN_COLUMNS.filter((c) => row[c] !== dv[c]);
    if (row.input_hash !== dv.input_hash || row.input_revision !== dv.input_revision || pinsChanged.length > 0) reasons.add("ENGINEERING_INPUTS_CHANGED");
    // Current content of the design version's pins and of the snapshot's OWN commercial versions (no "current" commercial pin).
    const current = await outputsRepository.dependencyHashes(this.tx, dv.id, row.pricing_standard_version_id, row.quotation_policy_version_id);
    const recorded = row.dependency_hashes as Readonly<Record<string, string>>;
    for (const [pin, hash] of Object.entries(recorded)) {
      if (COMMERCIAL_PINS.includes(pin as (typeof COMMERCIAL_PINS)[number])) {
        if (current[pin] !== hash) reasons.add("COMMERCIAL_CONTENT_CHANGED");
      } else if (!pinsChanged.includes(pin as (typeof ENGINEERING_PIN_COLUMNS)[number]) && current[pin] !== hash) {
        reasons.add("DEPENDENCY_CONTENT_CHANGED");
      }
    }
    if (this.currentFingerprint(row.engine_name) !== row.engine_fingerprint) reasons.add("ENGINE_CHANGED");
    for (const [key, column] of Object.entries(SOURCE_COLUMN) as [keyof typeof SOURCE_COLUMN, (typeof SOURCE_COLUMN)[keyof typeof SOURCE_COLUMN]][]) {
      const id = row[column];
      if (id === undefined) continue;
      const source = await outputsRepository.get(this.tx, SNAPSHOT_TABLE[SOURCE_KIND[key] satisfies OutputKind], id);
      if (source !== null && (await this.of(source as unknown as SnapshotRow)).stale) reasons.add("SOURCE_STALE");
    }
    const engineeringPins = Object.fromEntries(ENGINEERING_PIN_COLUMNS.flatMap((c) => (row[c] === null ? [] : [[c, row[c]]]))) as Record<string, string>;
    const commercialPins: Record<string, string> = {
      ...(row.pricing_standard_version_id === null ? {} : { pricing_standard_version_id: row.pricing_standard_version_id }),
      ...(row.quotation_policy_version_id === null ? {} : { quotation_policy_version_id: row.quotation_policy_version_id }),
    };
    return {
      stale: reasons.size > 0,
      reasons: REASON_ORDER.filter((r) => reasons.has(r)),
      advisories: {
        designSuperseded: dv.status === "SUPERSEDED",
        newerSurveyAvailable: await outputsRepository.newerSurveyAvailable(this.tx, dv.room_revision_id),
        newerDependencyVersions: await outputsRepository.newerVersions(this.tx, engineeringPins),
        newerCommercialVersions: await outputsRepository.newerVersions(this.tx, commercialPins),
      },
    };
  }
}
