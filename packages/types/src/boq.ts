import type { TraceInfo } from "./resolved.js";

/** BOQ = what is commercially measured and quoted (PRD §22). Linked to, never merged with, the BOM. */
export interface BOQItem {
  readonly boqItemId: string;
  readonly sourceObjectId: string;
  readonly productId: string;
  readonly itemCode: string;
  readonly description: string;
  readonly unit: "NOS";
  readonly quantity: number;
  readonly measures: { readonly width: number; readonly height: number; readonly depth: number };
  readonly linkedBomId: string;
}

export interface BOQ {
  readonly boqId: string;
  readonly trace: TraceInfo;
  readonly items: readonly BOQItem[];
}
