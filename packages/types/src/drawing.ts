import type { DataClassification } from "./common.js";
import type { DesignState } from "./design.js";
import type { TraceInfo } from "./resolved.js";
import type { RoomTrace, WallId } from "./room.js";

/** PRD §33 V1 drawing types implemented so far. */
export type DrawingType = "FRONT_ELEVATION" | "PANEL_SCHEDULE" | "SIDE_SECTION" | "CABINET_INTERNAL_ELEVATION";

/** Issue status. FOR_PRODUCTION is only reachable through the production guard. */
export type DrawingStatus = "PRELIMINARY" | "FOR_REVIEW" | "FOR_PRODUCTION";

export type DrawingLayer = "BORDER" | "TITLE_BLOCK" | "VISIBLE" | "HIDDEN" | "DIMENSION" | "ANNOTATION" | "TABLE" | "WATERMARK";

/** Sheet coordinates in millimetres, origin top-left, y down. */
export type DrawingPrimitive =
  | {
      readonly kind: "line";
      readonly layer: DrawingLayer;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly dashed: boolean;
      readonly weight: "THIN" | "MEDIUM" | "THICK";
    }
  | {
      readonly kind: "text";
      readonly layer: DrawingLayer;
      readonly x: number;
      readonly y: number;
      /** ASCII only (portable to SVG and PDF standard fonts). */
      readonly text: string;
      /** Cap height in mm. */
      readonly size: number;
      readonly anchor: "start" | "middle" | "end";
      readonly bold: boolean;
      /** Degrees, counter-clockwise. */
      readonly rotate: number;
    };

export interface DrawingSheet {
  readonly sheetNumber: number;
  readonly paper: { readonly name: "A3"; readonly width: number; readonly height: number };
  readonly primitives: readonly DrawingPrimitive[];
}

/** PRD §34 drawing metadata, plus the model fingerprint and data classification. */
export interface TitleBlock {
  readonly projectId: string;
  readonly projectCode: string;
  readonly room: string;
  readonly drawingNumber: string;
  readonly drawingTitle: string;
  readonly revision: string;
  readonly date: string;
  readonly designer: string;
  readonly checker: string;
  readonly scale: string;
  readonly approvalStatus: DrawingStatus;
  readonly sourceDesignVersionId: string;
  readonly sourceDesignVersionStatus: DesignState;
  readonly modelFingerprint: string;
  readonly dataClassification: DataClassification;
}

export interface Drawing {
  readonly drawingId: string;
  readonly type: DrawingType;
  readonly titleBlock: TitleBlock;
  readonly status: DrawingStatus;
  /** Present whenever the drawing may not be used for production (fixture data or blockers). */
  readonly watermark: string | null;
  readonly trace: TraceInfo;
  readonly modelFingerprint: string;
  /** Components shown on the drawing. */
  readonly componentIds: readonly string[];
  readonly notes: readonly string[];
  readonly sheets: readonly DrawingSheet[];
  /** Hash of every other field; `verifyDrawing` recomputes it. */
  readonly contentHash: string;
}

export interface DrawingStaleness {
  readonly stale: boolean;
  readonly reasons: readonly string[];
}

/** Room-level drawings (M4). */
export type RoomDrawingType = "WALL_INTERNAL_ELEVATION" | "ROOM_PANEL_SCHEDULE";

export interface RoomDrawing {
  readonly drawingId: string;
  readonly type: RoomDrawingType;
  /** Wall shown (WALL_INTERNAL_ELEVATION), otherwise null. */
  readonly wallId: WallId | null;
  readonly titleBlock: TitleBlock;
  readonly status: DrawingStatus;
  readonly watermark: string | null;
  readonly trace: RoomTrace;
  /** Room fingerprint (also shown in the title block). */
  readonly modelFingerprint: string;
  /** Objects shown on the drawing. */
  readonly objectIds: readonly string[];
  readonly notes: readonly string[];
  readonly sheets: readonly DrawingSheet[];
  readonly contentHash: string;
}

export interface RoomDrawingStaleness {
  readonly stale: boolean;
  readonly reasons: readonly string[];
  readonly changedObjectIds: readonly string[];
}
