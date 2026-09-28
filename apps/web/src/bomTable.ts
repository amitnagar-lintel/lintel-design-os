/**
 * P2 (readable BOM): a presentation-only projection of a generated BOM snapshot's raw payload
 * (`packages/types/src/bom.ts`'s `BOM`/`BOMItem` — read here only as loosely-typed JSON, the same way
 * `Outputs.tsx`'s `SnapshotView` already treats every output payload, since the API types a snapshot's payload
 * as opaque JSON at this layer, not a compile-time-checked shape) into one flat, designer-readable table:
 * Cabinet | Component | Qty | Material | Finish | Hardware. This computes nothing the BOM engine didn't already
 * compute — no quantity, price or material choice originates here, only how to lay out fields that already
 * exist on each item, dispatched by its `kind` (PANEL/BOARD/EDGE_BAND/FINISH/HARDWARE/APPLIANCE).
 */
export interface BomTableRow {
  readonly cabinet: string;
  readonly component: string;
  readonly qty: string;
  readonly material: string;
  readonly finish: string;
  readonly hardware: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Which known object code (e.g. "BC-001") a component belongs to — component ids are always
 * `${objectCode}-${suffix}` (`packages/design-engine/src/components.ts`'s `componentId`), so an exact `id-`
 * prefix match against a known code wins; "—" when nothing matches (e.g. a whole-room summary item, if the BOM
 * engine ever produces one — never invented). */
function cabinetOf(sourceComponentIds: readonly string[], objectCodes: readonly string[]): string {
  return objectCodes.find((code) => sourceComponentIds.some((id) => id === code || id.startsWith(`${code}-`))) ?? "—";
}

function rowOf(item: Record<string, unknown>, objectCodes: readonly string[]): BomTableRow | null {
  const kind = str(item.kind);
  if (kind === undefined) return null;
  const description = str(item.description) ?? "—";
  const quantity = num(item.quantity);
  const unit = str(item.unit);
  const qty = quantity === undefined ? "—" : unit === undefined ? String(quantity) : `${String(quantity)} ${unit}`;
  const sourceComponentIds = Array.isArray(item.sourceComponentIds) ? item.sourceComponentIds.filter((x): x is string => typeof x === "string") : [];
  const cabinet = cabinetOf(sourceComponentIds, objectCodes);
  const base = { cabinet, component: description, qty };

  switch (kind) {
    case "PANEL":
    case "BOARD":
      return { ...base, material: str(item.materialId) ?? "—", finish: "—", hardware: "—" };
    case "EDGE_BAND":
      return { ...base, material: str(item.edgeBandId) ?? "—", finish: "—", hardware: "—" };
    case "FINISH":
      return { ...base, material: "—", finish: str(item.finishId) ?? "—", hardware: "—" };
    case "HARDWARE": {
      const manufacturer = str(item.manufacturer) ?? "";
      const article = str(item.articleNumber);
      const status = str(item.status);
      const hardware = article !== undefined ? [manufacturer, article].filter((x) => x !== "").join(" ") : `${manufacturer === "" ? "Unresolved" : manufacturer} (${status ?? "unresolved"})`;
      return { ...base, material: "—", finish: "—", hardware };
    }
    case "APPLIANCE": {
      const hardware = [str(item.manufacturer), str(item.model)].filter((x): x is string => x !== undefined && x !== "").join(" ") || "—";
      return { ...base, material: "—", finish: "—", hardware };
    }
    default:
      return { ...base, material: "—", finish: "—", hardware: "—" };
  }
}

/** `objectCodes`: every object code in the design (order doesn't affect correctness — matching is an exact
 * prefix test — but every known cabinet must be included for its components to be attributed to it). */
export function bomTableRows(payload: Record<string, unknown>, objectCodes: readonly string[]): readonly BomTableRow[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => rowOf(x, objectCodes))
    .filter((x): x is BomTableRow => x !== null);
}
