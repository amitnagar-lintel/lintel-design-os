/**
 * BOQ engine — what is commercially measured and quoted (PRD §22). Linked to the
 * BOM by id and trace; never merged with it. No prices (pricing engine, M2).
 */
import type { BOM, BOQ, BOQItem, ProductDefinition, ResolvedCabinet } from "@lintel/types";
import { evaluateNumber, interpolate } from "@lintel/rules-engine";

export class BoqGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoqGenerationError";
  }
}

export function generateBoq(resolved: ResolvedCabinet, product: ProductDefinition, bom: BOM): BOQ {
  if (product.productId !== resolved.trace.product.id || product.version !== resolved.trace.product.version) {
    throw new BoqGenerationError(`Product ${product.productId} v${product.version} does not match resolved ${resolved.trace.product.id} v${resolved.trace.product.version}`);
  }
  if (bom.trace.designVersionId !== resolved.trace.designVersionId || bom.trace.objectId !== resolved.trace.objectId) {
    throw new BoqGenerationError(`BOM ${bom.bomId} was not derived from this resolved cabinet`);
  }
  const q = evaluateNumber(product.boq.quantity, resolved.scope);
  if (!q.ok) throw new BoqGenerationError(`BOQ quantity '${product.boq.quantity}' not evaluable: ${q.error.message}`);
  const values = resolved.parameters.values;
  const measure = (k: string): number => {
    const v = values[k];
    return typeof v === "number" ? v : 0;
  };
  const item: BOQItem = {
    boqItemId: `BOQ:${resolved.trace.designVersionId}:${resolved.trace.objectId}`,
    sourceObjectId: resolved.trace.objectId,
    productId: product.productId,
    itemCode: interpolate(product.boq.itemCodeTemplate, values),
    description: interpolate(product.boq.descriptionTemplate, values),
    unit: product.boq.unit,
    quantity: q.value,
    measures: { width: measure("width"), height: measure("height"), depth: measure("depth") },
    linkedBomId: bom.bomId,
  };
  return { boqId: `BOQ:${resolved.trace.designVersionId}:${resolved.trace.objectId}`, trace: resolved.trace, items: [item] };
}

export { generateRoomBoq } from "./room.js";
