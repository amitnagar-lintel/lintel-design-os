import type { BOM, BOMItem, CabinetComponent, ResolvedCabinet } from "@lintel/types";

export const comp = (r: ResolvedCabinet, id: string): CabinetComponent => {
  const c = r.components.find((x) => x.componentId === id);
  if (c === undefined) throw new Error(`component ${id} not found`);
  return c;
};
export const dims = (c: CabinetComponent): [number, number, number] => [c.dimensions.width, c.dimensions.height, c.dimensions.thickness];
export const pos = (c: CabinetComponent): [number, number, number] => [c.geometry.local.min.x, c.geometry.local.min.y, c.geometry.local.min.z];
export const bomItem = (b: BOM, id: string): BOMItem => {
  const i = b.items.find((x) => x.bomItemId === id);
  if (i === undefined) throw new Error(`BOM item ${id} not found`);
  return i;
};
export const codes = (r: ResolvedCabinet): string[] => r.validation.messages.map((m) => m.code);
