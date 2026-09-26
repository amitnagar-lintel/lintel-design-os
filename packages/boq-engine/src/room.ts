import type { BOQ, CatalogSnapshot, ResolvedRoom, RoomBOM, RoomBOQ } from "@lintel/types";
import { BoqGenerationError, generateBoq } from "./index.js";

/** Combined room BOQ: every object's BOQ intact (each linked to its own BOM), linked to the room BOM. */
export function generateRoomBoq(room: ResolvedRoom, catalog: CatalogSnapshot, roomBom: RoomBOM): RoomBOQ {
  if (roomBom.roomFingerprint !== room.roomFingerprint) throw new BoqGenerationError(`Room BOM ${roomBom.roomBomId} was not derived from this room model`);
  const objectBoqs: BOQ[] = room.cabinets.map((c, i) => {
    const product = catalog.products.find((p) => p.productId === c.trace.product.id && p.version === c.trace.product.version);
    const bom = roomBom.objectBoms[i];
    if (product === undefined) throw new BoqGenerationError(`Product ${c.trace.product.id} v${c.trace.product.version} not in catalog ${catalog.catalogVersion}`);
    if (bom === undefined || bom.trace.objectId !== c.trace.objectId) throw new BoqGenerationError(`Room BOM has no BOM for ${c.trace.objectId}`);
    return generateBoq(c, product, bom);
  });
  return {
    roomBoqId: `ROOMBOQ:${room.trace.designVersionId}:${room.room.id}`,
    trace: room.trace,
    roomFingerprint: room.roomFingerprint,
    roomBomId: roomBom.roomBomId,
    objectBoqs,
    items: objectBoqs.flatMap((b) => b.items),
  };
}
