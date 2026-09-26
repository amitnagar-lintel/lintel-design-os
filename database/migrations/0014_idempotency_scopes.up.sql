-- 0014 idempotency scopes (M5 Step 5): the core design API's creates that have no natural unique key and would
-- otherwise duplicate on a client retry — rooms, room survey revisions, designs, design versions and relationship
-- overrides (each POST appends a new override version) — take an Idempotency-Key. Creates with a natural unique key
-- (clients, projects, design objects, project members) stay idempotent by that key. The list stays explicit.
SET LOCAL ROLE design_os_owner;
ALTER TABLE design_os.idempotency_record DROP CONSTRAINT idempotency_record_scope_check;
ALTER TABLE design_os.idempotency_record ADD CONSTRAINT idempotency_record_scope_check CHECK (scope IN (
    'transition', 'validation_run.record',
    'snapshot.bom.generate', 'snapshot.boq.generate', 'snapshot.pricing.generate', 'snapshot.quotation.generate',
    'snapshot.drawing.generate', 'snapshot.manufacturing_document.generate',
    'quotation.issue', 'drawing.issue', 'manufacturing.release',
    'file.upload', 'client_contact.invite',
    'room.create', 'room_revision.create', 'design.create', 'design_version.create', 'relationship_override.create'));
