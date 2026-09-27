-- Rollback of 0021 quotation document.
SET LOCAL ROLE design_os_owner;
DROP POLICY file_read ON design_os.file_object;
CREATE POLICY file_read ON design_os.file_object FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND ((design_os.is_internal() AND design_os.has_permission('output.read.production')) OR design_os.client_can_read_file(id)));
DROP TABLE design_os.quotation_snapshot_file;
DROP TRIGGER check_quotation_manifest ON design_os.quotation_snapshot;
DROP FUNCTION design_os.check_quotation_manifest();
DROP FUNCTION design_os.quotation_file_manifest_hash(uuid);
DROP FUNCTION design_os.check_quotation_file();
DROP FUNCTION design_os.cost_reader_can_read_file(uuid);
ALTER TABLE design_os.quotation_snapshot DROP COLUMN file_manifest_hash;
ALTER TABLE design_os.output_file_format DISABLE TRIGGER forbid_mutation;
UPDATE design_os.output_file_format SET kinds = '{DRAWING}' WHERE code = 'PDF';
ALTER TABLE design_os.output_file_format ENABLE TRIGGER forbid_mutation;
