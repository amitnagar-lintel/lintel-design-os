-- 0021 quotation document (pilot hardening): the quotation PDF is a stored file of its quotation snapshot, exactly
-- like a drawing's files (0017): content-addressed insert-only file_object, a link in manifest order, and a file
-- manifest sealed into the snapshot row and checked by the database at commit. A snapshot and its links are
-- insert-only, so the document is immutable before and after issue.
--  * quotation_snapshot.file_manifest_hash: the sealed manifest (NULL = a quotation without a document; then no file
--    may ever be linked). The API always generates the document with the quotation.
--  * quotation_snapshot_file: PDF only, one per snapshot; readable by cost readers (output.read.cost), written by
--    commercial generators (output.generate.commercial).
--  * file_object: a file linked to a quotation is also readable by cost readers (the drawing rule is unchanged).
SET LOCAL ROLE design_os_owner;

-- The PDF format now also serves quotations (registry row; the only change to it).
ALTER TABLE design_os.output_file_format DISABLE TRIGGER forbid_mutation;
UPDATE design_os.output_file_format SET kinds = '{DRAWING,QUOTATION}' WHERE code = 'PDF';
ALTER TABLE design_os.output_file_format ENABLE TRIGGER forbid_mutation;

ALTER TABLE design_os.quotation_snapshot ADD COLUMN file_manifest_hash text CHECK (file_manifest_hash ~ '^sha256:[0-9a-f]{64}$');

CREATE TABLE design_os.quotation_snapshot_file (
  org_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 1),
  format text NOT NULL,
  sheet_index integer CHECK (sheet_index IS NULL),
  file_object_id uuid NOT NULL,
  CONSTRAINT quotation_snapshot_file_pkey PRIMARY KEY (snapshot_id, sequence),
  CONSTRAINT quotation_snapshot_file_unique UNIQUE (snapshot_id, format),
  CONSTRAINT quotation_snapshot_file_snapshot_fk FOREIGN KEY (org_id, snapshot_id) REFERENCES design_os.quotation_snapshot (org_id, id),
  CONSTRAINT quotation_snapshot_file_file_fk FOREIGN KEY (org_id, file_object_id) REFERENCES design_os.file_object (org_id, id),
  CONSTRAINT quotation_snapshot_file_format_fk FOREIGN KEY (format) REFERENCES design_os.output_file_format (code)
);
SELECT design_os.install_insert_only('design_os.quotation_snapshot_file');
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON design_os.quotation_snapshot_file FOR EACH ROW EXECUTE FUNCTION design_os.audit_row();

-- A link must use a format registered for quotations.
CREATE FUNCTION design_os.check_quotation_file() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM design_os.output_file_format f WHERE f.code = NEW.format AND 'QUOTATION' = ANY (f.kinds) AND NOT f.sheet_scoped) THEN
    RAISE EXCEPTION 'design_os.quotation_snapshot_file: format % is not valid for quotations', NEW.format USING ERRCODE = 'LD019';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER check_quotation_file BEFORE INSERT ON design_os.quotation_snapshot_file FOR EACH ROW EXECUTE FUNCTION design_os.check_quotation_file();

-- Same manifest line format as drawings: "<sequence>|<format>|<sheet or empty>|<checksum>|<byte size>|<content type>".
CREATE FUNCTION design_os.quotation_file_manifest_hash(p_snapshot uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$ SELECT design_os.sha256_text(string_agg(format('%s|%s|%s|%s|%s|%s', l.sequence, l.format, coalesce(l.sheet_index::text, ''), o.checksum, o.byte_size, o.content_type),
                                             E'\n' ORDER BY l.sequence))
        FROM design_os.quotation_snapshot_file l JOIN design_os.file_object o ON o.id = l.file_object_id AND o.org_id = l.org_id
        WHERE l.snapshot_id = p_snapshot $f$;

-- At commit: the linked files are exactly the sealed manifest (no manifest: no links), in format order.
CREATE FUNCTION design_os.check_quotation_manifest() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  snap uuid := CASE WHEN TG_TABLE_NAME = 'quotation_snapshot' THEN (to_jsonb(NEW) ->> 'id')::uuid ELSE (to_jsonb(NEW) ->> 'snapshot_id')::uuid END;
  sealed text;
BEGIN
  SELECT file_manifest_hash INTO sealed FROM design_os.quotation_snapshot WHERE id = snap;
  IF EXISTS (
      SELECT 1 FROM (SELECT l.sequence, row_number() OVER (ORDER BY f.sort_order) AS expected
                     FROM design_os.quotation_snapshot_file l JOIN design_os.output_file_format f ON f.code = l.format WHERE l.snapshot_id = snap) x
      WHERE x.sequence <> x.expected)
     OR design_os.quotation_file_manifest_hash(snap) IS DISTINCT FROM sealed THEN
    RAISE EXCEPTION 'design_os.quotation_snapshot: linked files do not match the sealed file manifest of snapshot %', snap USING ERRCODE = 'LD016';
  END IF;
  RETURN NULL;
END $f$;
CREATE CONSTRAINT TRIGGER check_quotation_manifest AFTER INSERT ON design_os.quotation_snapshot DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION design_os.check_quotation_manifest();
CREATE CONSTRAINT TRIGGER check_quotation_manifest AFTER INSERT ON design_os.quotation_snapshot_file DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION design_os.check_quotation_manifest();

-- A file is readable by a cost reader when it is linked to a quotation snapshot of their organization.
CREATE FUNCTION design_os.cost_reader_can_read_file(p_file uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$ SELECT design_os.is_internal() AND design_os.has_permission('output.read.cost')
            AND EXISTS (SELECT 1 FROM design_os.quotation_snapshot_file l WHERE l.file_object_id = p_file AND l.org_id = design_os.current_org_id()) $f$;

ALTER TABLE design_os.quotation_snapshot_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY link_read ON design_os.quotation_snapshot_file FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('output.read.cost'));
CREATE POLICY link_insert ON design_os.quotation_snapshot_file FOR INSERT TO design_os_api
  WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('output.generate.commercial'));

DROP POLICY file_read ON design_os.file_object;
CREATE POLICY file_read ON design_os.file_object FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND ((design_os.is_internal() AND design_os.has_permission('output.read.production'))
                                                  OR design_os.client_can_read_file(id) OR design_os.cost_reader_can_read_file(id)));

REVOKE ALL ON FUNCTION design_os.check_quotation_file(), design_os.quotation_file_manifest_hash(uuid), design_os.check_quotation_manifest(),
  design_os.cost_reader_can_read_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.cost_reader_can_read_file(uuid) TO design_os_api;
REVOKE ALL ON design_os.quotation_snapshot_file FROM PUBLIC;
GRANT SELECT, INSERT ON design_os.quotation_snapshot_file TO design_os_api;
