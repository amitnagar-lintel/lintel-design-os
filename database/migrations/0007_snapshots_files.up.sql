-- 0007 snapshots and files: six insert-only snapshot tables with identical provenance columns, stored files
-- (keys + checksums only, never URLs), issue records and file links (M5 §6, §12; requirement B, E, G).
-- A snapshot records EXACT pinned versions copied from its design version at generation time; it is never
-- reproduced by looking up "latest" data.
SET LOCAL ROLE design_os_owner;

-- Stored file metadata (FileStorageProvider): provider-neutral key + SHA-256 checksum. Insert-only.
CREATE TABLE design_os.file_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  provider_id text NOT NULL,
  storage_key text NOT NULL CHECK (storage_key !~ '(^/|\.\.|\\)'),
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum text NOT NULL CHECK (checksum ~ '^sha256:[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES design_os.app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT file_object_key_unique UNIQUE (org_id, provider_id, storage_key),
  CONSTRAINT file_object_org_id_unique UNIQUE (org_id, id)
);
SELECT design_os.install_insert_only('design_os.file_object');

CREATE FUNCTION design_os.create_snapshot_table(p_name text, p_kind design_os.snapshot_kind) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format($f$
    CREATE TABLE design_os.%1$I (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES design_os.organization (id),
      kind design_os.snapshot_kind NOT NULL CHECK (kind = %2$L),
      design_version_id uuid NOT NULL,
      -- Lifecycle/approval provenance of the generating design version (exact, at generation time).
      design_version_status design_os.record_lifecycle_status NOT NULL,
      design_version_content_hash text NOT NULL CHECK (design_version_content_hash ~ '^sha256:[0-9a-f]{64}$'),
      construction_standard_version_id uuid NOT NULL,
      planning_standard_version_id uuid NOT NULL,
      edge_band_standard_version_id uuid NOT NULL,
      manufacturing_standard_version_id uuid,
      pricing_standard_version_id uuid,
      quotation_policy_version_id uuid,
      material_catalog_version_id uuid NOT NULL,
      finish_catalog_version_id uuid NOT NULL,
      hardware_catalog_version_id uuid NOT NULL,
      appliance_catalog_version_id uuid,
      product_catalog_version_id uuid NOT NULL,
      hettich_dataset_version_id uuid NOT NULL,
      engine_version text NOT NULL CHECK (btrim(engine_version) <> ''),
      input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
      content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
      engine_hash text,
      blocker_count integer NOT NULL CHECK (blocker_count >= 0),
      payload jsonb NOT NULL,
      data_classification text NOT NULL DEFAULT 'PRODUCTION' CHECK (data_classification = 'PRODUCTION'),
      purpose text NOT NULL DEFAULT 'PRELIMINARY' CHECK (purpose IN ('PRELIMINARY', 'FOR_PRODUCTION')),
      created_by uuid NOT NULL REFERENCES design_os.app_user (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      -- TEST_FIXTURE data can never be stored (requirement E): no value anywhere in the payload may be TEST_FIXTURE.
      CONSTRAINT %1$s_no_test_fixture CHECK (NOT jsonb_path_exists(payload, 'lax $.** ? (@ == "TEST_FIXTURE")')),
      CONSTRAINT %1$s_org_id_unique UNIQUE (org_id, id),
      CONSTRAINT %1$s_design_version_fk FOREIGN KEY (org_id, design_version_id) REFERENCES design_os.design_version (org_id, id),
      CONSTRAINT %1$s_construction_fk FOREIGN KEY (org_id, construction_standard_version_id) REFERENCES design_os.construction_standard_version (org_id, id),
      CONSTRAINT %1$s_planning_fk FOREIGN KEY (org_id, planning_standard_version_id) REFERENCES design_os.planning_standard_version (org_id, id),
      CONSTRAINT %1$s_edge_band_fk FOREIGN KEY (org_id, edge_band_standard_version_id) REFERENCES design_os.edge_band_standard_version (org_id, id),
      CONSTRAINT %1$s_manufacturing_fk FOREIGN KEY (org_id, manufacturing_standard_version_id) REFERENCES design_os.manufacturing_standard_version (org_id, id),
      CONSTRAINT %1$s_pricing_fk FOREIGN KEY (org_id, pricing_standard_version_id) REFERENCES design_os.pricing_standard_version (org_id, id),
      CONSTRAINT %1$s_quotation_policy_fk FOREIGN KEY (org_id, quotation_policy_version_id) REFERENCES design_os.quotation_policy_version (org_id, id),
      CONSTRAINT %1$s_material_fk FOREIGN KEY (org_id, material_catalog_version_id) REFERENCES design_os.material_catalog_version (org_id, id),
      CONSTRAINT %1$s_finish_fk FOREIGN KEY (org_id, finish_catalog_version_id) REFERENCES design_os.finish_catalog_version (org_id, id),
      CONSTRAINT %1$s_hardware_fk FOREIGN KEY (org_id, hardware_catalog_version_id) REFERENCES design_os.hardware_catalog_version (org_id, id),
      CONSTRAINT %1$s_appliance_fk FOREIGN KEY (org_id, appliance_catalog_version_id) REFERENCES design_os.appliance_catalog_version (org_id, id),
      CONSTRAINT %1$s_product_fk FOREIGN KEY (org_id, product_catalog_version_id) REFERENCES design_os.product_catalog_version (org_id, id),
      CONSTRAINT %1$s_hettich_fk FOREIGN KEY (org_id, hettich_dataset_version_id) REFERENCES design_os.hettich_dataset_version (org_id, id)
    )$f$, p_name, p_kind);
  EXECUTE format('CREATE TRIGGER check_snapshot_provenance BEFORE INSERT ON design_os.%I FOR EACH ROW EXECUTE FUNCTION design_os.check_snapshot_provenance()', p_name);
  PERFORM design_os.install_insert_only(('design_os.' || p_name)::regclass);
END $$;

-- Provenance must equal the generating design version exactly: its lifecycle, content hash, input hash and
-- every pin. Pricing / quotation policy / manufacturing references are required where they apply and NULL
-- elsewhere. FOR_PRODUCTION outputs need an APPROVED or LOCKED design version and zero BLOCKERs.
CREATE FUNCTION design_os.check_snapshot_provenance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  dv design_os.design_version%ROWTYPE;
  problems text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO dv FROM design_os.design_version WHERE id = NEW.design_version_id AND org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_os.%: design version % not found in this organization', TG_TABLE_NAME, NEW.design_version_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.design_version_status <> dv.status THEN problems := problems || format('design_version_status %s ≠ %s', NEW.design_version_status, dv.status); END IF;
  IF NEW.design_version_content_hash <> dv.content_hash THEN problems := problems || 'design_version_content_hash differs from the design version'::text; END IF;
  IF NEW.input_hash <> dv.input_hash THEN problems := problems || 'input_hash differs from the design version'::text; END IF;
  IF NEW.construction_standard_version_id <> dv.construction_standard_version_id THEN problems := problems || 'construction_standard_version_id ≠ pin'::text; END IF;
  IF NEW.planning_standard_version_id <> dv.planning_standard_version_id THEN problems := problems || 'planning_standard_version_id ≠ pin'::text; END IF;
  IF NEW.edge_band_standard_version_id <> dv.edge_band_standard_version_id THEN problems := problems || 'edge_band_standard_version_id ≠ pin'::text; END IF;
  IF NEW.material_catalog_version_id <> dv.material_catalog_version_id THEN problems := problems || 'material_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.finish_catalog_version_id <> dv.finish_catalog_version_id THEN problems := problems || 'finish_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.hardware_catalog_version_id <> dv.hardware_catalog_version_id THEN problems := problems || 'hardware_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.product_catalog_version_id <> dv.product_catalog_version_id THEN problems := problems || 'product_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.hettich_dataset_version_id <> dv.hettich_dataset_version_id THEN problems := problems || 'hettich_dataset_version_id ≠ pin'::text; END IF;
  IF NEW.appliance_catalog_version_id IS DISTINCT FROM dv.appliance_catalog_version_id THEN problems := problems || 'appliance_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.kind IN ('PRICING', 'QUOTATION') THEN
    IF NEW.pricing_standard_version_id IS NULL OR NEW.pricing_standard_version_id IS DISTINCT FROM dv.pricing_standard_version_id THEN problems := problems || 'pricing_standard_version_id must equal the (non-null) pin'::text; END IF;
  ELSIF NEW.pricing_standard_version_id IS NOT NULL THEN problems := problems || 'pricing_standard_version_id does not apply to this output'::text;
  END IF;
  IF NEW.kind = 'QUOTATION' THEN
    IF NEW.quotation_policy_version_id IS NULL OR NEW.quotation_policy_version_id IS DISTINCT FROM dv.quotation_policy_version_id THEN problems := problems || 'quotation_policy_version_id must equal the (non-null) pin'::text; END IF;
  ELSIF NEW.quotation_policy_version_id IS NOT NULL THEN problems := problems || 'quotation_policy_version_id does not apply to this output'::text;
  END IF;
  IF NEW.kind = 'MANUFACTURING_DOCUMENT' THEN
    IF NEW.manufacturing_standard_version_id IS NULL OR NEW.manufacturing_standard_version_id IS DISTINCT FROM dv.manufacturing_standard_version_id THEN problems := problems || 'manufacturing_standard_version_id must equal the (non-null) pin'::text; END IF;
  ELSIF NEW.manufacturing_standard_version_id IS NOT NULL THEN problems := problems || 'manufacturing_standard_version_id does not apply to this output'::text;
  END IF;
  IF NEW.purpose = 'FOR_PRODUCTION' AND (dv.status NOT IN ('APPROVED', 'LOCKED') OR NEW.blocker_count > 0) THEN
    problems := problems || format('FOR_PRODUCTION requires an APPROVED or LOCKED design version and 0 BLOCKERs (design version is %s, %s BLOCKER(s))', dv.status, NEW.blocker_count);
  END IF;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'design_os.%: snapshot provenance rejected: %', TG_TABLE_NAME, array_to_string(problems, '; ') USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

SELECT design_os.create_snapshot_table(t, k::design_os.snapshot_kind) FROM (VALUES
  ('bom_snapshot', 'BOM'), ('boq_snapshot', 'BOQ'), ('pricing_snapshot', 'PRICING'),
  ('quotation_snapshot', 'QUOTATION'), ('drawing_snapshot', 'DRAWING'), ('manufacturing_document_snapshot', 'MANUFACTURING_DOCUMENT')
) AS s(t, k);

ALTER TABLE design_os.quotation_snapshot ADD COLUMN revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number >= 1);
ALTER TABLE design_os.drawing_snapshot ADD COLUMN drawing_type text NOT NULL DEFAULT 'FRONT_ELEVATION';

