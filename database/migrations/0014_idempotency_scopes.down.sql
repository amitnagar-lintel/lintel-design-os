-- 0014 down
SET LOCAL ROLE design_os_owner;
ALTER TABLE design_os.idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE design_os.idempotency_record ADD CONSTRAINT idempotency_record_scope_check CHECK (scope IN (
    'transition', 'validation_run.record',
    'snapshot.bom.generate', 'snapshot.boq.generate', 'snapshot.pricing.generate', 'snapshot.quotation.generate',
    'snapshot.drawing.generate', 'snapshot.manufacturing_document.generate',
    'quotation.issue', 'drawing.issue', 'manufacturing.release',
    'file.upload', 'client_contact.invite'));
