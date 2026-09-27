import type { BOM, ResolvedRoom, RoomBOM, RoomBomTotal } from "@lintel/types";
import { AREA_DECIMALS, generateBom, LENGTH_DECIMALS } from "./index.js";

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Combined room BOM: every object's BOM intact, plus room totals per board, edge band,
 * finish and hardware article, each traced to the object BOM lines it sums.
 */
export function generateRoomBom(room: ResolvedRoom): RoomBOM {
  const objectBoms: BOM[] = room.cabinets.map((c) => generateBom(c));
  const totals = new Map<string, { kind: RoomBomTotal["kind"]; key: string; description: string; qty: number; unit: RoomBomTotal["unit"]; status: RoomBomTotal["status"]; ids: string[] }>();
  const add = (kind: RoomBomTotal["kind"], key: string, description: string, qty: number, unit: RoomBomTotal["unit"], status: RoomBomTotal["status"], id: string): void => {
    const k = `${kind}:${key}`;
    const t = totals.get(k) ?? { kind, key, description, qty: 0, unit, status, ids: [] };
    t.qty += qty;
    t.ids.push(id);
    totals.set(k, t);
  };
  for (const bom of objectBoms) {
    for (const item of bom.items) {
      switch (item.kind) {
        case "BOARD":
          add("BOARD", item.materialId, `${item.materialId} board, net area`, item.quantity, "M2", "RESOLVED", item.bomItemId);
          break;
        case "EDGE_BAND":
          add("EDGE_BAND", item.edgeBandId, `${item.edgeBandId}, net banded length`, item.quantity, "M", "RESOLVED", item.bomItemId);
          break;
        case "FINISH":
          add("FINISH", item.finishId, `${item.finishId}, net finished area`, item.quantity, "M2", "RESOLVED", item.bomItemId);
          break;
        case "HARDWARE":
          if (item.status === "RESOLVED" && item.articleNumber !== null) add("HARDWARE", `${item.manufacturer}:${item.articleNumber}`, item.description, item.quantity, "NOS", "RESOLVED", item.bomItemId);
          else add("HARDWARE", `UNRESOLVED:${item.sourceRequirementIds.join(",")}`, item.description, 0, "NOS", "UNRESOLVED", item.bomItemId);
          break;
        case "PANEL":
        case "APPLIANCE":
          break;
      }
    }
  }
  const order: Readonly<Record<RoomBomTotal["kind"], number>> = { BOARD: 0, EDGE_BAND: 1, FINISH: 2, HARDWARE: 3 };
  const lines: RoomBomTotal[] = [...totals.values()]
    .sort((a, b) => order[a.kind] - order[b.kind] || (a.status === b.status ? 0 : a.status === "RESOLVED" ? -1 : 1) || cmp(a.key, b.key))
    .map((t) => ({
      lineId: `ROOMBOM:${room.room.id}:${t.kind}:${t.key}`,
      kind: t.kind,
      key: t.key,
      description: t.description,
      quantity: t.unit === "M2" ? round(t.qty, AREA_DECIMALS) : t.unit === "M" ? round(t.qty, LENGTH_DECIMALS) : t.qty,
      unit: t.unit,
      status: t.status,
      sourceBomItemIds: t.ids,
    }));
  return {
    roomBomId: `ROOMBOM:${room.trace.designVersionId}:${room.room.id}`,
    trace: room.trace,
    roomFingerprint: room.roomFingerprint,
    objectBoms,
    totals: lines,
    incomplete: objectBoms.some((b) => b.incomplete) || room.cabinets.length === 0,
  };
}
