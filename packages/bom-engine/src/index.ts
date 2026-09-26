/**
 * BOM engine — what is physically required to make the product (PRD §22).
 * Quantities only: no prices, rates or wastage (those belong to pricing and
 * manufacturing). Every line traces to its source components / requirements.
 */
import type {
  BOM,
  BOMItem,
  BoardBomItem,
  EdgeBandBomItem,
  FinishBomItem,
  HardwareBomItem,
  PanelBomItem,
  ResolvedArticleLine,
  ResolvedCabinet,
} from "@lintel/types";

/** Reporting precision for aggregated measures (m², m). Not a business rule. */
/** Semantic version of the BOM engine (M5 Step 7); recorded with every BOM snapshot beside the engine fingerprint. */
export const BOM_ENGINE_VERSION = "0.1.0";

export const AREA_DECIMALS = 6;
export const LENGTH_DECIMALS = 4;

const MM2_PER_M2 = 1_000_000;
const MM_PER_M = 1_000;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}

const byKey = <T>(m: Map<string, T>): [string, T][] => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function bomId(resolved: ResolvedCabinet): string {
  return `BOM:${resolved.trace.designVersionId}:${resolved.trace.objectId}`;
}

export function generateBom(resolved: ResolvedCabinet): BOM {
  const src = resolved.trace.objectId;
  const items: BOMItem[] = [];

  // Panels: one line per component (finished size).
  for (const c of resolved.components) {
    const { width, height, thickness } = c.dimensions;
    items.push({
      kind: "PANEL",
      bomItemId: `BOM:${c.componentId}`,
      description: `${c.componentType} ${width} × ${height} × ${thickness} mm, ${c.materialId}`,
      quantity: c.quantity,
      unit: "NOS",
      sourceComponentIds: [c.componentId],
      componentType: c.componentType,
      materialId: c.materialId,
      width,
      height,
      thickness,
      grainDirection: c.grainDirection,
    } satisfies PanelBomItem);
  }

  // Board area by material (net finished area; no wastage).
  const boards = new Map<string, { area: number; thickness: number; ids: string[] }>();
  const edges = new Map<string, { length: number; ids: string[] }>();
  const finishes = new Map<string, { area: number; ids: string[] }>();
  for (const c of resolved.components) {
    const area = c.dimensions.width * c.dimensions.height * c.quantity;
    const b = boards.get(c.materialId) ?? { area: 0, thickness: c.dimensions.thickness, ids: [] };
    b.area += area;
    b.ids.push(c.componentId);
    boards.set(c.materialId, b);
    for (const e of Object.values(c.edges)) {
      const x = edges.get(e.edgeBandId) ?? { length: 0, ids: [] };
      x.length += e.length * c.quantity;
      if (!x.ids.includes(c.componentId)) x.ids.push(c.componentId);
      edges.set(e.edgeBandId, x);
    }
    if (c.finishId !== null && c.finishedFaces > 0) {
      const f = finishes.get(c.finishId) ?? { area: 0, ids: [] };
      f.area += area * c.finishedFaces;
      f.ids.push(c.componentId);
      finishes.set(c.finishId, f);
    }
  }
  for (const [materialId, b] of byKey(boards)) {
    items.push({
      kind: "BOARD",
      bomItemId: `BOM:${src}:BOARD:${materialId}`,
      description: `${materialId} board, net area`,
      quantity: round(b.area / MM2_PER_M2, AREA_DECIMALS),
      unit: "M2",
      sourceComponentIds: b.ids,
      materialId,
      thickness: b.thickness,
      panelCount: b.ids.length,
    } satisfies BoardBomItem);
  }
  for (const [edgeBandId, e] of byKey(edges)) {
    items.push({
      kind: "EDGE_BAND",
      bomItemId: `BOM:${src}:EDGE:${edgeBandId}`,
      description: `${edgeBandId}, net banded length`,
      quantity: round(e.length / MM_PER_M, LENGTH_DECIMALS),
      unit: "M",
      sourceComponentIds: e.ids,
      edgeBandId,
    } satisfies EdgeBandBomItem);
  }
  for (const [finishId, f] of byKey(finishes)) {
    items.push({
      kind: "FINISH",
      bomItemId: `BOM:${src}:FINISH:${finishId}`,
      description: `${finishId}, net finished area`,
      quantity: round(f.area / MM2_PER_M2, AREA_DECIMALS),
      unit: "M2",
      sourceComponentIds: f.ids,
      finishId,
    } satisfies FinishBomItem);
  }

  // Hardware: resolved article lines aggregated; unresolved requirements stay visible.
  const reqById = new Map(resolved.hardwareRequirements.map((r) => [r.requirementId, r]));
  interface ArticleAggregate {
    readonly line: ResolvedArticleLine;
    qty: number;
    readonly reqs: string[];
    readonly comps: string[];
  }
  const articles = new Map<string, ArticleAggregate>();
  const unresolved: HardwareBomItem[] = [];
  for (const res of resolved.hardwareResolutions) {
    const req = reqById.get(res.requirementId);
    const compId = req?.sourceComponentId;
    if (res.status === "UNRESOLVED") {
      unresolved.push({
        kind: "HARDWARE",
        bomItemId: `BOM:${res.requirementId}:UNRESOLVED`,
        description: `UNRESOLVED ${req?.category ?? "hardware"} for ${compId ?? res.requirementId}`,
        quantity: 0,
        unit: "NOS",
        sourceComponentIds: compId === undefined ? [] : [compId],
        status: "UNRESOLVED",
        manufacturer: res.manufacturer,
        articleNumber: null,
        category: req?.category ?? "UNKNOWN",
        sourceRequirementIds: [res.requirementId],
        sourceVersion: null,
      });
      continue;
    }
    for (const l of res.lines) {
      const key = `${l.manufacturer}:${l.articleNumber}`;
      const a: ArticleAggregate = articles.get(key) ?? { line: l, qty: 0, reqs: [], comps: [] };
      a.qty += l.quantity;
      a.reqs.push(res.requirementId);
      if (compId !== undefined && !a.comps.includes(compId)) a.comps.push(compId);
      articles.set(key, a);
    }
  }
  for (const [key, a] of byKey(articles)) {
    items.push({
      kind: "HARDWARE",
      bomItemId: `BOM:${src}:HW:${key}`,
      description: a.line.description,
      quantity: a.qty,
      unit: "NOS",
      sourceComponentIds: a.comps,
      status: "RESOLVED",
      manufacturer: a.line.manufacturer,
      articleNumber: a.line.articleNumber,
      category: a.line.category,
      sourceRequirementIds: a.reqs,
      sourceVersion: a.line.sourceVersion,
    });
  }
  items.push(...unresolved);

  // Incomplete when hardware is unresolved or any expected component was omitted, whatever the
  // reason (undefined construction value, unresolved material, invalid dimension, …).
  const generated = new Set(resolved.components.map((c) => c.componentId));
  const omitted = resolved.validation.messages.some((m) => m.severity === "BLOCKER" && m.componentId !== undefined && !generated.has(m.componentId));
  const incomplete = unresolved.length > 0 || omitted;
  return { bomId: bomId(resolved), trace: resolved.trace, items, incomplete };
}

export { generateRoomBom } from "./room.js";
