-- 0006 rooms and designs: rooms, insert-only survey revisions, designs, design versions with the
-- 12 EXACT version pins, objects, relationship overrides and engine validation runs (M5 §2.3).
SET LOCAL ROLE design_os_owner;

CREATE TABLE design_os.room (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  room_type text NOT NULL CHECK (room_type = 'KITCHEN'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_project_fk FOREIGN KEY (org_id, project_id) REFERENCES design_os.project (org_id, id),
  CONSTRAINT room_org_id_unique UNIQUE (org_id, id),
  CONSTRAINT room_org_project_id_unique UNIQUE (org_id, project_id, id)
);

-- A survey of the room. Insert-only: a new survey is a new revision. Walls are derived by the engine, not stored.
CREATE TABLE design_os.room_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  room_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  length_mm numeric(10, 2) NOT NULL CHECK (length_mm > 0),
  width_mm numeric(10, 2) NOT NULL CHECK (width_mm > 0),
  height_mm numeric(10, 2) NOT NULL CHECK (height_mm > 0),
  wall_thickness_mm numeric(10, 2) NOT NULL CHECK (wall_thickness_mm >= 0),
  source text NOT NULL CHECK (btrim(source) <> ''),
  surveyed_by uuid NOT NULL REFERENCES design_os.app_user (id),
  surveyed_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT room_revision_room_fk FOREIGN KEY (org_id, room_id) REFERENCES design_os.room (org_id, id),
  CONSTRAINT room_revision_number_unique UNIQUE (room_id, revision_number),
  CONSTRAINT room_revision_org_id_unique UNIQUE (org_id, id),
  CONSTRAINT room_revision_org_room_id_unique UNIQUE (org_id, room_id, id)
);
SELECT design_os.install_insert_only('design_os.room_revision');

-- The design entity (one design per room); its versions are design_version.
CREATE TABLE design_os.design (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  room_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_room_fk FOREIGN KEY (org_id, project_id, room_id) REFERENCES design_os.room (org_id, project_id, id),
  CONSTRAINT design_org_id_unique UNIQUE (org_id, id),
  CONSTRAINT design_org_project_id_unique UNIQUE (org_id, id, project_id)
);

-- The 12 exact dependencies (every pin is an immutable VERSION record, never a mutable container):
--   6 standards: construction, planning, edge band, manufacturing, pricing, quotation policy
--   5 catalog versions: material (incl. edge bands), finish, hardware (items + rule sets), appliance, product (→ exact recipe versions)
--   1 Hettich dataset version
-- NULL only where not yet applicable (manufacturing, pricing, quotation policy, appliance). Pins are editable
-- only while the design version is DRAFT and are never re-pointed afterwards (guard_version_row).
CREATE TABLE design_os.design_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  project_id uuid NOT NULL,
  based_on_version_id uuid,
  room_revision_id uuid NOT NULL,
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
  authored_engine_version text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT design_version_project_fk FOREIGN KEY (org_id, entity_id, project_id) REFERENCES design_os.design (org_id, id, project_id),
  CONSTRAINT design_version_room_revision_fk FOREIGN KEY (org_id, room_revision_id) REFERENCES design_os.room_revision (org_id, id),
  CONSTRAINT design_version_construction_fk FOREIGN KEY (org_id, construction_standard_version_id) REFERENCES design_os.construction_standard_version (org_id, id),
  CONSTRAINT design_version_planning_fk FOREIGN KEY (org_id, planning_standard_version_id) REFERENCES design_os.planning_standard_version (org_id, id),
  CONSTRAINT design_version_edge_band_fk FOREIGN KEY (org_id, edge_band_standard_version_id) REFERENCES design_os.edge_band_standard_version (org_id, id),
  CONSTRAINT design_version_manufacturing_fk FOREIGN KEY (org_id, manufacturing_standard_version_id) REFERENCES design_os.manufacturing_standard_version (org_id, id),
  CONSTRAINT design_version_pricing_fk FOREIGN KEY (org_id, pricing_standard_version_id) REFERENCES design_os.pricing_standard_version (org_id, id),
  CONSTRAINT design_version_quotation_policy_fk FOREIGN KEY (org_id, quotation_policy_version_id) REFERENCES design_os.quotation_policy_version (org_id, id),
  CONSTRAINT design_version_material_fk FOREIGN KEY (org_id, material_catalog_version_id) REFERENCES design_os.material_catalog_version (org_id, id),
  CONSTRAINT design_version_finish_fk FOREIGN KEY (org_id, finish_catalog_version_id) REFERENCES design_os.finish_catalog_version (org_id, id),
  CONSTRAINT design_version_hardware_fk FOREIGN KEY (org_id, hardware_catalog_version_id) REFERENCES design_os.hardware_catalog_version (org_id, id),
  CONSTRAINT design_version_appliance_fk FOREIGN KEY (org_id, appliance_catalog_version_id) REFERENCES design_os.appliance_catalog_version (org_id, id),
  CONSTRAINT design_version_product_fk FOREIGN KEY (org_id, product_catalog_version_id) REFERENCES design_os.product_catalog_version (org_id, id),
  CONSTRAINT design_version_hettich_fk FOREIGN KEY (org_id, hettich_dataset_version_id) REFERENCES design_os.hettich_dataset_version (org_id, id)
);
SELECT design_os.install_version_envelope('design', 'design_os.design_version', 'design_os.design', 'design_version.author', 'design_version.approve');
ALTER TABLE design_os.design_version
  ADD CONSTRAINT design_version_based_on_fk FOREIGN KEY (org_id, entity_id, based_on_version_id) REFERENCES design_os.design_version (org_id, entity_id, id),
  ADD CONSTRAINT design_version_based_on_not_self CHECK (based_on_version_id IS NULL OR based_on_version_id <> id);

