import type { DataClassification, DataStatus, Millimetres, VersionRef } from "./common.js";
import type { Box3 } from "./component.js";
import type { DesignState } from "./design.js";
import type { ResolvedCabinet } from "./resolved.js";
import type { ValidationResult } from "./validation.js";

/**
 * Room coordinate system (M4). Rectangular room interior:
 *   x ∈ [0, length] along wall A, z ∈ [0, width] into the room, y ∈ [0, height] up.
 * Origin = inside floor corner of walls A and D.
 *   Wall A: z = 0   Wall B: x = length   Wall C: z = width   Wall D: x = 0
 */
export type WallId = "A" | "B" | "C" | "D";

/** Only quarter turns are supported in M4 (anything else → ROTATION_UNSUPPORTED). */
export type QuarterTurn = 0 | 90 | 180 | 270;

export interface RoomWall {
  readonly wallId: WallId;
  /** Inside-face segment in plan (x, z), running left → right as seen from inside the room facing the wall. */
  readonly start: { readonly x: Millimetres; readonly z: Millimetres };
  readonly end: { readonly x: Millimetres; readonly z: Millimetres };
  readonly length: Millimetres;
  readonly height: Millimetres;
  readonly thickness: Millimetres;
}

/** Planning values (how objects may be positioned in a room). `null` = NULL / UNVERIFIED. */
export interface PlanningStandard {
  readonly standardId: string;
  readonly version: string;
  readonly status: DataStatus;
  readonly description: string;
  readonly source: string;
  readonly variables: Readonly<Record<string, number | null>>;
}

export type RelationshipOverrideType = "INTENTIONAL_GAP" | "FILLER" | "END_PANEL" | "SHARED_SIDE" | "SPECIAL_CORNER";

/** Explicit, versioned, audited manual override of a derived relationship. Never required for normal cabinets. */
export interface RelationshipOverride {
  readonly overrideId: string;
  readonly version: number;
  readonly type: RelationshipOverrideType;
  readonly objectIds: readonly string[];
  readonly reason: string;
  readonly author: string;
  readonly createdAt: string;
}

export type RelationshipType = "AGAINST_WALL" | "ADJACENT" | "SAME_WALL_RUN" | "CORNER";

export interface ObjectRelationship {
  readonly relationshipId: string;
  readonly type: RelationshipType;
  /** DERIVED from geometry, or confirmed/modified by an OVERRIDE. */
  readonly source: "DERIVED" | "OVERRIDE";
  readonly objectIds: readonly string[];
  readonly wallIds: readonly WallId[];
  /** Separation in mm (distance to wall, gap between objects, corner gap); null when not applicable. */
  readonly gap: Millimetres | null;
  /** For ADJACENT: true when the objects touch (gap = 0). */
  readonly touching: boolean | null;
  readonly overrideIds: readonly string[];
}

export interface RoomRun {
  readonly runId: string;
  readonly wallId: WallId;
  /** Ordered left → right as seen from inside the room facing the wall. */
  readonly objectIds: readonly string[];
  /** Along-wall start/end (mm from the wall's left end). */
  readonly start: Millimetres;
  readonly end: Millimetres;
  readonly length: Millimetres;
}

export interface PlacedObject {
  readonly objectId: string;
  readonly objectCode: string;
  readonly rotationY: QuarterTurn;
  /** Wall the object's back faces. */
  readonly wallId: WallId;
  /** Room-coordinate envelope of all components (incl. fronts). */
  readonly envelope: Box3;
  readonly components: readonly { readonly componentId: string; readonly box: Box3 }[];
  /** Along-wall extent (mm from the wall's left end) and distance of the back from the wall. */
  readonly alongWall: { readonly start: Millimetres; readonly end: Millimetres };
  readonly distanceToWall: Millimetres;
}

export interface RoomTrace {
  readonly engineVersion: string;
  readonly designVersionId: string;
  readonly designVersionStatus: DesignState;
  readonly projectId: string;
  readonly roomId: string;
  readonly dataClassification: DataClassification;
  readonly testFixtureSources: readonly string[];
  readonly planningStandard: VersionRef;
  readonly catalogVersion: string;
  readonly objects: readonly { readonly objectId: string; readonly objectCode: string; readonly modelFingerprint: string }[];
  readonly overrides: readonly { readonly overrideId: string; readonly version: number }[];
}

export interface ResolvedRoom {
  readonly trace: RoomTrace;
  readonly room: {
    readonly id: string;
    readonly name: string;
    readonly length: Millimetres;
    readonly width: Millimetres;
    readonly height: Millimetres;
    readonly wallThickness: Millimetres;
    readonly walls: readonly RoomWall[];
  };
  /** Resolved cabinets, ordered by objectCode then objectId. */
  readonly cabinets: readonly ResolvedCabinet[];
  readonly placements: readonly PlacedObject[];
  readonly runs: readonly RoomRun[];
  readonly relationships: readonly ObjectRelationship[];
  readonly overrides: readonly RelationshipOverride[];
  /** Room geometry + planning + every object fingerprint + placement + overrides. */
  readonly roomFingerprint: string;
  /** Object-level and room-level messages combined. */
  readonly validation: ValidationResult;
}
