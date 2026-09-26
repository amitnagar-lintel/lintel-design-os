/** Builds intake files for tests. The data objects come from the repository or from each test; nothing here is a Lintel value. */
import type { IntakeType } from "../../src/intake/spec.js";
import { INTAKE_FORMAT } from "../../src/intake/spec.js";

export interface IntakeOver {
  readonly intent?: "WORKING_DRAFT" | "PRODUCTION_CANDIDATE";
  readonly versionNumber?: number;
  readonly classification?: string;
  readonly source?: string;
  readonly changeReason?: string;
  readonly sourceRef?: Record<string, string | null>;
  readonly provenance?: Record<string, { unit: string | null; source: string | null; evidenceRef: string | null; note: string | null }>;
  readonly recipe?: { entityCode: string; versionNumber: number };
}

/** The source the envelope carries: the data's own `source` where it has one (a pricing standard: its rate card's). */
function sourceOf(data: unknown): string {
  const d = data as { source?: unknown; rateCard?: { source?: unknown } };
  if (typeof d.source === "string") return d.source;
  if (typeof d.rateCard?.source === "string") return d.rateCard.source;
  return "Test intake source";
}

export function intakeObject(type: IntakeType, entityCode: string, data: unknown, o: IntakeOver = {}): Record<string, unknown> {
  return {
    format: INTAKE_FORMAT,
    type,
    classification: o.classification ?? "PRODUCTION",
    intent: o.intent ?? "WORKING_DRAFT",
    entityCode,
    versionNumber: o.versionNumber ?? 1,
    changeReason: o.changeReason ?? "Test intake",
    source: o.source ?? sourceOf(data),
    sourceRef: o.sourceRef ?? { url: null, documentTitle: null, documentVersion: null, sourceDate: null },
    data,
    ...(o.provenance === undefined ? {} : { provenance: o.provenance }),
    ...(o.recipe === undefined ? {} : { recipe: o.recipe }),
  };
}

export function intakeFile(type: IntakeType, entityCode: string, data: unknown, o: IntakeOver = {}): string {
  return JSON.stringify(intakeObject(type, entityCode, data, o), null, 2);
}
