-- 0003 standards: six separate engineering/business standards, each with its own entity, version
-- and content tables (M5 §2.4). There is no generic "standard" table. No production values are seeded:
-- only the variable registries (codes are schema; values stay NULL / UNVERIFIED until approved).
SET LOCAL ROLE design_os_owner;

-- ---------------------------------------------------------------- variable registries (schema, not values)

CREATE TABLE design_os.construction_variable (
  code text PRIMARY KEY,
  unit text NOT NULL,
  description text NOT NULL
);
CREATE TABLE design_os.planning_variable (
  code text PRIMARY KEY,
  unit text NOT NULL,
  description text NOT NULL
);
-- Intentionally EMPTY: no approved ManufacturingStandard variable codes exist yet (none are invented).
CREATE TABLE design_os.manufacturing_variable (
  code text PRIMARY KEY,
  unit text NOT NULL,
  description text NOT NULL
);

INSERT INTO design_os.construction_variable (code, unit, description) VALUES
  ('BACK_GROOVE_DEPTH', 'MM', 'Depth of the back-panel groove in sides and bottom'),
  ('BACK_REAR_OFFSET', 'MM', 'Distance from carcass rear edge to the back panel''s rear face'),
  ('TOP_RAIL_WIDTH', 'MM', 'Depth (front-to-back) of each top support rail'),
  ('SHELF_FRONT_SETBACK', 'MM', 'Shelf front edge setback from carcass front'),
  ('SHELF_SIDE_CLEARANCE', 'MM', 'Total width clearance of a loose shelf between sides'),
  ('OVERLAY_EDGE_GAP', 'MM', 'Overlay front reveal at each outer side edge'),
  ('OVERLAY_TOP_GAP', 'MM', 'Overlay front reveal at the top'),
  ('OVERLAY_BOTTOM_GAP', 'MM', 'Overlay front reveal at the bottom'),
  ('FRONT_BETWEEN_GAP', 'MM', 'Gap between adjacent shutters'),
  ('INSET_GAP', 'MM', 'Inset front clearance to the opening on each side'),
  ('FRONT_FINISHED_FACES', 'COUNT', 'Number of shutter faces receiving the front finish'),
  ('SHUTTER_BACK_GAP', 'MM', 'Gap between the back face of an overlay shutter and the carcass front face');

INSERT INTO design_os.planning_variable (code, unit, description) VALUES
  ('MIN_WALL_CLEARANCE', 'MM', 'Minimum distance between the end of a run and the perpendicular wall it runs towards'),
  ('MIN_CABINET_GAP', 'MM', 'Smallest non-zero gap permitted between two adjacent objects in a run (0 = touching is always allowed)'),
  ('MAX_GAP_WITHOUT_FILLER', 'MM', 'Largest gap between two adjacent objects that is permitted without a filler'),
  ('FILLER_THRESHOLD', 'MM', 'Smallest gap that a filler can close (narrowest manufacturable filler); gaps that need a filler but are narrower are unfillable'),
  ('MAX_RUN_LENGTH', 'MM', 'Maximum length of one same-wall run of objects'),
  ('SERVICE_VOID_REAR', 'MM', 'Required service clearance: minimum distance between an object''s back and the wall it faces');

-- ---------------------------------------------------------------- entity tables (stable identity per standard)

CREATE TABLE design_os.construction_standard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT construction_standard_code_unique UNIQUE (org_id, code),
  CONSTRAINT construction_standard_org_id_unique UNIQUE (org_id, id)
);
CREATE TABLE design_os.planning_standard (LIKE design_os.construction_standard INCLUDING DEFAULTS);
ALTER TABLE design_os.planning_standard ADD PRIMARY KEY (id), ADD FOREIGN KEY (org_id) REFERENCES design_os.organization (id),
  ADD CONSTRAINT planning_standard_code_unique UNIQUE (org_id, code), ADD CONSTRAINT planning_standard_org_id_unique UNIQUE (org_id, id);
CREATE TABLE design_os.edge_band_standard (LIKE design_os.construction_standard INCLUDING DEFAULTS);
ALTER TABLE design_os.edge_band_standard ADD PRIMARY KEY (id), ADD FOREIGN KEY (org_id) REFERENCES design_os.organization (id),
  ADD CONSTRAINT edge_band_standard_code_unique UNIQUE (org_id, code), ADD CONSTRAINT edge_band_standard_org_id_unique UNIQUE (org_id, id);
CREATE TABLE design_os.manufacturing_standard (LIKE design_os.construction_standard INCLUDING DEFAULTS);
ALTER TABLE design_os.manufacturing_standard ADD PRIMARY KEY (id), ADD FOREIGN KEY (org_id) REFERENCES design_os.organization (id),
  ADD CONSTRAINT manufacturing_standard_code_unique UNIQUE (org_id, code), ADD CONSTRAINT manufacturing_standard_org_id_unique UNIQUE (org_id, id);
