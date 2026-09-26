import type {
  DesignVersion,
  Drawing,
  DrawingPrimitive,
  DrawingSheet,
  DrawingStaleness,
  DrawingStatus,
  DrawingType,
  ResolvedCabinet,
  TitleBlock,
  ValidationMessage,
} from "@lintel/types";
import { deepFreeze, hash53, stableStringify } from "@lintel/types";
import { assertProductionEligible, modelFingerprint, ProductionGuardError } from "@lintel/design-engine";
import { layoutElevation } from "./elevation.js";
import { layoutSideSection } from "./section.js";
import { layoutSchedulePage, ROWS_PER_SHEET, scheduleRows } from "./schedule.js";
import { A3, frame, notes, titleBlock, watermark } from "./sheet.js";

export { DRAWING_ENGINE_VERSION } from "./version.js";

/** PRD §34 metadata supplied by the caller (never read from the clock or environment). */
export interface DrawingMetadataInput {
  readonly projectCode: string;
  readonly room: string;
  readonly drawingNumber: string;
  readonly revision: string;
  /** ISO date, e.g. 2026-09-26. */
  readonly date: string;
  readonly designer: string;
  readonly checker: string;
}

export interface CreateDrawingInput {
  readonly resolved: ResolvedCabinet;
  /** The DesignVersion as it is now (used for the production guard). */
  readonly designVersion: DesignVersion;
  readonly metadata: DrawingMetadataInput;
  readonly requestedStatus?: DrawingStatus;
  /** SIDE_SECTION only: cut position along the cabinet width (default: centre of the leftmost front). */
  readonly cutX?: number;
}

export type DrawingResult = { readonly status: "CREATED"; readonly drawing: Drawing } | { readonly status: "REFUSED"; readonly blockers: readonly ValidationMessage[] };

const TITLES: Readonly<Record<DrawingType, string>> = {
  FRONT_ELEVATION: "FRONT ELEVATION",
  PANEL_SCHEDULE: "PANEL SCHEDULE",
  SIDE_SECTION: "SIDE SECTION",
};

const NOTE_BY_TYPE: Readonly<Record<DrawingType, string>> = {
  FRONT_ELEVATION: "Front view; hidden edges dashed. Dimensions are read from the resolved model, not measured from this drawing.",
  PANEL_SCHEDULE: "Edge codes: F front, BK back, T top, BT bottom, L left, R right.",
  SIDE_SECTION: "Section viewed from the left (back on the left, front on the right); cut panels heavy and hatched. Dimensions are read from the resolved model.",
};

const refuse = (code: string, message: string): ValidationMessage => ({ code, severity: "BLOCKER", message });

/**
 * FOR_PRODUCTION is only reachable when the design version is APPROVED/LOCKED, the model
 * was resolved from that approved version, has zero blockers, and contains no TEST_FIXTURE data.
 */
function guard(input: CreateDrawingInput, status: DrawingStatus): ValidationMessage[] {
  const { resolved, designVersion } = input;
  const out: ValidationMessage[] = [];
  if (designVersion.designVersionId !== resolved.trace.designVersionId) {
    out.push(refuse("DRAWING_TRACE_MISMATCH", `Resolved model belongs to ${resolved.trace.designVersionId}, not ${designVersion.designVersionId}`));
  }
  if (status !== "FOR_PRODUCTION") return out;
  try {
    assertProductionEligible(designVersion, resolved.validation);
  } catch (e) {
    if (!(e instanceof ProductionGuardError)) throw e;
    out.push(refuse("DRAWING_PRODUCTION_GUARD", e.message));
  }
  if (resolved.trace.designVersionStatus !== "APPROVED" && resolved.trace.designVersionStatus !== "LOCKED") {
    out.push(refuse("DRAWING_MODEL_NOT_FROM_APPROVED_VERSION", `Model was resolved while the design version was ${resolved.trace.designVersionStatus}; re-resolve the approved version`));
  }
  if (resolved.trace.dataClassification !== "PRODUCTION") {
    out.push(refuse("DRAWING_TEST_FIXTURE_DATA", `Model uses TEST_FIXTURE data (${resolved.trace.testFixtureSources.join("; ")})`));
  }
  return out;
}

function watermarkFor(resolved: ResolvedCabinet): string | null {
  if (resolved.trace.dataClassification === "TEST_FIXTURE") return "TEST FIXTURE DATA - NOT FOR PRODUCTION";
  if (!resolved.validation.canApprove) return `BLOCKED DATA - NOT FOR PRODUCTION (${resolved.validation.counts.BLOCKER} BLOCKERS)`;
  return null;
}

