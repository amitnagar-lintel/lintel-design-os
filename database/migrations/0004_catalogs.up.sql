-- 0004 catalogs: catalog-domain items (Material incl. edge bands, Finish, Hardware, Appliance, Product and
-- ConstructionRecipe) and the per-domain CATALOG VERSIONS a DesignVersion pins (M5 §2.5).
-- A catalog version is itself an immutable, versioned record whose membership lists EXACT item versions
-- and is frozen once it leaves DRAFT. Publishing a newer catalog version creates a new row; it never
-- changes a version a design already pins. No generic "MaterialStandard" / "HardwareStandard".
SET LOCAL ROLE design_os_owner;

-- One entity-table shape per item domain: stable identity + business code (the engine id).
CREATE FUNCTION design_os.create_entity_table(p_name text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format($f$
    CREATE TABLE design_os.%1$I (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES design_os.organization (id),
      code text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT %1$s_code_unique UNIQUE (org_id, code),
      CONSTRAINT %1$s_org_id_unique UNIQUE (org_id, id)
    )$f$, p_name);
END $$;

SELECT design_os.create_entity_table(n) FROM unnest(ARRAY[
  'material', 'edge_band', 'finish', 'hardware_item', 'hardware_rule_set', 'appliance', 'construction_recipe', 'product',
  'material_catalog', 'finish_catalog', 'hardware_catalog', 'appliance_catalog', 'product_catalog'
]) AS n;

-- ---------------------------------------------------------------- item versions (typed technical columns)

CREATE TABLE design_os.material_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  category text NOT NULL CHECK (category = 'BOARD'),
  name text NOT NULL,
  substrate text,
  thickness_mm numeric(8, 2) NOT NULL CHECK (thickness_mm > 0),
  sheet_width_mm numeric(8, 2) CHECK (sheet_width_mm > 0),
  sheet_height_mm numeric(8, 2) CHECK (sheet_height_mm > 0),
  grain boolean,
  density_kg_m3 numeric(8, 2) CHECK (density_kg_m3 > 0),
  CONSTRAINT material_version_sheet_together CHECK ((sheet_width_mm IS NULL) = (sheet_height_mm IS NULL))
);
SELECT design_os.install_version_envelope('material', 'design_os.material_version', 'design_os.material', 'material_catalog.author', 'material_catalog.approve');

CREATE TABLE design_os.edge_band_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  name text NOT NULL,
  material text CHECK (material IN ('ABS', 'PVC', 'VENEER')),
  thickness_mm numeric(8, 2) NOT NULL CHECK (thickness_mm > 0),
  width_mm numeric(8, 2) CHECK (width_mm > 0)
);
SELECT design_os.install_version_envelope('edge_band', 'design_os.edge_band_version', 'design_os.edge_band', 'material_catalog.author', 'material_catalog.approve');

-- EdgeBandStandard rules reference catalog edge bands by code (same tenant).
ALTER TABLE design_os.edge_band_rule ADD CONSTRAINT edge_band_rule_band_fk FOREIGN KEY (org_id, edge_band_id) REFERENCES design_os.edge_band (org_id, code);

CREATE TABLE design_os.finish_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  finish_type text NOT NULL CHECK (finish_type IN ('LAMINATE', 'VENEER', 'PAINT', 'ACRYLIC', 'PU')),
  name text NOT NULL,
  thickness_mm numeric(8, 2) CHECK (thickness_mm > 0)
);
SELECT design_os.install_version_envelope('finish', 'design_os.finish_version', 'design_os.finish', 'finish_catalog.author', 'finish_catalog.approve');

CREATE TABLE design_os.finish_material_compatibility (
  org_id uuid NOT NULL,
  finish_version_id uuid NOT NULL,
  material_id uuid NOT NULL,
  PRIMARY KEY (finish_version_id, material_id),
  CONSTRAINT finish_material_compat_finish_fk FOREIGN KEY (org_id, finish_version_id) REFERENCES design_os.finish_version (org_id, id),
  CONSTRAINT finish_material_compat_material_fk FOREIGN KEY (org_id, material_id) REFERENCES design_os.material (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.finish_material_compatibility', 'design_os.finish_version', 'finish_version_id');

-- Manufacturer-neutral hardware items: no engine type yet (attributes validated by the TS schema when it exists).
CREATE TABLE design_os.hardware_item_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  category text NOT NULL,
  application text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);
SELECT design_os.install_version_envelope('hardware_item', 'design_os.hardware_item_version', 'design_os.hardware_item', 'hardware_catalog.author', 'hardware_catalog.approve');

CREATE TABLE design_os.hardware_rule_set_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL
);
SELECT design_os.install_version_envelope('hardware_rule_set', 'design_os.hardware_rule_set_version', 'design_os.hardware_rule_set', 'hardware_catalog.author', 'hardware_catalog.approve');