CREATE TABLE design_os.pricing_standard (LIKE design_os.construction_standard INCLUDING DEFAULTS);
ALTER TABLE design_os.pricing_standard ADD PRIMARY KEY (id), ADD FOREIGN KEY (org_id) REFERENCES design_os.organization (id),
  ADD CONSTRAINT pricing_standard_code_unique UNIQUE (org_id, code), ADD CONSTRAINT pricing_standard_org_id_unique UNIQUE (org_id, id);
CREATE TABLE design_os.quotation_policy (LIKE design_os.construction_standard INCLUDING DEFAULTS);
ALTER TABLE design_os.quotation_policy ADD PRIMARY KEY (id), ADD FOREIGN KEY (org_id) REFERENCES design_os.organization (id),
  ADD CONSTRAINT quotation_policy_code_unique UNIQUE (org_id, code), ADD CONSTRAINT quotation_policy_org_id_unique UNIQUE (org_id, id);

-- ---------------------------------------------------------------- ConstructionStandard

CREATE TABLE design_os.construction_standard_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  description text NOT NULL
);
SELECT design_os.install_version_envelope('construction_standard', 'design_os.construction_standard_version', 'design_os.construction_standard', 'construction_standard.author', 'construction_standard.approve');

-- One row per value; `value` NULL = NULL / UNVERIFIED. Each value keeps its own provenance.
CREATE TABLE design_os.construction_standard_value (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  variable_code text NOT NULL REFERENCES design_os.construction_variable (code),
  value numeric,
  unit text,
  source text,
  evidence_ref text,
  note text,
  PRIMARY KEY (version_id, variable_code),
  CONSTRAINT construction_standard_value_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.construction_standard_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.construction_standard_value', 'design_os.construction_standard_version', 'version_id');

-- ---------------------------------------------------------------- PlanningStandard

CREATE TABLE design_os.planning_standard_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  description text NOT NULL
);
SELECT design_os.install_version_envelope('planning_standard', 'design_os.planning_standard_version', 'design_os.planning_standard', 'planning_standard.author', 'planning_standard.approve');

CREATE TABLE design_os.planning_standard_value (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  variable_code text NOT NULL REFERENCES design_os.planning_variable (code),
  value numeric,
  unit text,
  source text,
  evidence_ref text,
  note text,
  PRIMARY KEY (version_id, variable_code),
  CONSTRAINT planning_standard_value_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.planning_standard_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.planning_standard_value', 'design_os.planning_standard_version', 'version_id');

-- ---------------------------------------------------------------- EdgeBandStandard (separate from ConstructionStandard, D5)

CREATE TABLE design_os.edge_band_standard_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  description text NOT NULL
);
SELECT design_os.install_version_envelope('edge_band_standard', 'design_os.edge_band_standard_version', 'design_os.edge_band_standard', 'edge_band_standard.author', 'edge_band_standard.approve');

