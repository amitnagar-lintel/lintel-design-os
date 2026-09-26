import type { ResolvedRoom, RoomTrace } from "@lintel/types";

export interface RoomChange {
  readonly stale: boolean;
  readonly reasons: readonly string[];
  /** Objects whose model changed, was added, or was removed. */
  readonly changedObjectIds: readonly string[];
}

/**
 * Compare a derived artifact's room trace (quotation, room drawing) with the current room.
 * Reports exactly which objects changed; falls back to "layout changed" when only placement,
 * planning standard or overrides differ.
 */
export function compareRoomTrace(before: RoomTrace, beforeFingerprint: string, current: ResolvedRoom): RoomChange {
  const reasons: string[] = [];
  const changed: string[] = [];
  if (before.designVersionId !== current.trace.designVersionId) reasons.push(`Design version changed: artifact ${before.designVersionId}, current ${current.trace.designVersionId}`);
  const prev = new Map(before.objects.map((o) => [o.objectId, o]));
  const next = new Map(current.trace.objects.map((o) => [o.objectId, o]));
  for (const [id, o] of next) {
    const b = prev.get(id);
    if (b === undefined) {
      reasons.push(`Object added: ${o.objectCode}`);
      changed.push(id);
    } else if (b.modelFingerprint !== o.modelFingerprint) {
      reasons.push(`Object changed: ${o.objectCode}`);
      changed.push(id);
    }
  }
  for (const [id, o] of prev) {
    if (!next.has(id)) {
      reasons.push(`Object removed: ${o.objectCode}`);
      changed.push(id);
    }
  }
  if (reasons.length === 0 && beforeFingerprint !== current.roomFingerprint) reasons.push("Room layout changed (placement, planning standard or overrides)");
  return { stale: reasons.length > 0, reasons, changedObjectIds: changed.sort() };
}
