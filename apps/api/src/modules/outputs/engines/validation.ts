/**
 * Entry module of the `validation` output engine (Step 6 plan revision 4 §6): the only place that wires stored rows to
 * the design engine for validation. Its static import graph is the engine's fingerprint closure, so it imports only
 * engines and @lintel/persistence at runtime (API types are type-only imports).
 */
import { createHettichAdapter } from "@lintel/hettich-engine";
import { resolveRoom } from "@lintel/design-engine";
import type { ResolveRoomInput } from "@lintel/design-engine";
import type { CatalogSnapshot, ResolvedRoom } from "@lintel/types";
import type {
  EdgeBandStandardRows, EdgeBandVersionRow, FinishVersionRow, HardwareRuleSetRows, HettichDatasetRows, MaterialVersionRow, NumericStandardRows,
  ProductVersionRow, RecipeVersionRow, RecordLifecycleStatus,
} from "@lintel/persistence";
import {
  assembleCatalogSnapshot, constructionStandardFromRows, designObjectFromRow, designVersionFromRow, edgeBandFromRow, edgeBandStandardFromRows,
  engineDesignVersion, finishFromRow, hardwareRuleSetFromRows, hettichDatasetFromRows, materialFromRow, overrideFromRow, planningStandardFromRows,
  productFromRow, recipeFromRow, roomFromRows,
} from "@lintel/persistence";
import type { PinnedInputRows, VersionRowWithCode } from "../../../infrastructure/persistence/design-inputs.repository.js";
import type { DesignObjectRow, DesignVersionRow, RelationshipOverrideRow } from "../../../infrastructure/persistence/design-versions.repository.js";
import type { RoomRevisionRow, RoomRow } from "../../../infrastructure/persistence/rooms.repository.js";

function required<T>(row: T | null, what: string): T {
  if (row === null) throw new Error(`pinned ${what} is not readable`);
  return row;
}
const catalogRef = (r: VersionRowWithCode) => ({
  catalogVersionId: String(r.id),
  versionLabel: typeof r.version_label === "string" ? r.version_label : String(r.version_number),
  status: r.status as RecordLifecycleStatus,
});

/**
 * Run the design engine on EXACTLY the stored inputs: the pinned standard / catalog / Hettich versions (mapped by
 * @lintel/persistence, catalog assembled from the pinned catalog versions), the room survey revision, the objects and
 * the override history. Pure: no database access, no business rules of its own.
 */
/** The stored rows of one design version's exact engineering inputs. */
export interface EngineeringRows {
  readonly version: DesignVersionRow;
  readonly room: RoomRow;
  readonly revision: RoomRevisionRow;
  readonly objects: readonly DesignObjectRow[];
  readonly overrides: readonly RelationshipOverrideRow[];
  readonly pinned: PinnedInputRows;
}

/** Map the exact stored rows to engine inputs (mapping only; @lintel/persistence keeps nulls as nulls). */
export function engineeringModel(input: EngineeringRows): { readonly input: ResolveRoomInput; readonly catalog: CatalogSnapshot } {
  const p = input.pinned;
  const standard = constructionStandardFromRows({ version: required(p.construction.version, "construction standard"), values: p.construction.values } as unknown as NumericStandardRows).value;
  const planning = planningStandardFromRows({ version: required(p.planning.version, "planning standard"), values: p.planning.values } as unknown as NumericStandardRows).value;
  const edgeBandStandard = edgeBandStandardFromRows({ version: required(p.edgeBand.version, "edge band standard"), ruleSets: p.edgeBand.ruleSets, rules: p.edgeBand.rules } as unknown as EdgeBandStandardRows).value;
  const { catalog } = assembleCatalogSnapshot({
    material: {
      ...catalogRef(required(p.material.catalog, "material catalog")),
      materials: p.material.materials.map((r) => materialFromRow(r as unknown as MaterialVersionRow).value),
      edgeBands: p.material.edgeBands.map((r) => edgeBandFromRow(r as unknown as EdgeBandVersionRow).value),
    },
    finish: { ...catalogRef(required(p.finish.catalog, "finish catalog")), finishes: p.finish.finishes.map((r) => finishFromRow(r as unknown as FinishVersionRow).value) },
    hardware: {
      ...catalogRef(required(p.hardware.catalog, "hardware catalog")),
      hardwareRuleSets: p.hardware.ruleSets.map((s) => hardwareRuleSetFromRows(s as unknown as HardwareRuleSetRows).value),
    },
    product: {
      ...catalogRef(required(p.product.catalog, "product catalog")),
      products: p.product.products.map((r) => productFromRow(r as unknown as ProductVersionRow).value),
      recipes: p.product.recipes.map((r) => recipeFromRow(r as unknown as RecipeVersionRow).value),
    },
  });
  const hettich = hettichDatasetFromRows({ version: required(p.hettich.version, "Hettich dataset"), articles: p.hettich.articles, calculationRules: p.hettich.calculationRules } as unknown as HettichDatasetRows).value;
  const room = roomFromRows({ ...input.room }, input.revision as unknown as Parameters<typeof roomFromRows>[1]);
  const designVersion = engineDesignVersion(designVersionFromRow(input.version as unknown as Parameters<typeof designVersionFromRow>[0]));
  return {
    catalog,
    input: {
      designVersion,
      room,
      objects: input.objects.map((o) => designObjectFromRow(o, { projectId: input.room.project_id, roomId: input.room.id })),
      catalog,
      standard,
      edgeBandStandard,
      planning,
      adapters: [createHettichAdapter(hettich)],
      overrides: input.overrides.map((o) => overrideFromRow(o)),
    },
  };
}

/** Resolve the room / model once; its `validation` is the validation engine's result for exactly these inputs. */
export function resolveEngineeringModel(model: { readonly input: ResolveRoomInput }): ResolvedRoom {
  return resolveRoom(model.input);
}

/** Validation (APPROVAL runs): map and resolve in one step. */
export function runDesignEngine(input: EngineeringRows): ResolvedRoom {
  return resolveEngineeringModel(engineeringModel(input));
}
