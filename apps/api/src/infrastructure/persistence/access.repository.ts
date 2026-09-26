import type { Tx } from "../../common/db/tx.js";

/** SQL for identity → membership → org context. Reads only the caller's own rows (RLS and definer functions). */
export const accessRepository = {
  async memberships(tx: Tx): Promise<string[]> {
    return (await tx.query<{ org_id: string }>("SELECT org_id::text AS org_id FROM design_os.current_memberships()")).map((r) => r.org_id);
  },
  async orgContext(tx: Tx): Promise<{ org_id: string | null; internal: boolean | null; roles: string[]; permissions: string[] }> {
    return tx.one(`
      SELECT design_os.current_org_id()::text AS org_id,
             design_os.is_internal() AS internal,
             ARRAY(SELECT m.role::text FROM design_os.org_membership m
                   WHERE m.org_id = design_os.current_org_id() AND m.user_id = design_os.current_user_id() AND m.status = 'ACTIVE' ORDER BY 1) AS roles,
             ARRAY(SELECT p.action FROM design_os.permission p WHERE design_os.has_permission(p.action) ORDER BY 1) AS permissions`);
  },
};