-- Rule order is data (first match wins): stored explicitly as position 0..n-1.
CREATE TABLE design_os.hardware_rule (
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  rule_code text NOT NULL,
  component_type text NOT NULL,
  category text NOT NULL,
  application text NOT NULL,
  mounting_parameter_key text NOT NULL,
  mounting_map jsonb NOT NULL,
  preferred_manufacturer text NOT NULL,
  PRIMARY KEY (version_id, rule_code),
  CONSTRAINT hardware_rule_position_unique UNIQUE (version_id, position),
  CONSTRAINT hardware_rule_version_fk FOREIGN KEY (org_id, version_id) REFERENCES design_os.hardware_rule_set_version (org_id, id)
);
SELECT design_os.install_draft_guard('design_os.hardware_rule', 'design_os.hardware_rule_set_version', 'version_id');

-- No engine consumes appliances yet.
CREATE TABLE design_os.appliance_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  category text NOT NULL,
  make text,
  model text,
  dimensions jsonb,
  cutout_requirements jsonb
);
SELECT design_os.install_version_envelope('appliance', 'design_os.appliance_version', 'design_os.appliance', 'appliance_catalog.author', 'appliance_catalog.approve');

-- Recipes and products are data (PRD §14): definitions as validated jsonb; formulas never run in SQL.
CREATE TABLE design_os.recipe_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  product_type text NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object')
);
SELECT design_os.install_version_envelope('construction_recipe', 'design_os.recipe_version', 'design_os.construction_recipe', 'product_catalog.author', 'product_catalog.approve');

-- A product version pins the EXACT recipe version it is built from (recipes are a product dependency, not a design pin).
CREATE TABLE design_os.product_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  entity_id uuid NOT NULL,
  category text NOT NULL,
  object_type text NOT NULL,
  recipe_code text NOT NULL,
  recipe_version_id uuid NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT product_version_recipe_fk FOREIGN KEY (org_id, recipe_version_id) REFERENCES design_os.recipe_version (org_id, id)
);
SELECT design_os.install_version_envelope('product', 'design_os.product_version', 'design_os.product', 'product_catalog.author', 'product_catalog.approve');

CREATE FUNCTION design_os.guard_product_recipe() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM design_os.recipe_version rv JOIN design_os.construction_recipe r ON r.id = rv.entity_id
    WHERE rv.id = NEW.recipe_version_id AND rv.org_id = NEW.org_id AND r.code = NEW.recipe_code
  ) THEN
    RAISE EXCEPTION 'design_os.product_version: recipe_version_id must be a version of recipe %', NEW.recipe_code USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_product_recipe BEFORE INSERT OR UPDATE ON design_os.product_version FOR EACH ROW EXECUTE FUNCTION design_os.guard_product_recipe();

-- ---------------------------------------------------------------- per-domain CATALOG VERSIONS (the records a design pins)

CREATE FUNCTION design_os.create_catalog_version_table(p_domain text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format($f$
    CREATE TABLE design_os.%1$I (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES design_os.organization (id),
      entity_id uuid NOT NULL,
      description text NOT NULL
    )$f$, p_domain || '_catalog_version');
  PERFORM design_os.install_version_envelope(p_domain || '_catalog', ('design_os.' || p_domain || '_catalog_version')::regclass, ('design_os.' || p_domain || '_catalog')::regclass,
    p_domain || '_catalog.author', p_domain || '_catalog.approve');
END $$;

-- Membership: exactly one version of each item entity per catalog version; frozen once the catalog version leaves DRAFT.
CREATE FUNCTION design_os.create_catalog_member_table(p_domain text, p_item text) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  t text := p_domain || '_catalog_version_' || p_item;
BEGIN
  EXECUTE format($f$
    CREATE TABLE design_os.%1$I (
      org_id uuid NOT NULL,
      catalog_version_id uuid NOT NULL,
      %2$I uuid NOT NULL,
      %3$I uuid NOT NULL,
      PRIMARY KEY (catalog_version_id, %2$I),
      CONSTRAINT %1$s_catalog_fk FOREIGN KEY (org_id, catalog_version_id) REFERENCES design_os.%4$I (org_id, id),
      CONSTRAINT %1$s_item_fk FOREIGN KEY (org_id, %2$I, %3$I) REFERENCES design_os.%5$I (org_id, entity_id, id)
    )$f$, t, p_item || '_id', p_item || '_version_id', p_domain || '_catalog_version', p_item || '_version');
  PERFORM design_os.install_draft_guard(('design_os.' || t)::regclass, ('design_os.' || p_domain || '_catalog_version')::regclass, 'catalog_version_id');
END $$;

SELECT design_os.create_catalog_version_table(d) FROM unnest(ARRAY['material', 'finish', 'hardware', 'appliance', 'product']) AS d;

SELECT design_os.create_catalog_member_table(d, i) FROM (VALUES
  ('material', 'material'), ('material', 'edge_band'),
  ('finish', 'finish'),
  ('hardware', 'hardware_item'), ('hardware', 'hardware_rule_set'),
  ('appliance', 'appliance'),
  ('product', 'product')
) AS m(d, i);