function drawingNotes(resolved: ResolvedCabinet, type: DrawingType): string[] {
  const n: string[] = [
    "All dimensions in millimetres. Panel sizes are finished sizes (cut-size allowances are applied in manufacturing).",
    NOTE_BY_TYPE[type],
    `Derived from design version ${resolved.trace.designVersionId}; product ${resolved.trace.product.id} v${resolved.trace.product.version}; recipe ${resolved.trace.recipe.id} v${resolved.trace.recipe.version}; standard ${resolved.trace.standard.id} v${resolved.trace.standard.version} (${resolved.trace.standard.status}).`,
  ];
  if (resolved.trace.dataClassification === "TEST_FIXTURE") n.push(`TEST FIXTURE data in use: ${resolved.trace.testFixtureSources.join("; ")}. Values are synthetic.`);
  const missing = resolved.validation.messages.filter((m) => m.code === "COMPONENT_NOT_GENERATED").map((m) => m.componentId ?? "?");
  if (missing.length > 0) n.push(`Components NOT GENERATED (construction values undefined): ${missing.join(", ")}.`);
  if (!resolved.validation.canApprove) n.push(`${resolved.validation.counts.BLOCKER} validation BLOCKER(s) outstanding: this drawing must not be used for production.`);
  return n;
}

function build(type: DrawingType, input: CreateDrawingInput): DrawingResult {
  const status = input.requestedStatus ?? "PRELIMINARY";
  const blockers = guard(input, status);
  if (blockers.length > 0) return { status: "REFUSED", blockers };

  const { resolved, metadata } = input;
  const fingerprint = modelFingerprint(resolved);
  const mark = watermarkFor(resolved);

  let pages: DrawingPrimitive[][];
  let scale: string;
  if (type === "FRONT_ELEVATION") {
    const layout = layoutElevation(resolved.components, resolved.object.objectCode);
    pages = [layout.primitives];
    scale = layout.scale;
  } else if (type === "SIDE_SECTION") {
    const layout = layoutSideSection(resolved.components, resolved.object.objectCode, input.cutX);
    pages = [layout.primitives];
    scale = layout.scale;
  } else {
    const rows = scheduleRows(resolved);
    pages = [];
    for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_SHEET) pages.push(layoutSchedulePage(rows.slice(i, i + ROWS_PER_SHEET), `PANEL SCHEDULE  ${resolved.object.objectCode}`));
    scale = "NTS";
  }

  const tb: TitleBlock = {
    projectId: resolved.object.projectId,
    projectCode: metadata.projectCode,
    room: metadata.room,
    drawingNumber: metadata.drawingNumber,
    drawingTitle: `${TITLES[type]} - ${resolved.object.objectCode}`,
    revision: metadata.revision,
    date: metadata.date,
    designer: metadata.designer,
    checker: metadata.checker,
    scale,
    approvalStatus: status,
    sourceDesignVersionId: resolved.trace.designVersionId,
    sourceDesignVersionStatus: resolved.trace.designVersionStatus,
    modelFingerprint: fingerprint,
    dataClassification: resolved.trace.dataClassification,
  };
  const noteLines = drawingNotes(resolved, type);
  const sheets: DrawingSheet[] = pages.map((content, i) => {
    const label = `SHEET ${i + 1} OF ${pages.length}`;
    // Watermark first so it sits behind the drawing.
    const primitives = [...(mark === null ? [] : watermark(mark)), ...frame(label), ...content, ...notes(noteLines), ...titleBlock(tb, label)];
    return { sheetNumber: i + 1, paper: A3, primitives };
  });

  const body: Omit<Drawing, "contentHash"> = {
    drawingId: `DRW:${resolved.trace.designVersionId}:${resolved.trace.objectId}:${type}:${metadata.drawingNumber}:R${metadata.revision}`,
    type,
    titleBlock: tb,
    status,
    watermark: mark,
    trace: JSON.parse(JSON.stringify(resolved.trace)) as Drawing["trace"],
    modelFingerprint: fingerprint,
    componentIds: resolved.components.map((c) => c.componentId),
    notes: noteLines,
    sheets,
  };
  return { status: "CREATED", drawing: deepFreeze({ ...body, contentHash: hash53(stableStringify(body)) }) };
}

/** PRD §33 Front Elevation of one resolved cabinet. Pure. */
export function createFrontElevation(input: CreateDrawingInput): DrawingResult {
  return build("FRONT_ELEVATION", input);
}

/** PRD §33 Side Section of one resolved cabinet. Pure. */
export function createSideSection(input: CreateDrawingInput): DrawingResult {
  return build("SIDE_SECTION", input);
}

/** PRD §33 Panel Schedule of one resolved cabinet. Pure. */
export function createPanelSchedule(input: CreateDrawingInput): DrawingResult {
  return build("PANEL_SCHEDULE", input);
}

/** Recompute the content hash; false means the drawing was altered after creation. */
export function verifyDrawing(drawing: Drawing): boolean {
  const { contentHash, ...body } = drawing;
  return hash53(stableStringify(body)) === contentHash;
}

/** A drawing is stale when its source design version or resolved model no longer matches. */
export function checkDrawingStaleness(drawing: Drawing, current: ResolvedCabinet): DrawingStaleness {
  const reasons: string[] = [];
  if (drawing.trace.designVersionId !== current.trace.designVersionId) {
    reasons.push(`Design version changed: drawing ${drawing.trace.designVersionId}, current ${current.trace.designVersionId}`);
  }
  const now = modelFingerprint(current);
  if (drawing.modelFingerprint !== now) reasons.push(`Model changed: drawing fingerprint ${drawing.modelFingerprint}, current ${now}`);
  return { stale: reasons.length > 0, reasons };
}
