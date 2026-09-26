import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

export interface ProjectRow {
  readonly id: string;
  readonly org_id: string;
  readonly client_id: string;
  readonly project_code: string;
  readonly name: string;
  readonly site_address: Readonly<Record<string, unknown>> | null;
  readonly status: string;
  readonly currency: string;
  readonly unit_system: string;
  readonly ops_project_ref: string | null;
  readonly created_at: string;
}

export interface ProjectMemberRow {
  readonly org_id: string;
  readonly project_id: string;
  readonly user_id: string;
  readonly role: string;
  readonly client_contact_id: string | null;
  readonly granted_by: string;
  readonly granted_at: string;
}

const COLS = "id, org_id, client_id, project_code, name, site_address, status, currency, unit_system, ops_project_ref, created_at";
const MEMBER_COLS = "org_id, project_id, user_id, role, client_contact_id, granted_by, granted_at";

export const projectsRepository = {
  /**
   * No RETURNING: the project read policy (`can_access_project(id)`) looks the project up, and a row inserted by the
   * same statement is not visible to it yet — so the row is read back by id in a second statement.
   */
  async insert(tx: Tx, r: Pick<ProjectRow, "id" | "org_id" | "client_id" | "project_code" | "name" | "site_address" | "ops_project_ref">): Promise<ProjectRow | null> {
    await tx.query("INSERT INTO design_os.project (id, org_id, client_id, project_code, name, site_address, ops_project_ref) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [r.id, r.org_id, r.client_id, r.project_code, r.name, r.site_address === null ? null : JSON.stringify(r.site_address), r.ops_project_ref]);
    return projectsRepository.get(tx, r.id);
  },
  /** Visible only through RLS (`can_access_project`): another tenant's or an unassigned project reads as absent. */
  get(tx: Tx, id: string, lock = false): Promise<ProjectRow | null> {
    return jsonRow<ProjectRow>(tx, `SELECT ${COLS} FROM design_os.project WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  },
  update(tx: Tx, id: string, r: Pick<ProjectRow, "name" | "site_address" | "ops_project_ref">): Promise<ProjectRow | null> {
    return jsonRow<ProjectRow>(tx, `UPDATE design_os.project SET name = $2, site_address = $3, ops_project_ref = $4 WHERE id = $1 RETURNING ${COLS}`,
      [id, r.name, r.site_address === null ? null : JSON.stringify(r.site_address), r.ops_project_ref]);
  },
  list(tx: Tx, page: Keyset, params: readonly unknown[]): Promise<ProjectRow[]> {
    return jsonRows<ProjectRow>(tx, `SELECT ${COLS} FROM design_os.project WHERE ${page.where} ${page.orderLimit}`, params);
  },
  members(tx: Tx, projectId: string): Promise<ProjectMemberRow[]> {
    return jsonRows<ProjectMemberRow>(tx, `SELECT ${MEMBER_COLS} FROM design_os.project_member WHERE project_id = $1 ORDER BY role::text COLLATE "C", user_id`, [projectId]);
  },
  addMember(tx: Tx, r: Omit<ProjectMemberRow, "granted_at">): Promise<ProjectMemberRow | null> {
    return jsonRow<ProjectMemberRow>(tx, `INSERT INTO design_os.project_member (org_id, project_id, user_id, role, client_contact_id, granted_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${MEMBER_COLS}`,
      [r.org_id, r.project_id, r.user_id, r.role, r.client_contact_id, r.granted_by]);
  },
  removeMember(tx: Tx, projectId: string, userId: string, role: string): Promise<ProjectMemberRow | null> {
    return jsonRow<ProjectMemberRow>(tx, `DELETE FROM design_os.project_member WHERE project_id = $1 AND user_id = $2 AND role = $3 RETURNING ${MEMBER_COLS}`, [projectId, userId, role]);
  },
};
