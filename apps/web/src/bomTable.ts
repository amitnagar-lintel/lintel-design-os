/**
 * P2 (readable BOM): a presentation-only projection of a generated BOM snapshot's raw payload
 * (`packages/types/src/room-commercial.ts`'s `RoomBOM` — read here only as loosely-typed JSON, the same way
 * `Outputs.tsx`'s `SnapshotView` already treats every output payload, since the API types a snapshot's payload
 * as opaque JSON at this layer, not a compile-time-checked shape) into one flat, designer-readable table:
 * Cabinet | Component | Qty | Material | Finish | Hardware.
 *
 * A `RoomBOM` is NOT a flat item list: it's `{ objectBoms: BOM[], totals: RoomBomTotal[], ... }`, one `BOM` per
 * design object (`packages/types/src/bom.ts`), each carrying its own `items: BOMItem[]` AND a `trace.objectId`
 * — the exact object identity every other view already keys by, so a line is attributed to its cabinet by that
 * id, never by guessing from a component-id string. This computes nothing the BOM engine didn't already
 * compute — no quantity, price or material choice originates here, only how to lay out fields that already
 * exist on each item, dispatched by its `kind` (PANEL/BOARD/EDGE_BAND/FINISH/HARDWARE/APPLIANCE). The room-level
 * `totals` (aggregated across cabinets) are intentionally not shown here — this table is the per-cabinet detail
 * the raw JSON disclosure still carries in full alongside it.
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
const record = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

function rowOf(item: Record<string, unknown>, cabinet: string): BomTableRow | null {
  const kind = str(item.kind);
  if (kind === undefined) return null;
  const description = str(item.description) ?? "—";
  const quantity = num(item.quantity);
  const unit = str(item.unit);
  const qty = quantity === undefined ? "—" : unit === undefined ? String(quantity) : `${String(quantity)} ${unit}`;
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

/** `objects`: every design object's own id and code — never invented, always read off the same resolved model
 * every other view uses — so each `objectBoms[]` entry (keyed by its own `trace.objectId`) can be attributed to
 * the right cabinet. */
export function bomTableRows(payload: Record<string, unknown>, objects: readonly { readonly objectId: string; readonly objectCode: string }[]): readonly BomTableRow[] {
  const codeById = new Map(objects.map((o) => [o.objectId, o.objectCode]));
  const objectBoms = Array.isArray(payload.objectBoms) ? payload.objectBoms : [];
  const rows: BomTableRow[] = [];
  for (const ob of objectBoms) {
    const obRec = record(ob);
    const objectId = str(record(obRec.trace).objectId);
    const cabinet = objectId === undefined ? "—" : codeById.get(objectId) ?? "—";
    const items = Array.isArray(obRec.items) ? obRec.items : [];
    for (const it of items) {
      const row = rowOf(record(it), cabinet);
      if (row !== null) rows.push(row);
    }
  }
  return rows;
}
