-- 0015 product catalog / design object compatibility (M5 Step 5): every design_object's exact product_version must be a
-- member of the product catalog version its DesignVersion pins — not only when the object is written
-- (guard_design_object_product, 0006) but also when the pin changes or the catalog's membership changes. Integrity
-- only: no calculation. Same organization throughout (composite keys and explicit org checks), so another tenant's
-- catalog or product can never satisfy it. Lifecycle rules are unchanged (pins and DRAFT catalog membership remain
-- editable only while DRAFT, as before).
SET LOCAL ROLE design_os_owner;

-- The product versions used by a design version's objects that are NOT members of the given product catalog version.
CREATE FUNCTION design_os.products_outside_catalog(p_org uuid, p_design_version uuid, p_catalog_version uuid) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT coalesce(array_agg(DISTINCT o.product_version_id ORDER BY o.product_version_id), ARRAY[]::uuid[])
    FROM design_os.design_object o
    WHERE o.design_version_id = p_design_version AND o.org_id = p_org
      AND NOT EXISTS (
        SELECT 1 FROM design_os.product_catalog_version_product m
        WHERE m.catalog_version_id = p_catalog_version AND m.org_id = p_org AND m.product_version_id = o.product_version_id)
  $$;

-- 1. Re-pinning a DesignVersion's product catalog: every placed object must still be in the new catalog version.
CREATE FUNCTION design_os.guard_design_version_product_catalog() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  outside uuid[];
BEGIN
  IF NEW.product_catalog_version_id IS DISTINCT FROM OLD.product_catalog_version_id THEN
    outside := design_os.products_outside_catalog(NEW.org_id, NEW.id, NEW.product_catalog_version_id);
    IF cardinality(outside) > 0 THEN
      RAISE EXCEPTION 'design_os.design_version: product catalog version % does not contain product version(s) % used by the design''s objects',
        NEW.product_catalog_version_id, outside
        USING ERRCODE = 'LD019', DETAIL = jsonb_build_object('productVersionIds', to_jsonb(outside))::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_design_version_product_catalog BEFORE UPDATE OF product_catalog_version_id ON design_os.design_version
  FOR EACH ROW EXECUTE FUNCTION design_os.guard_design_version_product_catalog();

-- 2. Removing or re-pointing a product from a (DRAFT) product catalog version that design versions pin while their
--    objects use it would break the same invariant from the other side.
CREATE FUNCTION design_os.guard_product_catalog_member_in_use() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.product_version_id = OLD.product_version_id AND NEW.catalog_version_id = OLD.catalog_version_id AND NEW.org_id = OLD.org_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM design_os.design_version dv JOIN design_os.design_object o ON o.design_version_id = dv.id AND o.org_id = dv.org_id
    WHERE dv.org_id = OLD.org_id AND dv.product_catalog_version_id = OLD.catalog_version_id AND o.product_version_id = OLD.product_version_id
  ) THEN
    RAISE EXCEPTION 'design_os.product_catalog_version_product: product version % is used by design objects that pin catalog version %', OLD.product_version_id, OLD.catalog_version_id
      USING ERRCODE = 'LD019', DETAIL = jsonb_build_object('productVersionIds', jsonb_build_array(OLD.product_version_id))::text;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_product_catalog_member_in_use BEFORE UPDATE OR DELETE ON design_os.product_catalog_version_product
  FOR EACH ROW EXECUTE FUNCTION design_os.guard_product_catalog_member_in_use();

REVOKE ALL ON FUNCTION design_os.products_outside_catalog(uuid, uuid, uuid), design_os.guard_design_version_product_catalog(),
  design_os.guard_product_catalog_member_in_use() FROM PUBLIC;
