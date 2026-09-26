import { z } from "zod";
import { NonNegativeMillimetres, PositiveMillimetres } from "../../common/http/measures.js";
import { Uuid } from "../../common/http/schemas.js";

/** A site survey: only surveyed dimensions — never engine-derived geometry (that is always calculated). */
export const SurveyInput = z.strictObject({
  lengthMm: PositiveMillimetres,
  widthMm: PositiveMillimetres,
  heightMm: PositiveMillimetres,
  wallThicknessMm: NonNegativeMillimetres,
  source: z.string().trim().min(1).max(200),
  surveyedAt: z.iso.datetime({ offset: true }).optional(),
});
export type SurveyInput = z.infer<typeof SurveyInput>;

export const RoomCreate = z.strictObject({ name: z.string().trim().min(1).max(200), roomType: z.literal("KITCHEN"), initialSurvey: SurveyInput.optional() });
export type RoomCreate = z.infer<typeof RoomCreate>;
export const RoomUpdate = z.strictObject({ name: z.string().trim().min(1).max(200) });
export type RoomUpdate = z.infer<typeof RoomUpdate>;
export const RoomId = z.strictObject({ roomId: Uuid });
export const RevisionId = z.strictObject({ revisionId: Uuid });

export const RevisionResponse = z.strictObject({
  id: Uuid, roomId: Uuid, revisionNumber: z.number().int(), lengthMm: z.number(), widthMm: z.number(), heightMm: z.number(), wallThicknessMm: z.number(),
  source: z.string(), surveyedBy: Uuid, surveyedAt: z.string(), contentHash: z.string(),
});
export type RevisionResponse = z.infer<typeof RevisionResponse>;
export const RoomResponse = z.strictObject({
  id: Uuid, projectId: Uuid, name: z.string(), roomType: z.literal("KITCHEN"), createdAt: z.string(), latestRevision: RevisionResponse.nullable(),
});
export type RoomResponse = z.infer<typeof RoomResponse>;
