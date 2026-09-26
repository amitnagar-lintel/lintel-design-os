-- 0007 down
SET LOCAL ROLE design_os_owner;
DROP TABLE design_os.manufacturing_document_snapshot_file;
DROP TABLE design_os.drawing_snapshot_file;
DROP TABLE design_os.drawing_issue;
DROP TABLE design_os.quotation_issue;
DROP FUNCTION design_os.check_issue();
DROP TABLE design_os.manufacturing_document_snapshot, design_os.drawing_snapshot, design_os.quotation_snapshot, design_os.pricing_snapshot, design_os.boq_snapshot, design_os.bom_snapshot;
DROP FUNCTION design_os.check_snapshot_provenance();
DROP FUNCTION design_os.create_snapshot_table(text, design_os.snapshot_kind);
DROP TABLE design_os.file_object;
