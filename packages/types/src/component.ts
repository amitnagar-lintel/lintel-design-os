import type { Millimetres, Vector3 } from "./common.js";

/** PRD §16. */
export type ComponentType =
  | "SIDE_LEFT"
  | "SIDE_RIGHT"
  | "TOP"
  | "BOTTOM"
  | "TOP_SUPPORT_FRONT"
  | "TOP_SUPPORT_BACK"
  | "BACK"
  | "SHELF"
  | "PARTITION"
  | "SHUTTER"
  | "DRAWER_FRONT"
  | "DRAWER_BOX_SIDE"
  | "DRAWER_BOX_FRONT"
  | "DRAWER_BOX_BACK"
  | "DRAWER_BOTTOM"
  | "PLINTH"
  | "FILLER"
  | "END_PANEL"
  | "KICKBOARD";

/** PRD §21 — expressed in cabinet axes (HEIGHT = Y, WIDTH = X, DEPTH = Z). */
export type GrainDirection = "HEIGHT" | "WIDTH" | "DEPTH" | "NONE";

export type PanelPlane = "YZ" | "XZ" | "XY";

/** Edge sides named by installed orientation (ported from the legacy SQL catalog). */
export type EdgeSide = "FRONT" | "BACK" | "TOP" | "BOTTOM" | "LEFT" | "RIGHT";

export interface ComponentEdge {
  readonly edgeBandId: string;
  readonly thickness: Millimetres;
  /** Banded edge length (finished panel edge). */
  readonly length: Millimetres;
}

/** Axis-aligned box in cabinet-local coordinates (origin = rear-left-bottom corner). */
export interface Box3 {
  readonly min: Vector3;
  readonly size: Vector3;
}

export interface ComponentGeometry {
  readonly plane: PanelPlane;
  readonly local: Box3;
}

/** PRD §16. Finished panel dimensions in the panel's face frame. */
export interface CabinetComponent {
  /** Deterministic, human-readable (PRD §17), e.g. OBJ-KIT-001-SHT-L. */
  readonly componentId: string;
  readonly sourceObjectId: string;
  readonly templateId: string;
  readonly instanceIndex: number;
  readonly componentType: ComponentType;
  readonly dimensions: {
    readonly width: Millimetres;
    readonly height: Millimetres;
    readonly thickness: Millimetres;
  };
  readonly materialId: string;
  readonly finishId: string | null;
  readonly finishedFaces: number;
  readonly edges: Readonly<Partial<Record<EdgeSide, ComponentEdge>>>;
  readonly grainDirection: GrainDirection;
  /** Drilling is resolved from manufacturer data; empty until the drilling model lands (M2+). */
  readonly drilling: readonly never[];
  /** Ids of HardwareRequirements attached to this component. */
  readonly hardwareLinks: readonly string[];
  readonly quantity: 1;
  /** Reserved for the manufacturing engine (Phase 7). */
  readonly manufacturingData: null;
  readonly geometry: ComponentGeometry;
}
