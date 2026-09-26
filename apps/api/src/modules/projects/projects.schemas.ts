import { z } from "zod";
import { Reason, Uuid } from "../../common/http/schemas.js";

const Code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, "1-64 characters: letters, digits, _ . -");
const Name = z.string().trim().min(1).max(200);
const Ref = z.string().trim().min(1).max(100).nullable();
const Address = z.record(z.string().min(1).max(64), z.string().max(500)).refine((o) => Object.keys(o).length <= 20, "at most 20 fields").nullable();
export const Role = z.enum(["ADMIN", "DESIGNER", "DESIGN_HEAD", "SALES", "COSTING", "FINANCE", "PROCUREMENT", "PRODUCTION", "SITE_ENGINEER", "CLIENT"]);

/** A project always belongs to exactly one client of the organization; the association is fixed at creation. */
export const ProjectCreate = z.strictObject({ clientId: Uuid, projectCode: Code, name: Name, siteAddress: Address.optional(), opsProjectRef: Ref.optional() });
export type ProjectCreate = z.infer<typeof ProjectCreate>;
export const ProjectUpdate = z.strictObject({ name: Name.optional(), siteAddress: Address.optional(), opsProjectRef: Ref.optional() })
  .refine((o) => Object.keys(o).length > 0, "at least one field");
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;
export const ProjectId = z.strictObject({ projectId: Uuid });

export const ProjectResponse = z.strictObject({
  id: Uuid, clientId: Uuid, projectCode: z.string(), name: z.string(), siteAddress: z.record(z.string(), z.string()).nullable(),
  status: z.string(), currency: z.literal("INR"), unitSystem: z.literal("MM"), opsProjectRef: z.string().nullable(), createdAt: z.string(),
});
export type ProjectResponse = z.infer<typeof ProjectResponse>;

/** A CLIENT member is always tied to one of the project client's contacts; no other role has a contact (D10). */
export const MemberAssign = z.strictObject({ userId: Uuid, role: Role, clientContactId: Uuid.optional() })
  .refine((m) => (m.role === "CLIENT") === (m.clientContactId !== undefined), { message: "clientContactId is required for (and only for) the CLIENT role", path: ["clientContactId"] });
export type MemberAssign = z.infer<typeof MemberAssign>;
export const MemberRevoke = z.strictObject({ userId: Uuid, role: Role, reason: Reason });
export type MemberRevoke = z.infer<typeof MemberRevoke>;
export const MemberResponse = z.strictObject({ projectId: Uuid, userId: Uuid, role: Role, clientContactId: Uuid.nullable(), grantedBy: Uuid, grantedAt: z.string() });
export type MemberResponse = z.infer<typeof MemberResponse>;
export const MemberList = z.strictObject({ items: z.array(MemberResponse) });
export const MemberRevoked = z.strictObject({ revoked: MemberResponse });
