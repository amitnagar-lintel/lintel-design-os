import type { Tx } from "../../common/db/tx.js";
import { jsonRow, jsonRows } from "./json.js";

export interface FileObjectRow extends Record<string, unknown> {
  readonly id: string;
  readonly org_id: string;
  readonly provider_id: string;
  readonly storage_key: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly checksum: string;
  readonly created_by: string;
  readonly created_at: string;
}

export interface DrawingFileLinkRow extends Record<string, unknown> {
  readonly snapshot_id: string;
  readonly sequence: number;
  readonly format: string;
  readonly sheet_index: number | null;
  readonly file_object_id: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly checksum: string;
}

export interface OutputFileFormatRow extends Record<string, unknown> {
  readonly code: string;
  readonly content_type: string;
  readonly extension: string;
  readonly sort_order: number;
  readonly sheet_scoped: boolean;
  readonly kinds: string[];
}

/** The snapshot ↔ file link tables (0017 drawings, 0021 quotation documents). */
export type LinkTable = "drawing_snapshot_file" | "quotation_snapshot_file";

/** Stored files (insert-only file_object) and the drawing ↔ file links: SQL only (RLS decides visibility). */
export const filesRepository = {
  /** The output file format registry (0017): content type, extension, order and sheet scope per format. */
  formats(tx: Tx): Promise<OutputFileFormatRow[]> {
    return jsonRows<OutputFileFormatRow>(tx, "SELECT * FROM design_os.output_file_format ORDER BY sort_order");
  },

  get(tx: Tx, id: string): Promise<FileObjectRow | null> {
    return jsonRow<FileObjectRow>(tx, "SELECT * FROM design_os.file_object WHERE id = $1", [id]);
  },

  byKey(tx: Tx, providerId: string, storageKey: string): Promise<FileObjectRow | null> {
    return jsonRow<FileObjectRow>(tx, "SELECT * FROM design_os.file_object WHERE provider_id = $1 AND storage_key = $2", [providerId, storageKey]);
  },

  insert(tx: Tx, row: Omit<FileObjectRow, "id" | "created_at">): Promise<FileObjectRow> {
    return jsonRow<FileObjectRow>(tx, `INSERT INTO design_os.file_object (org_id, provider_id, storage_key, content_type, byte_size, checksum, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [row.org_id, row.provider_id, row.storage_key, row.content_type, row.byte_size, row.checksum, row.created_by])
      .then((r) => {
        if (r === null) throw new Error("file_object insert returned no row");
        return r;
      });
  },

  /** Link a stored file to a drawing (default) or quotation snapshot, in manifest order. */
  async link(tx: Tx, row: { readonly org_id: string; readonly snapshot_id: string; readonly sequence: number; readonly format: string; readonly sheet_index: number | null; readonly file_object_id: string },
    table: LinkTable = "drawing_snapshot_file"): Promise<void> {
    await tx.query(`INSERT INTO design_os.${table} (org_id, snapshot_id, sequence, format, sheet_index, file_object_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.org_id, row.snapshot_id, row.sequence, row.format, row.sheet_index, row.file_object_id]);
  },

  /** A drawing (default) or quotation snapshot's files in manifest order (sequence). */
  links(tx: Tx, snapshotId: string, table: LinkTable = "drawing_snapshot_file"): Promise<DrawingFileLinkRow[]> {
    return jsonRows<DrawingFileLinkRow>(tx, `SELECT l.snapshot_id, l.sequence, l.format, l.sheet_index, l.file_object_id, o.content_type, o.byte_size, o.checksum
      FROM design_os.${table} l JOIN design_os.file_object o ON o.id = l.file_object_id AND o.org_id = l.org_id
      WHERE l.snapshot_id = $1 ORDER BY l.sequence`, [snapshotId]);
  },

};
