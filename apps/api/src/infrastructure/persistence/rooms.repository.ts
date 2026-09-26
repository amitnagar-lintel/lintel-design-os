import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

export interface RoomRow {
  readonly id: string;
  readonly org_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly room_type: "KITCHEN";
  readonly created_at: string;
}

/** An immutable survey. Only surveyed dimensions are stored — never engine-derived geometry. */
export interface RoomRevisionRow {
  readonly id: string;
  readonly org_id: string;
  readonly room_id: string;
  readonly revision_number: number;
  readonly length_mm: number;
  readonly width_mm: number;
  readonly height_mm: number;
  readonly wall_thickness_mm: number;
  readonly source: string;
  readonly surveyed_by: string;
  readonly surveyed_at: string;
  readonly content_hash: string;
}

const COLS = "id, org_id, project_id, name, room_type, created_at";
const REV_COLS = "id, org_id, room_id, revision_number, length_mm, width_mm, height_mm, wall_thickness_mm, source, surveyed_by, surveyed_at, content_hash";

export const roomsRepository = {
  insert(tx: Tx, r: Pick<RoomRow, "org_id" | "project_id" | "name" | "room_type">): Promise<RoomRow | null> {
    return jsonRow<RoomRow>(tx, `INSERT INTO design_os.room (org_id, project_id, name, room_type) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`, [r.org_id, r.project_id, r.name, r.room_type]);
  },
  get(tx: Tx, id: string, lock = false): Promise<RoomRow | null> {
    return jsonRow<RoomRow>(tx, `SELECT ${COLS} FROM design_os.room WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  },
  rename(tx: Tx, id: string, name: string): Promise<RoomRow | null> {
    return jsonRow<RoomRow>(tx, `UPDATE design_os.room SET name = $2 WHERE id = $1 RETURNING ${COLS}`, [id, name]);
  },
  list(tx: Tx, projectId: string, page: Keyset, params: readonly unknown[]): Promise<RoomRow[]> {
    return jsonRows<RoomRow>(tx, `SELECT ${COLS} FROM design_os.room WHERE project_id = $1 AND ${page.where} ${page.orderLimit}`, [projectId, ...params]);
  },
  nextRevisionNumber(tx: Tx, roomId: string): Promise<number> {
    return tx.one<{ n: number }>("SELECT (coalesce(max(revision_number), 0) + 1)::int AS n FROM design_os.room_revision WHERE room_id = $1", [roomId]).then((r) => r.n);
  },
  insertRevision(tx: Tx, r: Omit<RoomRevisionRow, "surveyed_at"> & { readonly surveyed_at: string | null }): Promise<RoomRevisionRow | null> {
    return jsonRow<RoomRevisionRow>(tx, `
      INSERT INTO design_os.room_revision (id, org_id, room_id, revision_number, length_mm, width_mm, height_mm, wall_thickness_mm, source, surveyed_by, surveyed_at, content_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()), $12) RETURNING ${REV_COLS}`,
      [r.id, r.org_id, r.room_id, r.revision_number, r.length_mm, r.width_mm, r.height_mm, r.wall_thickness_mm, r.source, r.surveyed_by, r.surveyed_at, r.content_hash]);
  },
  revision(tx: Tx, id: string): Promise<RoomRevisionRow | null> {
    return jsonRow<RoomRevisionRow>(tx, `SELECT ${REV_COLS} FROM design_os.room_revision WHERE id = $1`, [id]);
  },
  latestRevision(tx: Tx, roomId: string): Promise<RoomRevisionRow | null> {
    return jsonRow<RoomRevisionRow>(tx, `SELECT ${REV_COLS} FROM design_os.room_revision WHERE room_id = $1 ORDER BY revision_number DESC LIMIT 1`, [roomId]);
  },
  revisions(tx: Tx, roomId: string, page: Keyset, params: readonly unknown[]): Promise<RoomRevisionRow[]> {
    return jsonRows<RoomRevisionRow>(tx, `SELECT ${REV_COLS} FROM design_os.room_revision WHERE room_id = $1 AND ${page.where} ${page.orderLimit}`, [roomId, ...params]);
  },
};
