-- 0005 Hettich: manufacturer data (catalog domain behind the ManufacturerAdapter). The dataset VERSION is the
-- exact record a DesignVersion pins; its article and rule rows are frozen once the version leaves DRAFT.
-- Only source-verified PRODUCTION intake data is ever stored; the TEST_FIXTURE dataset stays in code.
-- No Hettich data is seeded.
SET LOCAL ROLE design_os_owner;

SELECT design_os.create_entity_table('hettich_dataset');

CREATE TABLE design_os.hettich_dataset_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  notes text NOT NULL
);
SELECT design_os.install_version_envelope('hettich_dataset', 'design_os.hettich_dataset_version', 'design_os.hettich_dataset', 'hettich.author', 'hettich.approve');

-- Mirrors HettichProductionRecord: key fields as columns, structured groups as jsonb. NULL = unverified.
CREATE TABLE design_os.hettich_article (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  record_code text NOT NULL,
  article_number text,
  product_family text,
  series text,
  category text CHECK (category IN ('HINGE', 'MOUNTING_PLATE')),
  description text,
  exact_application jsonb NOT NULL,
  dimensions jsonb,
  compatibility jsonb NOT NULL,
  drilling jsonb NOT NULL,
  installation jsonb NOT NULL,
  adjustment jsonb NOT NULL,
  accessories jsonb,
  cad_reference jsonb,
  source_ref jsonb NOT NULL,
  licence_status text NOT NULL CHECK (licence_status IN ('OFFICIAL_PUBLIC', 'AUTHORISED', 'RESTRICTED', 'UNKNOWN')),
  licence_usage_notes text,
  verified_by text,
  verified_at text,
  preference_rank integer,
  PRIMARY KEY (version_id, record_code),
  CONSTRAINT hettich_article_position_unique UNIQUE (version_id, position),
  CONSTRAINT hettich_article_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.hettich_dataset_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.hettich_article', 'design_os.hettich_dataset_version', 'version_id');

CREATE TABLE design_os.hettich_calculation_rule (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  rule_code text NOT NULL,
  family text NOT NULL,
  category text NOT NULL CHECK (category IN ('HINGE', 'MOUNTING_PLATE')),
  description text NOT NULL,
  -- Quantity bands are formula text evaluated only by the TypeScript rules engine.
  bands jsonb NOT NULL CHECK (jsonb_typeof(bands) = 'array'),
  source_ref jsonb,
  verification jsonb,
  source_version text NOT NULL,
  PRIMARY KEY (version_id, rule_code),
  CONSTRAINT hettich_rule_position_unique UNIQUE (version_id, position),
  CONSTRAINT hettich_rule_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.hettich_dataset_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.hettich_calculation_rule', 'design_os.hettich_dataset_version', 'version_id');
