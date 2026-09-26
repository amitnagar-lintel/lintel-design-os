import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

export interface DesignRow {
  readonly id: string;
  readonly org_id: string;
  readonly project_id: string;
  readonly room_id: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly created_at: string;
}

const COLS = "id, org_id, project_id, room_id, name, status, created_at";

export const designsRepository = {
  insert(tx: Tx, r: Pick<DesignRow, "org_id" | "project_id" | "room_id" | "name">): Promise<DesignRow | null> {
    return jsonRow<DesignRow>(tx, `INSERT INTO design_os.design (org_id, project_id, room_id, name) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`, [r.org_id, r.project_id, r.room_id, r.name]);
  },
  get(tx: Tx, id: string, lock = false): Promise<DesignRow | null> {
    return jsonRow<DesignRow>(tx, `SELECT ${COLS} FROM design_os.design WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  },
  update(tx: Tx, id: string, r: Pick<DesignRow, "name" | "status">): Promise<DesignRow | null> {
    return jsonRow<DesignRow>(tx, `UPDATE design_os.design SET name = $2, status = $3 WHERE id = $1 RETURNING ${COLS}`, [id, r.name, r.status]);
  },
  list(tx: Tx, filter: { readonly column: "project_id" | "room_id"; readonly value: string }, page: Keyset, params: readonly unknown[]): Promise<DesignRow[]> {
    return jsonRows<DesignRow>(tx, `SELECT ${COLS} FROM design_os.design WHERE ${filter.column} = $1 AND ${page.where} ${page.orderLimit}`, [filter.value, ...params]);
  },
};
