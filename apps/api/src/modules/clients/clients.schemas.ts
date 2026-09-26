import { z } from "zod";
import { Uuid } from "../../common/http/schemas.js";

const Code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, "1-64 characters: letters, digits, _ . -");
const Name = z.string().trim().min(1).max(200);
const Ref = z.string().trim().min(1).max(100).nullable();
/** Free-form contact details (text values only); ops references are opaque text (D7). */
const Contact = z.record(z.string().min(1).max(64), z.string().max(500)).refine((o) => Object.keys(o).length <= 20, "at most 20 fields").nullable();

export const ClientCreate = z.strictObject({ clientCode: Code, name: Name, contact: Contact.optional(), opsClientRef: Ref.optional(), opsLeadRef: Ref.optional() });
export type ClientCreate = z.infer<typeof ClientCreate>;
export const ClientUpdate = z.strictObject({ name: Name.optional(), contact: Contact.optional(), opsClientRef: Ref.optional(), opsLeadRef: Ref.optional() })
  .refine((o) => Object.keys(o).length > 0, "at least one field");
export type ClientUpdate = z.infer<typeof ClientUpdate>;
export const ClientId = z.strictObject({ clientId: Uuid });

export const ClientResponse = z.strictObject({
  id: Uuid, clientCode: z.string(), name: z.string(), contact: z.record(z.string(), z.string()).nullable(),
  opsClientRef: z.string().nullable(), opsLeadRef: z.string().nullable(), createdAt: z.string(),
});
export type ClientResponse = z.infer<typeof ClientResponse>;