-- A rule set that exists but has no rules yet (the production draft) is kept explicitly.
CREATE TABLE design_os.edge_band_rule_set (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rule_set_code text NOT NULL,
  PRIMARY KEY (version_id, rule_set_code),
  CONSTRAINT edge_band_rule_set_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.edge_band_standard_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.edge_band_rule_set', 'design_os.edge_band_standard_version', 'version_id');

-- edge_side and edge_band_id both NULL = the component type is defined with explicitly no banding.
-- edge_band_id holds the catalog edge band code (FK added in 0004).
CREATE TABLE design_os.edge_band_rule (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rule_set_code text NOT NULL,
  component_type text NOT NULL,
  edge_side text CHECK (edge_side IN ('FRONT', 'BACK', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT')),
  edge_band_id text,
  CONSTRAINT edge_band_rule_side_band_together CHECK ((edge_side IS NULL) = (edge_band_id IS NULL)),
  CONSTRAINT edge_band_rule_set_fk FOREIGN KEY (version_id, rule_set_code) REFERENCES design_os.edge_band_rule_set (version_id, rule_set_code),
  CONSTRAINT edge_band_rule_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.edge_band_standard_version (org_id, id)
);
CREATE UNIQUE INDEX edge_band_rule_unique ON design_os.edge_band_rule (version_id, rule_set_code, component_type, coalesce(edge_side, '-'));
SELECT design_os.install_draft_guard('design_os.edge_band_rule', 'design_os.edge_band_standard_version', 'version_id');

-- ---------------------------------------------------------------- ManufacturingStandard

CREATE TABLE design_os.manufacturing_standard_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  description text NOT NULL
);
SELECT design_os.install_version_envelope('manufacturing_standard', 'design_os.manufacturing_standard_version', 'design_os.manufacturing_standard', 'manufacturing_standard.author', 'manufacturing_standard.approve');

CREATE TABLE design_os.manufacturing_standard_value (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  variable_code text NOT NULL REFERENCES design_os.manufacturing_variable (code),
  value numeric,
  unit text,
  source text,
  evidence_ref text,
  note text,
  PRIMARY KEY (version_id, variable_code),
  CONSTRAINT manufacturing_standard_value_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.manufacturing_standard_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.manufacturing_standard_value', 'design_os.manufacturing_standard_version', 'version_id');

-- ---------------------------------------------------------------- PricingStandard (rules + rate card; approved by FINANCE only)

CREATE TABLE design_os.pricing_standard_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  rate_card_code text NOT NULL,
  rule_set_code text NOT NULL,
  rules_source text NOT NULL CHECK (btrim(rules_source) <> ''),
  currency text NOT NULL CHECK (currency = 'INR'),
  -- Formula text: evaluated only by the TypeScript formula engine, never by SQL.
  manufacturing_cost_formula text,
  wastage_board_pct numeric(5, 2) CHECK (wastage_board_pct >= 0),
  wastage_edge_band_pct numeric(5, 2) CHECK (wastage_edge_band_pct >= 0),
  wastage_finish_pct numeric(5, 2) CHECK (wastage_finish_pct >= 0),
  overhead_pct numeric(5, 2) CHECK (overhead_pct >= 0),
  margin_basis text CHECK (margin_basis IN ('MARKUP_ON_COST', 'MARGIN_ON_PRICE')),
  margin_pct numeric(5, 2) CHECK (margin_pct >= 0),
  gst_pct numeric(5, 2) CHECK (gst_pct >= 0)
);
SELECT design_os.install_version_envelope('pricing_standard', 'design_os.pricing_standard_version', 'design_os.pricing_standard', 'pricing_standard.author', 'pricing_standard.approve');

-- Rates in integer paise; NULL = NULL / UNVERIFIED (never 0, never assumed).
CREATE TABLE design_os.rate_card_line (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  measure text NOT NULL CHECK (measure IN ('BOARD_M2', 'EDGE_M', 'FINISH_M2', 'HARDWARE_UNIT')),
  item_key text NOT NULL,
  rate_paise bigint CHECK (rate_paise >= 0),
  PRIMARY KEY (version_id, measure, item_key),
  CONSTRAINT rate_card_line_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.pricing_standard_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.rate_card_line', 'design_os.pricing_standard_version', 'version_id');

-- ---------------------------------------------------------------- Finance / QuotationPolicy (approved by FINANCE only)

CREATE TABLE design_os.quotation_policy_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  tax_policy text CHECK (tax_policy IN ('PER_LINE', 'PER_RATE_GROUP')),
  tax_rounding_mode text CHECK (tax_rounding_mode IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP')),
  tax_rounding_increment_paise integer CHECK (tax_rounding_increment_paise > 0),
  grand_total_rounding_mode text CHECK (grand_total_rounding_mode IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP')),
  grand_total_rounding_increment_paise integer CHECK (grand_total_rounding_increment_paise > 0),
  -- Only NONE exists until finance approves other discount modes.
  discount_mode text CHECK (discount_mode = 'NONE'),
  CONSTRAINT quotation_policy_tax_rounding_together CHECK ((tax_rounding_mode IS NULL) = (tax_rounding_increment_paise IS NULL)),
  CONSTRAINT quotation_policy_total_rounding_together CHECK ((grand_total_rounding_mode IS NULL) = (grand_total_rounding_increment_paise IS NULL))
);
SELECT design_os.install_version_envelope('quotation_policy', 'design_os.quotation_policy_version', 'design_os.quotation_policy', 'quotation_policy.author', 'quotation_policy.approve');

CREATE TABLE design_os.tax_rate (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rate_code text NOT NULL,
  percent numeric(5, 2) CHECK (percent >= 0),
  PRIMARY KEY (version_id, rate_code),
  CONSTRAINT tax_rate_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.quotation_policy_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.tax_rate', 'design_os.quotation_policy_version', 'version_id');

CREATE TABLE design_os.tax_rate_mapping (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  product_category text NOT NULL,
  rate_code text,
  PRIMARY KEY (version_id, product_category),
  CONSTRAINT tax_rate_mapping_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.quotation_policy_version (org_id, id),
  CONSTRAINT tax_rate_mapping_rate_fk FOREIGN KEY (version_id, rate_code) REFERENCES design_os.tax_rate (version_id, rate_code)
);
SELECT design_os.install_draft_guard('design_os.tax_rate_mapping', 'design_os.quotation_policy_version', 'version_id');
