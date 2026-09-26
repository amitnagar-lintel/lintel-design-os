import { z } from "zod";
import { Uuid } from "../../common/http/schemas.js";

/** A design belongs to one room (and so one project) for its whole life; its versions carry the content. */
export const DesignCreate = z.strictObject({ name: z.string().trim().min(1).max(200) });
export type DesignCreate = z.infer<typeof DesignCreate>;
export const DesignUpdate = z.strictObject({ name: z.string().trim().min(1).max(200).optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() })
  .refine((o) => Object.keys(o).length > 0, "at least one field");
export type DesignUpdate = z.infer<typeof DesignUpdate>;
export const DesignId = z.strictObject({ designId: Uuid });
export const DesignResponse = z.strictObject({ id: Uuid, projectId: Uuid, roomId: Uuid, name: z.string(), status: z.enum(["ACTIVE", "ARCHIVED"]), createdAt: z.string() });
export type DesignResponse = z.infer<typeof DesignResponse>;
