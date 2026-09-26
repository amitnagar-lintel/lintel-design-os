import { z } from "zod";
import { IdentityKind, Uuid } from "../../common/http/schemas.js";

export const MeResponse = z.strictObject({
  userId: Uuid,
  orgId: Uuid,
  identityKind: IdentityKind,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const MyOrganizationsResponse = z.strictObject({ items: z.array(z.strictObject({ orgId: Uuid })) });
export type MyOrganizationsResponse = z.infer<typeof MyOrganizationsResponse>;
