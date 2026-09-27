import type { TraceInfo } from "./resolved.js";

/** BOM = what is physically required to make the product (PRD §22). No prices. */
export type BomUnit = "NOS" | "M2" | "M";

interface BomItemBase {
  readonly bomItemId: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: BomUnit;
  readonly sourceComponentIds: readonly string[];
}

export interface PanelBomItem extends BomItemBase {
  readonly kind: "PANEL";
  readonly componentType: string;
  readonly materialId: string;
  /** Finished size, mm. Cut-size allowances belong to the manufacturing engine. */
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly grainDirection: string;
}

export interface BoardBomItem extends BomItemBase {
  readonly kind: "BOARD";
  readonly materialId: string;
  readonly thickness: number;
  readonly panelCount: number;
}

export interface EdgeBandBomItem extends BomItemBase {
  readonly kind: "EDGE_BAND";
  readonly edgeBandId: string;
}

export interface FinishBomItem extends BomItemBase {
  readonly kind: "FINISH";
  readonly finishId: string;
}

export interface HardwareBomItem extends BomItemBase {
  readonly kind: "HARDWARE";
  readonly status: "RESOLVED" | "UNRESOLVED";
  readonly manufacturer: string;
  readonly articleNumber: string | null;
  readonly category: string;
  readonly sourceRequirementIds: readonly string[];
  readonly sourceVersion: string | null;
}

/**
 * Design Studio Slice 5 (`docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md` §8): an appliance is
 * not hardware (it is referenced reference data, never a manufactured panel or a resolved Hettich article), so
 * it gets its own narrow BOM kind rather than being folded into `HardwareBomItem`. `manufacturer`/`model` stay
 * `null` until the referenced `Appliance` record itself carries them.
 */
export interface ApplianceBomItem extends BomItemBase {
  readonly kind: "APPLIANCE";
  readonly applianceId: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
}

export type BOMItem = PanelBomItem | BoardBomItem | EdgeBandBomItem | FinishBomItem | HardwareBomItem | ApplianceBomItem;

export interface BOM {
  readonly bomId: string;
  readonly trace: TraceInfo;
  readonly items: readonly BOMItem[];
  /** True when any hardware requirement is unresolved or any component is missing. */
  readonly incomplete: boolean;
}
