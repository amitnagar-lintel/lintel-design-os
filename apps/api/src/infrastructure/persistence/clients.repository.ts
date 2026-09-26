import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

export interface ClientRow {
  readonly id: string;
  readonly org_id: string;
  readonly client_code: string;
  readonly name: string;
  readonly contact: Readonly<Record<string, unknown>> | null;
  readonly ops_client_ref: string | null;
  readonly ops_lead_ref: string | null;
  readonly created_at: string;
}

const COLS = "id, org_id, client_code, name, contact, ops_client_ref, ops_lead_ref, created_at";

export const clientsRepository = {
  insert(tx: Tx, r: Omit<ClientRow, "id" | "created_at">): Promise<ClientRow | null> {
    return jsonRow<ClientRow>(tx, `INSERT INTO design_os.client (org_id, client_code, name, contact, ops_client_ref, ops_lead_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
      [r.org_id, r.client_code, r.name, r.contact === null ? null : JSON.stringify(r.contact), r.ops_client_ref, r.ops_lead_ref]);
  },
  get(tx: Tx, id: string, lock = false): Promise<ClientRow | null> {
    return jsonRow<ClientRow>(tx, `SELECT ${COLS} FROM design_os.client WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  },
  update(tx: Tx, id: string, r: Pick<ClientRow, "name" | "contact" | "ops_client_ref" | "ops_lead_ref">): Promise<ClientRow | null> {
    return jsonRow<ClientRow>(tx, `UPDATE design_os.client SET name = $2, contact = $3, ops_client_ref = $4, ops_lead_ref = $5 WHERE id = $1 RETURNING ${COLS}`,
      [id, r.name, r.contact === null ? null : JSON.stringify(r.contact), r.ops_client_ref, r.ops_lead_ref]);
  },
  list(tx: Tx, page: Keyset, params: readonly unknown[]): Promise<ClientRow[]> {
    return jsonRows<ClientRow>(tx, `SELECT ${COLS} FROM design_os.client WHERE ${page.where} ${page.orderLimit}`, params);
  },
};
