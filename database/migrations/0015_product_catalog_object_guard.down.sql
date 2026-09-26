-- 0015 down
SET LOCAL ROLE design_os_owner;
DROP TRIGGER guard_product_catalog_member_in_use ON design_os.product_catalog_version_product;
DROP TRIGGER guard_design_version_product_catalog ON design_os.design_version;
DROP FUNCTION design_os.guard_product_catalog_member_in_use();
DROP FUNCTION design_os.guard_design_version_product_catalog();
DROP FUNCTION design_os.products_outside_catalog(uuid, uuid, uuid);