-- Issuing is a separate insert-only record (snapshots never change). Issuing requires a LOCKED design version,
-- zero BLOCKERs and a snapshot generated from the locked content.
CREATE FUNCTION design_os.check_issue() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  s record;
  dv design_os.design_version%ROWTYPE;
BEGIN
  EXECUTE format('SELECT design_version_id, design_version_content_hash, blocker_count FROM design_os.%I WHERE id = $1 AND org_id = $2', TG_ARGV[0])
    INTO s USING NEW.snapshot_id, NEW.org_id;
  SELECT * INTO dv FROM design_os.design_version WHERE id = s.design_version_id AND org_id = NEW.org_id;
  IF dv.status IS DISTINCT FROM 'LOCKED' OR s.blocker_count > 0 OR s.design_version_content_hash <> dv.content_hash THEN
    RAISE EXCEPTION 'design_os.%: issuing requires a LOCKED design version, 0 BLOCKERs and a snapshot of the locked content', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE design_os.quotation_issue (
  org_id uuid NOT NULL,
  snapshot_id uuid PRIMARY KEY,
  issued_by uuid NOT NULL REFERENCES design_os.app_user (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  CONSTRAINT quotation_issue_snapshot_fk FOREIGN KEY (org_id, snapshot_id) REFERENCES design_os.quotation_snapshot (org_id, id)
);
CREATE TRIGGER check_issue BEFORE INSERT ON design_os.quotation_issue FOR EACH ROW EXECUTE FUNCTION design_os.check_issue('quotation_snapshot');
SELECT design_os.install_insert_only('design_os.quotation_issue');

CREATE TABLE design_os.drawing_issue (
  org_id uuid NOT NULL,
  snapshot_id uuid PRIMARY KEY,
  issued_by uuid NOT NULL REFERENCES design_os.app_user (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  CONSTRAINT drawing_issue_snapshot_fk FOREIGN KEY (org_id, snapshot_id) REFERENCES design_os.drawing_snapshot (org_id, id)
);
CREATE TRIGGER check_issue BEFORE INSERT ON design_os.drawing_issue FOR EACH ROW EXECUTE FUNCTION design_os.check_issue('drawing_snapshot');
SELECT design_os.install_insert_only('design_os.drawing_issue');

CREATE TABLE design_os.drawing_snapshot_file (
  org_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  format text NOT NULL CHECK (format IN ('SVG', 'PDF')),
  PRIMARY KEY (snapshot_id, format),
  CONSTRAINT drawing_snapshot_file_snapshot_fk FOREIGN KEY (org_id, snapshot_id) REFERENCES design_os.drawing_snapshot (org_id, id),
  CONSTRAINT drawing_snapshot_file_file_fk FOREIGN KEY (org_id, file_object_id) REFERENCES design_os.file_object (org_id, id)
);
SELECT design_os.install_insert_only('design_os.drawing_snapshot_file');

CREATE TABLE design_os.manufacturing_document_snapshot_file (
  org_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  format text NOT NULL,
  PRIMARY KEY (snapshot_id, format),
  CONSTRAINT manufacturing_document_file_snapshot_fk FOREIGN KEY (org_id, snapshot_id) REFERENCES design_os.manufacturing_document_snapshot (org_id, id),
  CONSTRAINT manufacturing_document_file_file_fk FOREIGN KEY (org_id, file_object_id) REFERENCES design_os.file_object (org_id, id)
);
SELECT design_os.install_insert_only('design_os.manufacturing_document_snapshot_file');