-- The pinned room revision must be a survey of the design's own room.
CREATE FUNCTION design_os.guard_design_version_room() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM design_os.design d JOIN design_os.room_revision rr ON rr.room_id = d.room_id AND rr.org_id = d.org_id
    WHERE d.id = NEW.entity_id AND d.org_id = NEW.org_id AND rr.id = NEW.room_revision_id
  ) THEN
    RAISE EXCEPTION 'design_os.design_version: room_revision_id must be a revision of the design''s room' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_design_version_room BEFORE INSERT OR UPDATE ON design_os.design_version FOR EACH ROW EXECUTE FUNCTION design_os.guard_design_version_room();

-- Objects: lineage_id is the engine objectId (stable across versions); the row id is new per copy.
CREATE TABLE design_os.design_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  design_version_id uuid NOT NULL,
  object_code text NOT NULL,
  lineage_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type = 'BASE_CABINET'),
  product_code text NOT NULL,
  product_version_id uuid NOT NULL,
  x_mm numeric(10, 2) NOT NULL,
  y_mm numeric(10, 2) NOT NULL,
  z_mm numeric(10, 2) NOT NULL,
  -- Quarter turns only (M4); no X/Z rotation columns exist.
  rotation_y integer NOT NULL CHECK (rotation_y IN (0, 90, 180, 270)),
  width_mm numeric(10, 2) NOT NULL CHECK (width_mm > 0),
  height_mm numeric(10, 2) NOT NULL CHECK (height_mm > 0),
  depth_mm numeric(10, 2) NOT NULL CHECK (depth_mm > 0),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'APPROVED')),
  CONSTRAINT design_object_version_fk FOREIGN KEY (org_id, design_version_id) REFERENCES design_os.design_version (org_id, id),
  CONSTRAINT design_object_product_fk FOREIGN KEY (org_id, product_version_id) REFERENCES design_os.product_version (org_id, id),
  CONSTRAINT design_object_code_unique UNIQUE (design_version_id, object_code),
  CONSTRAINT design_object_lineage_unique UNIQUE (design_version_id, lineage_id)
);
SELECT design_os.install_draft_guard('design_os.design_object', 'design_os.design_version', 'design_version_id');

-- An object's exact product version must be a member of the product catalog version its design version pins.
CREATE FUNCTION design_os.guard_design_object_product() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM design_os.design_version dv
      JOIN design_os.product_catalog_version_product m ON m.catalog_version_id = dv.product_catalog_version_id AND m.org_id = dv.org_id
      JOIN design_os.product p ON p.id = m.product_id
    WHERE dv.id = NEW.design_version_id AND dv.org_id = NEW.org_id AND m.product_version_id = NEW.product_version_id AND p.code = NEW.product_code
  ) THEN
    RAISE EXCEPTION 'design_os.design_object: product version % (%) is not in the pinned product catalog version', NEW.product_version_id, NEW.product_code
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_design_object_product BEFORE INSERT OR UPDATE ON design_os.design_object FOR EACH ROW EXECUTE FUNCTION design_os.guard_design_object_product();

-- Explicit, versioned, audited overrides (M4). Only INTENTIONAL_GAP has an effect in the engine.
CREATE TABLE design_os.relationship_override (
  org_id uuid NOT NULL,
  design_version_id uuid NOT NULL,
  override_code text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  kind text NOT NULL CHECK (kind IN ('INTENTIONAL_GAP', 'FILLER', 'END_PANEL', 'SHARED_SIDE', 'SPECIAL_CORNER')),
  object_ids text[] NOT NULL CHECK (cardinality(object_ids) >= 1),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_by uuid NOT NULL REFERENCES design_os.app_user (id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (design_version_id, override_code, version),
  CONSTRAINT relationship_override_version_fk FOREIGN KEY (org_id, design_version_id) REFERENCES design_os.design_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.relationship_override', 'design_os.design_version', 'design_version_id');

-- Engine validation runs (the approval proof): insert-only, valid only for the input_hash they were made for.
CREATE TABLE design_os.validation_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  design_version_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  engine_version text NOT NULL,
  blocker_count integer NOT NULL CHECK (blocker_count >= 0),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array'),
  result_hash text NOT NULL CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  ran_by uuid NOT NULL REFERENCES design_os.app_user (id),
  ran_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_run_version_fk FOREIGN KEY (org_id, design_version_id) REFERENCES design_os.design_version (org_id, id)
);
CREATE INDEX validation_run_lookup ON design_os.validation_run (design_version_id, input_hash, ran_at DESC);
SELECT design_os.install_insert_only('design_os.validation_run');
